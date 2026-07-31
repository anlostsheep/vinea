import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { promisify } from "node:util";
import { assertNoSymlink, type VineaPaths } from "./paths.js";
import { inspectWorkspace, type DoctorReport as WorkspaceDoctorReport } from "./schema.js";

const execFileAsync = promisify(execFile);

export interface DoctorReport extends WorkspaceDoctorReport {
  taskLocks: TaskLockDiagnostic[];
  gitStatus: {
    available: boolean;
    error: string | null;
  };
}

export interface TaskLockDiagnostic {
  path: string;
  taskId: string | null;
  ageMilliseconds: number | null;
  owner: {
    status: "missing" | "malformed" | "valid" | "unreadable" | "unsafe";
    token?: string;
  };
  recoveryInstruction: string;
}

const TASK_LOCK_FILENAME = /^(t-\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*)\.lock$/;

export async function diagnoseWorkspace(paths: VineaPaths): Promise<DoctorReport> {
  const [workspace, runtimeSessions, taskLocks, gitStatus] = await Promise.all([
    inspectWorkspace(paths),
    inspectRuntimeSessions(paths),
    inspectTaskLocks(paths),
    inspectGitAvailability(paths.repoRoot),
  ]);
  const missingRequiredDirectories = workspace.missingRequiredDirectories.filter(
    (directory) => directory !== ".runtime/sessions" || runtimeSessions !== "missing",
  );
  if (runtimeSessions === "invalid" && !missingRequiredDirectories.includes(".runtime/sessions")) {
    missingRequiredDirectories.push(".runtime/sessions");
  }
  return {
    ...workspace,
    missingRequiredDirectories,
    migrationGuidance: runtimeSessions === "invalid" && workspace.migrationGuidance === null
      ? "Repair or remove malformed local .runtime/sessions state before using session recovery."
      : workspace.migrationGuidance,
    healthy: workspace.supportedSchema && missingRequiredDirectories.length === 0 && taskLocks.length === 0,
    taskLocks,
    gitStatus,
  };
}

async function inspectTaskLocks(paths: VineaPaths): Promise<TaskLockDiagnostic[]> {
  const locksDirectory = join(paths.runtime, "task-locks");
  let entries: string[];
  try {
    await assertNoSymlink(paths.repoRoot, locksDirectory);
    const locks = await lstat(locksDirectory);
    if (!locks.isDirectory() || locks.isSymbolicLink()) {
      return [taskLockDiagnostic(paths, locksDirectory, null, null, { status: "unsafe" })];
    }
    entries = await readdir(locksDirectory);
  } catch (error) {
    if (isMissing(error)) return [];
    return [taskLockDiagnostic(paths, locksDirectory, null, null, { status: "unreadable" })];
  }

  const diagnostics = await Promise.all(entries.map(async (entry) => inspectTaskLock(paths, join(locksDirectory, entry))));
  return diagnostics.sort((left, right) => left.path.localeCompare(right.path));
}

async function inspectTaskLock(paths: VineaPaths, directory: string): Promise<TaskLockDiagnostic> {
  const filename = basename(directory);
  const taskId = TASK_LOCK_FILENAME.exec(filename)?.[1] ?? null;
  let ageMilliseconds: number | null = null;
  try {
    await assertNoSymlink(paths.repoRoot, directory);
    const entry = await lstat(directory);
    ageMilliseconds = Math.max(0, Date.now() - entry.mtimeMs);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      return taskLockDiagnostic(paths, directory, taskId, ageMilliseconds, { status: "unsafe" });
    }
  } catch {
    return taskLockDiagnostic(paths, directory, taskId, ageMilliseconds, { status: "unsafe" });
  }

  const owner = await inspectTaskLockOwner(paths, join(directory, "owner.json"));
  return taskLockDiagnostic(paths, directory, taskId, ageMilliseconds, owner);
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
  owner: TaskLockDiagnostic["owner"],
): TaskLockDiagnostic {
  const path = displayPath(paths, directory);
  return {
    path,
    taskId,
    ageMilliseconds,
    owner,
    recoveryInstruction: `Confirm no active process, then remove exact lock directory ${path}.`,
  };
}

async function inspectRuntimeSessions(paths: VineaPaths): Promise<"missing" | "usable" | "invalid"> {
  try {
    await assertNoSymlink(paths.repoRoot, paths.sessions);
    const entry = await lstat(paths.sessions);
    if (!entry.isDirectory() || entry.isSymbolicLink()) return "invalid";
    await readdir(paths.sessions);
    return "usable";
  } catch (error) {
    return isMissing(error) ? "missing" : "invalid";
  }
}

async function inspectGitAvailability(repoRoot: string): Promise<DoctorReport["gitStatus"]> {
  try {
    await execFileAsync("git", ["--no-optional-locks", "status", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    return { available: true, error: null };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "Unable to run git status --porcelain.",
    };
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayPath(paths: VineaPaths, filename: string): string {
  return relative(paths.repoRoot, filename).split("\\").join("/");
}
