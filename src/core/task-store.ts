import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AmbiguousTaskError, SchemaError, ValidationError } from "./errors.js";
import { appendJsonl, readJson, writeJsonAtomic } from "./json.js";
import { assertNoSymlink, type VineaPaths } from "./paths.js";
import {
  SCHEMA_VERSION,
  type JournalCreationEvent,
  type JournalTransitionDetails,
  type JournalTransitionIntentEvent,
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

async function findInScope(
  paths: VineaPaths,
  root: string,
  scope: "active" | "archive",
  taskId: string,
): Promise<TaskLocation[]> {
  const direct = join(root, taskId);
  if (!(await isDirectory(direct))) return [];
  return [await loadLocation(paths, direct, scope)];
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
      .map((entry) => loadLocation(paths, join(root, entry.name), scope)),
  );
}

async function loadLocation(
  paths: VineaPaths,
  directory: string,
  scope: "active" | "archive",
): Promise<TaskLocation> {
  const task = await readJson<TaskRecord>(join(directory, "task.json"), paths.repoRoot);
  if (task.schemaVersion !== SCHEMA_VERSION || typeof task.id !== "string") {
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
