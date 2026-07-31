import { execFile } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { assertNoSymlink, type VineaPaths } from "./paths.js";
import { inspectWorkspace, type DoctorReport as WorkspaceDoctorReport } from "./schema.js";

const execFileAsync = promisify(execFile);

export interface DoctorReport extends WorkspaceDoctorReport {
  gitStatus: {
    available: boolean;
    error: string | null;
  };
}

export async function diagnoseWorkspace(paths: VineaPaths): Promise<DoctorReport> {
  const [workspace, runtimeSessions, gitStatus] = await Promise.all([
    inspectWorkspace(paths),
    inspectRuntimeSessions(paths),
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
    healthy: workspace.supportedSchema && missingRequiredDirectories.length === 0,
    gitStatus,
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
