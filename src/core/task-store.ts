import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rmdir, rm, unlink, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { AmbiguousTaskError, SchemaError, TransitionError, ValidationError } from "./errors.js";
import { appendJsonl, readJson, writeJsonAtomic } from "./json.js";
import { assertInside, assertNoSymlink, ensureDirectory, type VineaPaths } from "./paths.js";
import {
  SCHEMA_VERSION,
  type EvidenceRecord,
  type Host,
  type JournalCreationEvent,
  type JournalContinuationEvent,
  type JournalTransitionDetails,
  type JournalTransitionIntentEvent,
  type JournalMutationIntentEvent,
  type MutationCompletionEvent,
  type MutationKind,
  type MutationTargetSummary,
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
const MUTATION_TASK_ARTIFACTS = new Set([
  "task.json",
  "brief.md",
  "plan.md",
  "context.jsonl",
  "evidence.jsonl",
  "check.md",
]);
const TASK_ID_PATTERN = /^t-\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TASK_LOCK_RETRY_MILLISECONDS = 25;
const TASK_LOCK_TIMEOUT_MILLISECONDS = 5000;
const taskLockContext = new AsyncLocalStorage<Set<string>>();

export interface TaskLocation {
  task: TaskRecord;
  directory: string;
  scope: "active" | "archive";
}

export function assertTaskMutable(location: TaskLocation): void {
  if (location.scope === "archive" || location.task.status === "finished" || location.task.status === "archived") {
    throw new ValidationError(`Task is terminal and cannot be mutated: ${location.task.id}`);
  }
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

export interface PreparedTaskMutation {
  expected: MutationTargetSummary;
  completion: Omit<MutationCompletionEvent, "operationId">;
  apply(): Promise<void>;
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
  return withTaskLock(paths, task.id, () => persistTaskTransitionLocked(paths, location, task, transition, operationOverrides));
}

async function persistTaskTransitionLocked(
  paths: VineaPaths,
  location: TaskLocation,
  task: TaskRecord,
  transition: JournalTransitionDetails,
  operationOverrides: Partial<TransitionPersistenceOperations>,
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
  await assertNoPendingTaskMutation(paths, location);
  const pending = await readPendingTransitionIntent(paths, journalPath, location.task.status);
  let intent: JournalTransitionIntentEvent;
  if (pending !== null) {
    if (pending.oldStatus !== transition.oldStatus || pending.newStatus !== transition.newStatus) {
      throw new SchemaError(
        `Task ${task.id} has a pending ${pending.oldStatus} -> ${pending.newStatus} transition; retry that transition before starting another.`,
      );
    }
    // A previous intent is deliberately retained as the operation identity. The
    // task.json write is its commit marker, so retrying must finish this intent
    // rather than append a second, discontinuous transition.
    intent = pending;
  } else {
    intent = {
      ...transition,
      type: "transition_intent",
      operationId: operations.createOperationId(),
    };
    await operations.appendJournal(journalPath, intent, paths.repoRoot);
  }

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

  const committedTask = pending === null ? task : { ...task, updatedAt: intent.timestamp };
  try {
    await operations.writeTask(join(targetDirectory, "task.json"), committedTask, paths.repoRoot);
  } catch (error) {
    throw new SchemaError(`Unable to commit task transition for ${task.id}; transition intent remains pending for retry`, error);
  }
  return { task: committedTask, directory: targetDirectory, scope: targetScope };
}

export async function persistTaskMutation(
  paths: VineaPaths,
  location: TaskLocation,
  task: TaskRecord,
  event: Omit<TaskMutationJournalEvent, "operationId" | "mutationKind">,
  operationOverrides: Partial<TransitionPersistenceOperations> = {},
): Promise<TaskLocation> {
  return withTaskLock(paths, task.id, () => persistTaskMutationLocked(paths, location, task, event, operationOverrides));
}

async function persistTaskMutationLocked(
  paths: VineaPaths,
  location: TaskLocation,
  task: TaskRecord,
  event: Omit<TaskMutationJournalEvent, "operationId" | "mutationKind">,
  operationOverrides: Partial<TransitionPersistenceOperations>,
): Promise<TaskLocation> {
  const operations = { ...DEFAULT_TRANSITION_OPERATIONS, ...operationOverrides };
  const taskPath = join(location.directory, "task.json");
  const completion: Omit<TaskMutationJournalEvent, "operationId" | "mutationKind"> & { mutationKind: TaskMutationJournalEvent["mutationKind"] } = {
    ...event,
    mutationKind: event.type,
  };
  await executeTaskMutationLocked(
    paths,
    location,
    {
      mutationKind: event.type,
      actor: event.actor,
      timestamp: event.timestamp,
      fingerprint: mutationRequestFingerprint(event, task),
    },
    async () => ({
      expected: mutationTargetSummary(paths, [{ filename: taskPath, contents: `${JSON.stringify(task, null, 2)}\n` }], taskMutationIdentity(event, task)),
      completion,
      apply: async () => {
        try {
          await operations.writeTask(taskPath, task, paths.repoRoot);
        } catch (error) {
          throw new SchemaError(
            `Unable to commit task mutation for ${task.id}; journal intent remains pending for retry`,
            error,
          );
        }
      },
    }),
    operations,
  );
  return { ...location, task };
}

export async function executeTaskMutation(
  paths: VineaPaths,
  location: TaskLocation,
  request: {
    mutationKind: MutationKind;
    actor: string;
    timestamp: string;
    fingerprint: string;
  },
  prepare: (timestamp: string, recovering: boolean) => Promise<PreparedTaskMutation>,
  operationOverrides: Partial<TransitionPersistenceOperations> = {},
): Promise<JournalMutationIntentEvent> {
  return withTaskLock(paths, location.task.id, () => executeTaskMutationLocked(
    paths,
    location,
    request,
    prepare,
    { ...DEFAULT_TRANSITION_OPERATIONS, ...operationOverrides },
  ));
}

async function executeTaskMutationLocked(
  paths: VineaPaths,
  location: TaskLocation,
  request: {
    mutationKind: MutationKind;
    actor: string;
    timestamp: string;
    fingerprint: string;
  },
  prepare: (timestamp: string, recovering: boolean) => Promise<PreparedTaskMutation>,
  operations: TransitionPersistenceOperations,
): Promise<JournalMutationIntentEvent> {
  await assertNoPendingTaskTransition(paths, location);
  const journalPath = join(location.directory, "journal.md");
  const pending = await readPendingTaskMutationIntent(paths, journalPath);
  if (pending !== null) {
    if (pending.mutationKind !== request.mutationKind || pending.fingerprint !== request.fingerprint) {
      throw new TransitionError(
        `Task ${location.task.id} has a pending ${pending.mutationKind} mutation; retry that exact mutation before recording another task change.`,
      );
    }
    if (await mutationTargetsMatch(paths, location, pending.expected)) {
      await appendMutationCompletion(paths, journalPath, pending, operations);
      return pending;
    }
    const prepared = await prepare(pending.timestamp, true);
    if (stableJson(prepared.expected) !== stableJson(pending.expected) || !matchesCompletion(prepared.completion, pending.completion)) {
      throw new SchemaError(`Pending mutation ${pending.operationId} no longer matches the requested target; inspect it before retrying.`);
    }
    await prepared.apply();
    if (!await mutationTargetsMatch(paths, location, pending.expected)) {
      throw new SchemaError(`Mutation ${pending.operationId} did not produce its expected managed targets; journal intent remains pending.`);
    }
    await appendMutationCompletion(paths, journalPath, pending, operations);
    return pending;
  }

  const prepared = await prepare(request.timestamp, false);
  const intent: JournalMutationIntentEvent = {
    schemaVersion: SCHEMA_VERSION,
    type: "mutation_intent",
    operationId: operations.createOperationId(),
    timestamp: request.timestamp,
    actor: request.actor,
    mutationKind: request.mutationKind,
    fingerprint: request.fingerprint,
    expected: prepared.expected,
    completion: prepared.completion,
  };
  await operations.appendJournal(journalPath, intent, paths.repoRoot);
  await prepared.apply();
  if (!await mutationTargetsMatch(paths, location, intent.expected)) {
    throw new SchemaError(`Mutation ${intent.operationId} did not produce its expected managed targets; journal intent remains pending.`);
  }
  await appendMutationCompletion(paths, journalPath, intent, operations);
  return intent;
}

export function mutationFingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function mutationTargetSummary(
  paths: VineaPaths,
  targets: Array<{ filename: string; contents: string | Buffer }>,
  identity: Record<string, string>,
): MutationTargetSummary {
  return {
    identity,
    files: targets.map(({ filename, contents }) => ({
      path: relative(paths.repoRoot, filename).split("\\").join("/"),
      sha256: createHash("sha256").update(contents).digest("hex"),
    })).sort((left, right) => left.path.localeCompare(right.path)),
  };
}

async function readPendingTaskMutationIntent(
  paths: VineaPaths,
  journalPath: string,
): Promise<JournalMutationIntentEvent | null> {
  const records = await readJsonlRecords(paths.repoRoot, journalPath);
  let pending: JournalMutationIntentEvent | null = null;
  for (const record of records) {
    if (!isRecord(record) || typeof record.type !== "string") continue;
    if (record.type === "mutation_intent") {
      if (!isMutationIntent(record)) throw new SchemaError(`Invalid mutation intent in ${journalPath}`);
      if (pending !== null) {
        throw new SchemaError(`Task journal ${journalPath} has more than one uncommitted mutation intent.`);
      }
      pending = record;
      continue;
    }
    if (pending !== null && record.operationId === pending.operationId) {
      if (record.type !== pending.mutationKind || !matchesCompletion(recordWithoutOperationId(record), pending.completion)) {
        throw new SchemaError(`Mutation completion ${pending.operationId} does not match its journal intent.`);
      }
      pending = null;
    }
  }
  return pending;
}

async function mutationTargetsMatch(
  paths: VineaPaths,
  location: TaskLocation,
  expected: MutationTargetSummary,
): Promise<boolean> {
  for (const target of expected.files) {
    if (!isManagedMutationTarget(paths, location, target.path)) return false;
    const filename = assertInside(paths.repoRoot, resolve(paths.repoRoot, target.path));
    try {
      await assertNoSymlink(paths.repoRoot, filename);
      const contents = await readFile(filename);
      if (createHash("sha256").update(contents).digest("hex") !== target.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function isManagedMutationTarget(paths: VineaPaths, location: TaskLocation, target: string): boolean {
  const taskDirectory = relative(paths.repoRoot, location.directory).split("\\").join("/");
  const taskArtifact = target.startsWith(`${taskDirectory}/`)
    ? target.slice(taskDirectory.length + 1)
    : "";
  if (MUTATION_TASK_ARTIFACTS.has(taskArtifact)) return true;
  return target === ".vinea/specs/index.md"
    || /^\.vinea\/specs\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.test(target);
}

async function appendMutationCompletion(
  paths: VineaPaths,
  journalPath: string,
  intent: JournalMutationIntentEvent,
  operations: TransitionPersistenceOperations,
): Promise<void> {
  await operations.appendJournal(journalPath, { ...intent.completion, operationId: intent.operationId }, paths.repoRoot);
}

function taskMutationIdentity(
  event: Omit<TaskMutationJournalEvent, "operationId" | "mutationKind">,
  task: TaskRecord,
): Record<string, string> {
  if (event.requirementId !== undefined) {
    const collection = event.type === "requirement_added" ? task.requirements : task.acceptanceCriteria;
    return mutationValueIdentity(
      { requirementId: event.requirementId },
      collection.find((requirement) => requirement.id === event.requirementId),
    );
  }
  if (event.artifact !== undefined) return { artifact: event.artifact };
  if (event.path !== undefined) return { path: event.path };
  if (event.evidenceId !== undefined) return { evidenceId: event.evidenceId };
  if (event.learningCandidateId !== undefined) {
    return mutationValueIdentity(
      { learningCandidateId: event.learningCandidateId },
      task.learningCandidates?.find((candidate) => candidate.id === event.learningCandidateId),
    );
  }
  return { mutationKind: event.type };
}

export function mutationValueIdentity(
  identity: Record<string, string>,
  value: unknown,
): Record<string, string> {
  if (value === undefined) return identity;
  return {
    ...identity,
    valueSha256: createHash("sha256").update(stableJson(value)).digest("hex"),
  };
}

function mutationEventRequest(event: Omit<TaskMutationJournalEvent, "operationId" | "mutationKind">): Record<string, unknown> {
  const { timestamp: _timestamp, ...request } = event;
  return request;
}

function mutationRequestFingerprint(
  event: Omit<TaskMutationJournalEvent, "operationId" | "mutationKind">,
  task: TaskRecord,
): string {
  const request = mutationEventRequest(event);
  if (event.requirementId !== undefined) {
    const collection = event.type === "requirement_added" ? task.requirements : task.acceptanceCriteria;
    const requirement = collection.find((item) => item.id === event.requirementId);
    if (requirement !== undefined) request.text = requirement.text;
  } else if (event.type === "learning_proposed" && event.learningCandidateId !== undefined) {
    const candidate = task.learningCandidates?.find((item) => item.id === event.learningCandidateId);
    if (candidate !== undefined) {
      request.domain = candidate.domain;
      request.text = candidate.text;
      request.rationale = candidate.rationale;
    }
  } else if (event.type === "learning_archived" && event.learningCandidateId !== undefined) {
    const candidate = task.learningCandidates?.find((item) => item.id === event.learningCandidateId);
    if (candidate?.archiveReason !== undefined) request.reason = candidate.archiveReason;
  }
  return mutationFingerprint(request);
}

function isMutationIntent(value: Record<string, unknown>): value is Record<string, unknown> & JournalMutationIntentEvent {
  return value.schemaVersion === SCHEMA_VERSION
    && value.type === "mutation_intent"
    && typeof value.operationId === "string"
    && value.operationId !== ""
    && typeof value.timestamp === "string"
    && typeof value.actor === "string"
    && typeof value.mutationKind === "string"
    && typeof value.fingerprint === "string"
    && /^[a-f0-9]{64}$/u.test(value.fingerprint)
    && isMutationTargetSummary(value.expected)
    && isRecord(value.completion);
}

function isMutationTargetSummary(value: unknown): value is MutationTargetSummary {
  return isRecord(value)
    && isRecord(value.identity)
    && Object.values(value.identity).every((entry) => typeof entry === "string" && entry !== "")
    && Array.isArray(value.files)
    && value.files.length > 0
    && value.files.every((entry) => isRecord(entry)
      && typeof entry.path === "string"
      && typeof entry.sha256 === "string"
      && /^[a-f0-9]{64}$/u.test(entry.sha256));
}

function matchesCompletion(
  left: Omit<MutationCompletionEvent, "operationId">,
  right: Omit<MutationCompletionEvent, "operationId">,
): boolean {
  return stableJson(left) === stableJson(right);
}

function recordWithoutOperationId(value: Record<string, unknown>): Omit<MutationCompletionEvent, "operationId"> {
  const result = { ...value };
  delete result.operationId;
  return result as Omit<MutationCompletionEvent, "operationId">;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function assertNoPendingTaskTransition(
  paths: VineaPaths,
  location: TaskLocation,
): Promise<void> {
  const pending = await readPendingTransitionIntent(
    paths,
    join(location.directory, "journal.md"),
    location.task.status,
  );
  if (pending !== null) {
    throw new TransitionError(
      `Task ${location.task.id} has a pending ${pending.oldStatus} -> ${pending.newStatus} transition; retry that transition before recording task changes.`,
    );
  }
}

export async function assertNoPendingTaskMutation(
  paths: VineaPaths,
  location: TaskLocation,
): Promise<void> {
  const pending = await readPendingTaskMutationIntent(paths, join(location.directory, "journal.md"));
  if (pending !== null) {
    throw new TransitionError(
      `Task ${location.task.id} has a pending ${pending.mutationKind} mutation; retry that exact mutation before recording another task change.`,
    );
  }
}

export async function appendTaskMutationIntent(
  paths: VineaPaths,
  location: TaskLocation,
  event: Omit<TaskMutationJournalEvent, "operationId" | "mutationKind">,
  operationOverrides: Partial<TransitionPersistenceOperations> = {},
): Promise<TaskMutationJournalEvent> {
  return withTaskLock(paths, location.task.id, () => appendTaskMutationIntentLocked(paths, location, event, operationOverrides));
}

async function appendTaskMutationIntentLocked(
  paths: VineaPaths,
  location: TaskLocation,
  event: Omit<TaskMutationJournalEvent, "operationId" | "mutationKind">,
  operationOverrides: Partial<TransitionPersistenceOperations>,
): Promise<TaskMutationJournalEvent> {
  const operations = { ...DEFAULT_TRANSITION_OPERATIONS, ...operationOverrides };
  await assertNoPendingTaskTransition(paths, location);
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
  return withTaskLock(paths, location.task.id, () => appendTaskContinuationLocked(paths, location, event));
}

async function appendTaskContinuationLocked(
  paths: VineaPaths,
  location: TaskLocation,
  event: JournalContinuationEvent,
): Promise<void> {
  await assertNoPendingTaskTransition(paths, location);
  await assertNoPendingTaskMutation(paths, location);
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

export async function readLatestEvidence(paths: VineaPaths, location: TaskLocation): Promise<EvidenceRecord | null> {
  const filename = join(location.directory, "evidence.jsonl");
  const records = await readJsonlRecords(paths.repoRoot, filename);
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
  paths: VineaPaths,
  location: TaskLocation,
): Promise<Record<string, unknown> | null> {
  const filename = join(location.directory, "journal.md");
  const events = await readJsonlRecords(paths.repoRoot, filename);
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
  return withTaskLock(paths, location.task.id, () => writeTaskArtifactLocked(paths, location, artifact, contents));
}

async function writeTaskArtifactLocked(
  paths: VineaPaths,
  location: TaskLocation,
  artifact: "brief.md" | "plan.md",
  contents: string,
): Promise<void> {
  await assertNoPendingTaskTransition(paths, location);
  await writeTaskTextArtifact(paths, location, artifact, contents);
}

export async function writeCheckArtifact(
  paths: VineaPaths,
  location: TaskLocation,
  contents: string,
): Promise<void> {
  return withTaskLock(paths, location.task.id, () => writeCheckArtifactLocked(paths, location, contents));
}

async function writeCheckArtifactLocked(
  paths: VineaPaths,
  location: TaskLocation,
  contents: string,
): Promise<void> {
  await assertNoPendingTaskTransition(paths, location);
  await writeTaskTextArtifact(paths, location, "check.md", contents);
}

export async function removeTaskSessionBindings(
  paths: VineaPaths,
  taskId: string,
): Promise<string[]> {
  await assertNoSymlink(paths.repoRoot, paths.sessions);
  let entries;
  try {
    entries = await readdir(paths.sessions, { withFileTypes: true });
  } catch (error) {
    if (isCode(error, "ENOENT")) return [];
    throw new SchemaError(`Unable to list session bindings in ${paths.sessions}`, error);
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const filename = join(paths.sessions, entry.name);
    await assertNoSymlink(paths.repoRoot, filename);
    let value: unknown;
    try {
      value = JSON.parse(await readFile(filename, "utf8")) as unknown;
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw new SchemaError(`Unable to inspect session binding ${filename}`, error);
    }
    if (!isSessionBinding(value) || value.taskId !== taskId) continue;
    try {
      await unlink(filename);
      removed.push(filename);
    } catch (error) {
      if (!isCode(error, "ENOENT")) {
        throw new SchemaError(`Unable to remove session binding ${filename}`, error);
      }
    }
  }
  return removed;
}

async function writeTaskTextArtifact(
  paths: VineaPaths,
  location: TaskLocation,
  artifact: "brief.md" | "plan.md" | "check.md",
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

export async function withTaskLock<T>(
  paths: VineaPaths,
  taskId: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!TASK_ID_PATTERN.test(taskId)) throw new ValidationError(`Invalid task ID: ${taskId}`);
  const key = `${paths.repoRoot}\0${taskId}`;
  const inherited = taskLockContext.getStore();
  if (inherited?.has(key)) return operation();

  const lock = await acquireTaskLock(paths, taskId);
  const context = new Set(inherited ?? []);
  context.add(key);
  try {
    return await taskLockContext.run(context, operation);
  } finally {
    await releaseTaskLock(paths, lock);
  }
}

interface TaskLock {
  directory: string;
  ownerPath: string;
  token: string;
}

async function acquireTaskLock(paths: VineaPaths, taskId: string): Promise<TaskLock> {
  const locks = join(paths.runtime, "task-locks");
  const directory = join(locks, `${taskId}.lock`);
  const ownerPath = join(directory, "owner.json");
  const token = randomUUID();
  const deadline = Date.now() + TASK_LOCK_TIMEOUT_MILLISECONDS;
  await ensureDirectory(paths.repoRoot, locks);
  for (;;) {
    await assertNoSymlink(paths.repoRoot, directory);
    try {
      await mkdir(directory);
    } catch (error) {
      if (!isCode(error, "EEXIST")) {
        throw new SchemaError(`Unable to acquire task lock for ${taskId}`, error);
      }
      if (Date.now() >= deadline) {
        throw new ValidationError(
          `Task ${taskId} is busy in another Vinea process; wait for it to finish and retry. Vinea will not remove a lock it does not own.`,
        );
      }
      await delay(TASK_LOCK_RETRY_MILLISECONDS);
      continue;
    }
    try {
      await writeFile(ownerPath, `${JSON.stringify({ token, pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      try {
        await rmdir(directory);
      } catch (cleanupError) {
        if (!isCode(cleanupError, "ENOENT")) {
          throw new SchemaError(`Unable to initialize task lock for ${taskId}; empty lock cleanup failed`, {
            error,
            cleanupError,
          });
        }
      }
      throw new SchemaError(`Unable to initialize task lock for ${taskId}`, error);
    }
    return { directory, ownerPath, token };
  }
}

async function releaseTaskLock(paths: VineaPaths, lock: TaskLock): Promise<void> {
  await assertNoSymlink(paths.repoRoot, lock.ownerPath);
  let owner: unknown;
  try {
    owner = JSON.parse(await readFile(lock.ownerPath, "utf8")) as unknown;
  } catch (error) {
    throw new SchemaError(`Unable to verify task lock ownership at ${lock.directory}`, error);
  }
  if (!isRecord(owner) || owner.token !== lock.token) {
    throw new SchemaError(`Task lock ownership changed at ${lock.directory}; refusing unsafe cleanup.`);
  }
  await removeOwnedTaskLock(lock.directory, lock.ownerPath, lock.token);
}

async function removeOwnedTaskLock(directory: string, ownerPath: string, token: string): Promise<void> {
  try {
    const owner = JSON.parse(await readFile(ownerPath, "utf8")) as unknown;
    if (!isRecord(owner) || owner.token !== token) return;
    await unlink(ownerPath);
    await rmdir(directory);
  } catch (error) {
    if (isCode(error, "ENOENT")) return;
    throw new SchemaError(`Unable to release owned task lock ${directory}`, error);
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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
    && isLearningCandidateCollection(value.learningCandidates)
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

function isLearningCandidateCollection(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)
      || candidate.schemaVersion !== SCHEMA_VERSION
      || typeof candidate.id !== "string"
      || candidate.id.trim() === ""
      || ids.has(candidate.id)
      || typeof candidate.domain !== "string"
      || candidate.domain.trim() === ""
      || typeof candidate.text !== "string"
      || candidate.text.trim() === ""
      || typeof candidate.rationale !== "string"
      || candidate.rationale.trim() === ""
      || !isIsoTimestamp(candidate.proposedAt)) {
      return false;
    }
    ids.add(candidate.id);
    if (candidate.status === "proposed") continue;
    if (candidate.status === "accepted"
      && candidate.confirmedBy === "user"
      && isIsoTimestamp(candidate.acceptedAt)) {
      continue;
    }
    if (candidate.status === "archived"
      && typeof candidate.archiveReason === "string"
      && candidate.archiveReason.trim() !== ""
      && isIsoTimestamp(candidate.archivedAt)) {
      continue;
    }
    return false;
  }
  return true;
}

function isCommitMetadata(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !["sha", "message"].includes(key))) return false;
  return typeof value.sha === "string"
    && value.sha.trim() !== ""
    && (value.message === undefined || typeof value.message === "string");
}

async function readPendingTransitionIntent(
  paths: VineaPaths,
  filename: string,
  taskStatus: TaskRecord["status"],
): Promise<JournalTransitionIntentEvent | null> {
  const records = await readJsonlRecords(paths.repoRoot, filename);
  const candidate = records.at(-1);
  if (!isTransitionIntent(candidate) || candidate.oldStatus !== taskStatus) return null;
  return candidate;
}

function isTransitionIntent(value: unknown): value is JournalTransitionIntentEvent {
  return isRecord(value)
    && value.schemaVersion === SCHEMA_VERSION
    && value.type === "transition_intent"
    && typeof value.operationId === "string"
    && typeof value.timestamp === "string"
    && typeof value.actor === "string"
    && typeof value.reason === "string"
    && isTaskStatus(value.oldStatus)
    && isTaskStatus(value.newStatus);
}

function isTaskStatus(value: unknown): value is TaskRecord["status"] {
  return value === "planning"
    || value === "ready"
    || value === "in_progress"
    || value === "checking"
    || value === "finished"
    || value === "archived"
    || value === "blocked";
}

async function readJsonlRecords(repoRoot: string, filename: string): Promise<unknown[]> {
  await assertNoSymlink(repoRoot, filename);
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
