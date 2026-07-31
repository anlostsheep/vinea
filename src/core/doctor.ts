import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VineaPaths } from "./paths.js";
import { inspectWorkspace, type DoctorReport as WorkspaceDoctorReport } from "./schema.js";

const execFileAsync = promisify(execFile);

export interface DoctorReport extends WorkspaceDoctorReport {
  gitStatus: {
    available: boolean;
    error: string | null;
  };
}

export async function diagnoseWorkspace(paths: VineaPaths): Promise<DoctorReport> {
  const [workspace, gitStatus] = await Promise.all([
    inspectWorkspace(paths),
    inspectGitAvailability(paths.repoRoot),
  ]);
  return {
    ...workspace,
    missingRequiredDirectories: workspace.missingRequiredDirectories.filter(
      (directory) => directory !== ".runtime/sessions",
    ),
    healthy: workspace.supportedSchema
      && workspace.missingRequiredDirectories.every(
        (directory) => directory === ".runtime/sessions",
      ),
    gitStatus,
  };
}

async function inspectGitAvailability(repoRoot: string): Promise<DoctorReport["gitStatus"]> {
  try {
    await execFileAsync("git", ["status", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return { available: true, error: null };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "Unable to run git status --porcelain.",
    };
  }
}
