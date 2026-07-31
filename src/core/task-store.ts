import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { AmbiguousTaskError, SchemaError, ValidationError } from "./errors.js";
import { appendJsonl, readJson, writeJsonAtomic } from "./json.js";
import { assertNoSymlink, ensureDirectory, type VineaPaths } from "./paths.js";
import {
  SCHEMA_VERSION,
  type EvidenceRecord,
  type Host,
  type JournalCreationEvent,
  type JournalContinuationEvent,
  type JournalTransitionDetails,
  type JournalTransitionIntentEvent,
  type SessionBinding,
  type TaskMutationJournalEvent,
  type TaskRecord,
} from "./types.js";

const ARTIFACTS = [
  "brief.md",
  "plan.md",
  "context.jsonl",
  "evidence.jsonl",
  "check.md",
  "journal.md",
] as const;
const TASK_ID_PATTERN = /^t-\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface TaskLocation {
  task: TaskRecord;
  directory: string;
  scope: "active" | "archive";
}

export type SessionBindingReadResult =
  | { status: "missing" }
  | { status: "valid"; binding: SessionBinding }
  | { status: "malformed"; message: string };

export interface TransitionPersistenceOperations {
  createOperationId(): string;
  appendJournal(filename: string, value: unknown, repoRoot: string): Promise<void>;
  moveDirectory(source: string, destination: string): Promise<void>;
  writeTask(filename: string, value: unknown, repoRoot: string): Promise<void>;
}

const DEFAULT_TRANSITION_OPERATIONS: TransitionPersistenceOperations = {
  createOperationId: randomUUID,
  appendJournal: appendJsonl,
  moveDirectory: rename,
  writeTask: writeJsonAtomic,
};

export async function createTaskArtifacts(
  paths: VineaPaths,
  task: TaskRecord,
  creationEvent: JournalCreationEvent,
): Promise<TaskLocation> {
  const directory = join(paths.activeTasks, task.id);
  const archivedDirectory = join(paths.archivedTasks, task.id);
  await Promise.all([
    assertNoSymlink(paths.repoRoot, directory),
    assertNoSymlink(paths.repoRoot, archivedDirectory),
  ]);
  if (await pathExists(archivedDirectory)) {
    throw new ValidationError(`Task path already exists for generated ID ${task.id}.`);
  }
  try {
    await mkdir(directory);
  } catch (error) {
    if (isCode(error, "EEXIST")) {
      throw new ValidationError(`Task path already exists for generated ID ${task.id}.`);
    }
    throw new SchemaError(`Unable to create task directory ${directory}`, error);
  }
  let archivedCollisionAfterCreate: boolean;
  try {
    archivedCollisionAfterCreate = await pathExists(archivedDirectory);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw new SchemaError(`Unable to verify archived task collision for ${task.id}`, error);
  }
  if (archivedCollisionAfterCreate) {
    await rm(directory, { recursive: true, force: true });
    throw new ValidationError(`Task path already exists for generated ID ${task.id}.`);
  }

  const writes = await Promise.allSettled([
    writeFile(join(directory, "task.json"), `${JSON.stringify(task, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
    ...ARTIFACTS.filter((artifact) => artifact !== "journal.md").map((artifact) =>
      writeFile(join(directory, artifact), "", { encoding: "utf8", flag: "wx" }),
    ),
    writeFile(join(directory, "journal.md"), `${JSON.stringify(creationEvent)}\n`, { encoding: "utf8", flag: "wx" }),
  ]);
  const failed = writes.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) {
    await rm(directory, { recursive: true, force: true });
    throw new SchemaError(`Unable to create task artifacts for ${task.id}`, failed.reason);
  }

  return { task, directory, scope: "active" };
}

export async function findTask(paths: VineaPaths, taskId: string): Promise<TaskLocation> {
  if (!TASK_ID_PATTERN.test(taskId)) throw new ValidationError(`Invalid task ID: ${taskId}`);
  const matches = (await Promise.all([
    findInScope(paths, paths.activeTasks, "active", taskId),
    findInScope(paths, paths.archivedTasks, "archive", taskId),
  ])).flat();
  if (matches.length === 0) throw new ValidationError(`Task not found: ${taskId}`);
  if (matches.length > 1) throw new AmbiguousTaskError(`Task ID is present in multiple locations: ${taskId}`);
  return matches[0]!;
}

export async function listStoredTasks(
  paths: VineaPaths,
  status: "active" | "all",
): Promise<TaskLocation[]> {
  const scopes: Array<[string, "active" | "archive"]> = [[paths.activeTasks, "active"]];
  if (status === "all") scopes.push([paths.archivedTasks, "archive"]);
  const tasks = (await Promise.all(scopes.map(([directory, scope]) => listScope(paths, directory, scope)))).flat();
  return tasks.sort((left, right) => left.task.id.localeCompare(right.task.id));
}

export async function persistTaskTransition(
  paths: VineaPaths,
  location: TaskLocation,
  task: TaskRecord,
  transition: JournalTransitionDetails,
  operationOverrides: Partial<TransitionPersistenceOperations> = {},
): Promise<TaskLocation> {
  // The append-only intent is the audit record; task.json's atomic status write is
  // the commit marker. Archive moves happen while the old status is still stored,
  // so any returned failure is either old-state + intent or new-state + no later failure.
  const operations = { ...DEFAULT_TRANSITION_OPERATIONS, ...operationOverrides };
  const journalPath = join(location.directory, "journal.md");
  const shouldMoveToArchive = task.status === "archived" && location.scope === "active";
  const destination = shouldMoveToArchive ? join(paths.archivedTasks, task.id) : undefined;
  await assertNoSymlink(paths.repoRoot, journalPath);
  if (destination !== undefined) await assertNoSymlink(paths.repoRoot, destination);
  const intent: JournalTransitionIntentEvent = {
    ...transition,
    type: "transition_intent",
    operationId: operations.createOperationId(),
  };
  await operations.appendJournal(journalPath, intent, paths.repoRoot);

  let targetDirectory = location.directory;
  let targetScope = location.scope;
  if (destination !== undefined) {
    try {
      await operations.moveDirectory(location.directory, destination);
    } catch (error) {
      throw new SchemaError(`Unable to archive task ${task.id}; transition intent remains pending for retry`, error);
    }
    targetDirectory = destination;
    targetScope = "archive";
  }

  try {
    await operations.writeTask(join(targetDirectory, "task.json"), task, paths.repoRoot);
  } catch (error) {
    throw new SchemaError(`Unable to commit task transition for ${task.id}; transition intent remains pending for retry`, error);
  }
  return { task, directory: targetDirectory, scope: targetScope };
}

export async function persistTaskMutation(
  paths: VineaPaths,
  location: TaskLocation,
  task: TaskRecord,
  event: Omit<TaskMutationJournalEvent, "operationId" | "mutationKind">,
  operationOverrides: Partial<TransitionPersistenceOperations> = {},
): Promise<TaskLocation> {
  const operations = { ...DEFAULT_TRANSITION_OPERATIONS, ...operationOverrides };
  await appendTaskMutationIntent(paths, location, event, operations);
  try {
    await operations.writeTask(join(location.directory, "task.json"), task, paths.repoRoot);
  } catch (error) {
    throw new SchemaError(
      `Unable to commit task mutation for ${task.id}; journal intent remains pending for retry`,
      error,
    );
  }
  return { ...location, task };
}

export async function appendTaskMutationIntent(
  paths: VineaPaths,
  location: TaskLocation,
  event: Omit<TaskMutationJournalEvent, "operationId" | "mutationKind">,
  operationOverrides: Partial<TransitionPersistenceOperations> = {},
): Promise<TaskMutationJournalEvent> {
  const operations = { ...DEFAULT_TRANSITION_OPERATIONS, ...operationOverrides };
  const journalPath = join(location.directory, "journal.md");
  await assertNoSymlink(paths.repoRoot, journalPath);
  const intent: TaskMutationJournalEvent = {
    ...event,
    mutationKind: event.type,
    operationId: operations.createOperationId(),
  };
  await operations.appendJournal(journalPath, intent, paths.repoRoot);
  return intent;
}

export async function appendTaskContinuation(
  paths: VineaPaths,
  location: TaskLocation,
  event: JournalContinuationEvent,
): Promise<void> {
  const journalPath = join(location.directory, "journal.md");
  await assertNoSymlink(paths.repoRoot, journalPath);
  await appendJsonl(journalPath, event, paths.repoRoot);
}

export function sessionBindingPath(paths: VineaPaths, host: Host, sessionId: string): string {
  const safeSessionId = safeSessionFilenamePart(sessionId);
  return join(paths.sessions, `${host}-${safeSessionId}.json`);
}

export async function readSessionBinding(
  paths: VineaPaths,
  host: Host,
  sessionId: string,
): Promise<SessionBindingReadResult> {
  const filename = sessionBindingPath(paths, host, sessionId);
  try {
    await assertNoSymlink(paths.repoRoot, filename);
    const contents = await readFile(filename, "utf8");
    let value: unknown;
    try {
      value = JSON.parse(contents) as unknown;
    } catch {
      return { status: "malformed", message: `Invalid JSON in session binding ${filename}` };
    }
    if (!isSessionBinding(value)) {
      return { status: "malformed", message: `Invalid session binding in ${filename}` };
    }
    return { status: "valid", binding: value };
  } catch (error) {
    if (isCode(error, "ENOENT")) return { status: "missing" };
    if (error instanceof ValidationError) throw error;
    if (error instanceof SchemaError) {
      return { status: "malformed", message: error.message };
    }
    return {
      status: "malformed",
      message: `Unable to read session binding ${filename}`,
    };
  }
}

export async function writeSessionBinding(
  paths: VineaPaths,
  host: Host,
  sessionId: string,
  binding: SessionBinding,
): Promise<void> {
  const filename = sessionBindingPath(paths, host, sessionId);
  await ensureDirectory(paths.repoRoot, paths.sessions);
  await writeJsonAtomic(filename, binding, paths.repoRoot);
}

export async function readLatestEvidence(location: TaskLocation): Promise<EvidenceRecord | null> {
  const filename = join(location.directory, "evidence.jsonl");
  const records = await readJsonlRecords(filename);
  if (records.length === 0) return null;
  const evidence = records.map((record, index) => {
    if (!isEvidenceRecord(record)) {
      throw new SchemaError(`Invalid evidence record in ${filename} at line ${index + 1}`);
    }
    return record;
  });
  return evidence.at(-1)!;
}

export async function readLatestCheckEvent(
  location: TaskLocation,
): Promise<Record<string, unknown> | null> {
  const filename = join(location.directory, "journal.md");
  const events = await readJsonlRecords(filename);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!isRecord(event) || typeof event.type !== "string") continue;
    if (event.type === "check_recorded" || event.type === "check_updated") return event;
  }
  return null;
}

export async function writeTaskArtifact(
  paths: VineaPaths,
  location: TaskLocation,
  artifact: "brief.md" | "plan.md",
  contents: string,
): Promise<void> {
  const filename = join(location.directory, artifact);
  await assertNoSymlink(paths.repoRoot, filename);
  const temporary = join(location.directory, `.${artifact}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporary, filename);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (!isCode(cleanupError, "ENOENT")) {
        throw new SchemaError(`Unable to clean temporary task artifact ${temporary}`, cleanupError);
      }
    }
    throw new SchemaError(`Unable to write task artifact ${filename}`, error);
  }
}

async function findInScope(
  paths: VineaPaths,
  root: string,
  scope: "active" | "archive",
  taskId: string,
): Promise<TaskLocation[]> {
  const direct = join(root, taskId);
  if (!(await isDirectory(direct))) return [];
  return [await loadLocation(paths, direct, scope, false)];
}

async function listScope(
  paths: VineaPaths,
  root: string,
  scope: "active" | "archive",
): Promise<TaskLocation[]> {
  await assertNoSymlink(paths.repoRoot, root);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    throw new SchemaError(`Unable to list task directory ${root}`, error);
  }
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => loadLocation(paths, join(root, entry.name), scope, true)),
  );
}

async function loadLocation(
  paths: VineaPaths,
  directory: string,
  scope: "active" | "archive",
  strict: boolean,
): Promise<TaskLocation> {
  const task = await readJson<unknown>(join(directory, "task.json"), paths.repoRoot);
  if (
    !isTaskRecordBaseShape(task)
    || (strict && !isTaskRecordShape(task))
    || task.id !== basename(directory)
  ) {
    throw new SchemaError(`Invalid task record in ${directory}`);
  }
  return { task, directory, scope };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const entry = await lstat(path);
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch (error) {
    if (isCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isCode(error, "ENOENT")) return false;
    throw error;
  }
}

function isCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function safeSessionFilenamePart(sessionId: string): string {
  if (sessionId.trim() === "") {
    throw new ValidationError("Session ID must not be empty.");
  }
  if (sessionId.includes("/") || sessionId.includes("\\") || sessionId.includes("\0")) {
    throw new ValidationError("Session ID must not contain path separators or NUL bytes.");
  }
  if (sessionId === "." || sessionId === "..") {
    throw new ValidationError("Session ID must not contain path traversal.");
  }
  if (!isWellFormedUnicode(sessionId)) {
    throw new ValidationError("Session ID must contain well-formed Unicode.");
  }
  if (Buffer.byteLength(sessionId, "utf8") > 119) {
    throw new ValidationError("Session ID exceeds the 119-byte local binding limit.");
  }
  return `sid-${Buffer.from(sessionId, "utf8").toString("hex")}`;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

function isSessionBinding(value: unknown): value is SessionBinding {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !["schemaVersion", "taskId", "boundAt"].includes(key))) return false;
  return value.schemaVersion === SCHEMA_VERSION
    && typeof value.taskId === "string"
    && TASK_ID_PATTERN.test(value.taskId)
    && isIsoTimestamp(value.boundAt);
}

function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  if (!isRecord(value)) return false;
  return value.schemaVersion === SCHEMA_VERSION
    && typeof value.id === "string"
    && value.id.trim() !== ""
    && ["command", "manual", "tdd-red", "tdd-green"].includes(String(value.kind))
    && typeof value.summary === "string"
    && value.summary.trim() !== ""
    && ["pass", "fail"].includes(String(value.result))
    && isIsoTimestamp(value.recordedAt)
    && typeof value.actor === "string"
    && value.actor.trim() !== "";
}

function isTaskRecordShape(value: unknown): value is TaskRecord {
  if (!isTaskRecordBaseShape(value)) return false;
  return value.requirements.every(isRequirement)
    && value.acceptanceCriteria.every(isRequirement)
    && isCommitMetadata(value.commit);
}

function isTaskRecordBaseShape(value: unknown): value is TaskRecord {
  if (!isRecord(value)) return false;
  const risk = value.risk;
  return value.schemaVersion === SCHEMA_VERSION
    && typeof value.id === "string"
    && TASK_ID_PATTERN.test(value.id)
    && typeof value.title === "string"
    && value.title.trim() !== ""
    && ["planning", "ready", "in_progress", "checking", "finished", "archived", "blocked"].includes(
      String(value.status),
    )
    && isRecord(risk)
    && ["low", "medium", "high"].includes(String(risk.level))
    && Array.isArray(risk.reasons)
    && risk.reasons.every((reason) => typeof reason === "string")
    && ["standard", "tdd"].includes(String(value.qualityMode))
    && ["single-agent", "delegated"].includes(String(value.executionMode))
    && Array.isArray(value.requirements)
    && Array.isArray(value.acceptanceCriteria)
    && isIsoTimestamp(value.createdAt)
    && isIsoTimestamp(value.updatedAt);
}

function isRequirement(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !["schemaVersion", "id", "text", "createdAt"].includes(key))) {
    return false;
  }
  return value.schemaVersion === SCHEMA_VERSION
    && typeof value.id === "string"
    && value.id.trim() !== ""
    && typeof value.text === "string"
    && value.text.trim() !== ""
    && isIsoTimestamp(value.createdAt);
}

function isCommitMetadata(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !["sha", "message"].includes(key))) return false;
  return typeof value.sha === "string"
    && value.sha.trim() !== ""
    && (value.message === undefined || typeof value.message === "string");
}

async function readJsonlRecords(filename: string): Promise<unknown[]> {
  let contents: string;
  try {
    contents = await readFile(filename, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read JSONL file ${filename}`, error);
  }
  return contents.split("\n").filter((line) => line !== "").map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch (error) {
      throw new SchemaError(`Invalid JSONL in ${filename} at line ${index + 1}`, error);
    }
  });
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
