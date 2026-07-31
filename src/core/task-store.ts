import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { AmbiguousTaskError, SchemaError, ValidationError } from "./errors.js";
import { appendJsonl, readJson, writeJsonAtomic } from "./json.js";
import { assertNoSymlink, type VineaPaths } from "./paths.js";
import {
  SCHEMA_VERSION,
  type JournalCreationEvent,
  type JournalTransitionEvent,
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
  event: JournalTransitionEvent,
): Promise<TaskLocation> {
  const taskPath = join(location.directory, "task.json");
  const journalPath = join(location.directory, "journal.md");
  const destination = task.status === "archived" ? join(paths.archivedTasks, task.id) : undefined;
  await assertNoSymlink(paths.repoRoot, journalPath);
  if (destination !== undefined) await assertNoSymlink(paths.repoRoot, destination);
  let previousJournal: string;
  try {
    previousJournal = await readFile(journalPath, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read task journal for ${task.id}`, error);
  }

  try {
    await writeJsonAtomic(taskPath, task, paths.repoRoot);
    await appendJsonl(journalPath, event, paths.repoRoot);
    if (destination === undefined) return { ...location, task };
    try {
      await rename(location.directory, destination);
    } catch (error) {
      throw new SchemaError(`Unable to archive task ${task.id}`, error);
    }
  } catch (error) {
    const rollback = await Promise.allSettled([
      writeJsonAtomic(taskPath, location.task, paths.repoRoot),
      writeTextAtomic(journalPath, previousJournal, paths.repoRoot),
    ]);
    const rollbackFailures = rollback.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rollbackFailures.length > 0) {
      throw new SchemaError(`Task transition failed and rollback was incomplete for ${task.id}`, {
        transitionError: error,
        rollbackErrors: rollbackFailures.map(({ reason }) => reason),
      });
    }
    throw error;
  }
  return { task, directory: destination, scope: "archive" };
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

async function writeTextAtomic(filename: string, contents: string, repoRoot: string): Promise<void> {
  await assertNoSymlink(repoRoot, filename);
  const temporary = join(dirname(filename), `.${basename(filename)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporary, filename);
  } catch (error) {
    await rm(temporary, { force: true });
    throw new SchemaError(`Unable to restore ${filename}`, error);
  }
}

function isCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
