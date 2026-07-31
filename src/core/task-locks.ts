import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { assertNoSymlink, type VineaPaths } from "./paths.js";

export interface TaskLockDiagnostic {
  path: string;
  taskId: string | null;
  ageMilliseconds: number | null;
  status:
    | "retained"
    | "directory_invalid"
    | "owner_missing"
    | "owner_malformed"
    | "owner_unreadable"
    | "owner_unsafe";
  owner: {
    status: "missing" | "malformed" | "valid" | "unreadable" | "unsafe";
    token?: string;
  };
  recoveryInstruction: string;
}

const TASK_LOCK_FILENAME = /^(t-\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*)\.lock$/;
const PROMOTION_LOCK_DIRECTORY = "learning-promotion.lock";

// This is intentionally diagnostic only: it does not claim, remove, or infer
// the liveness of any lock. Both doctor and validate use this same safe scan.
export async function inspectTaskLocks(paths: VineaPaths): Promise<TaskLockDiagnostic[]> {
  const locksDirectory = join(paths.runtime, "task-locks");
  let entries: string[];
  try {
    await assertNoSymlink(paths.repoRoot, locksDirectory);
    const locks = await lstat(locksDirectory);
    await assertNoSymlink(paths.repoRoot, locksDirectory);
    if (!locks.isDirectory() || locks.isSymbolicLink()) {
      return [
        taskLockDiagnostic(paths, locksDirectory, null, null, "directory_invalid", { status: "unsafe" }),
        ...await inspectNamedRuntimeLock(paths, join(paths.runtime, PROMOTION_LOCK_DIRECTORY)),
      ].sort((left, right) => left.path.localeCompare(right.path));
    }
    entries = await readdir(locksDirectory);
    await assertNoSymlink(paths.repoRoot, locksDirectory);
  } catch (error) {
    if (isMissing(error)) {
      return inspectNamedRuntimeLock(paths, join(paths.runtime, PROMOTION_LOCK_DIRECTORY));
    }
    return [
      taskLockDiagnostic(paths, locksDirectory, null, null, "directory_invalid", { status: "unsafe" }),
      ...await inspectNamedRuntimeLock(paths, join(paths.runtime, PROMOTION_LOCK_DIRECTORY)),
    ].sort((left, right) => left.path.localeCompare(right.path));
  }

  const diagnostics = await Promise.all(entries.map(async (entry) => inspectTaskLock(paths, join(locksDirectory, entry))));
  const promotionLock = await inspectNamedRuntimeLock(paths, join(paths.runtime, PROMOTION_LOCK_DIRECTORY));
  return [...diagnostics, ...promotionLock].sort((left, right) => left.path.localeCompare(right.path));
}

async function inspectNamedRuntimeLock(paths: VineaPaths, directory: string): Promise<TaskLockDiagnostic[]> {
  try {
    await assertNoSymlink(paths.repoRoot, directory);
    await lstat(directory);
    await assertNoSymlink(paths.repoRoot, directory);
  } catch (error) {
    if (isMissing(error)) return [];
    return [taskLockDiagnostic(paths, directory, null, null, "directory_invalid", { status: "unsafe" })];
  }
  return [await inspectTaskLock(paths, directory)];
}

async function inspectTaskLock(paths: VineaPaths, directory: string): Promise<TaskLockDiagnostic> {
  const taskId = TASK_LOCK_FILENAME.exec(basename(directory))?.[1] ?? null;
  let ageMilliseconds: number | null = null;
  try {
    await assertNoSymlink(paths.repoRoot, directory);
    const entry = await lstat(directory);
    await assertNoSymlink(paths.repoRoot, directory);
    ageMilliseconds = Math.max(0, Date.now() - entry.mtimeMs);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      return taskLockDiagnostic(paths, directory, taskId, ageMilliseconds, "directory_invalid", { status: "unsafe" });
    }
  } catch {
    return taskLockDiagnostic(paths, directory, taskId, ageMilliseconds, "directory_invalid", { status: "unsafe" });
  }

  const owner = await inspectTaskLockOwner(paths, join(directory, "owner.json"));
  const status = owner.status === "valid" ? "retained" : `owner_${owner.status}` as Exclude<TaskLockDiagnostic["status"], "retained" | "directory_invalid">;
  return taskLockDiagnostic(paths, directory, taskId, ageMilliseconds, status, owner);
}

async function inspectTaskLockOwner(
  paths: VineaPaths,
  ownerPath: string,
): Promise<TaskLockDiagnostic["owner"]> {
  try {
    await assertNoSymlink(paths.repoRoot, ownerPath);
  } catch (error) {
    return isMissing(error) ? { status: "missing" } : { status: "unsafe" };
  }
  let contents: string;
  try {
    contents = await readFile(ownerPath, "utf8");
  } catch (error) {
    return isMissing(error) ? { status: "missing" } : { status: "unreadable" };
  }
  try {
    await assertNoSymlink(paths.repoRoot, ownerPath);
  } catch (error) {
    return isMissing(error) ? { status: "missing" } : { status: "unsafe" };
  }
  try {
    const owner = JSON.parse(contents) as unknown;
    if (!isRecord(owner) || typeof owner.token !== "string" || owner.token.trim() === "") {
      return { status: "malformed" };
    }
    return { status: "valid", token: owner.token };
  } catch {
    return { status: "malformed" };
  }
}

function taskLockDiagnostic(
  paths: VineaPaths,
  directory: string,
  taskId: string | null,
  ageMilliseconds: number | null,
  status: TaskLockDiagnostic["status"],
  owner: TaskLockDiagnostic["owner"],
): TaskLockDiagnostic {
  const path = relative(paths.repoRoot, directory).split("\\").join("/");
  return {
    path,
    taskId,
    ageMilliseconds,
    status,
    owner,
    recoveryInstruction: `Confirm no active process, then remove exact lock directory ${path}.`,
  };
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
