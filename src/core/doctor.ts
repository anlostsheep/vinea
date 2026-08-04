import { execFile } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { assertNoSymlink, type VineaPaths } from "./paths.js";
import { readSchemaMigrationState } from "./migration-state.js";
import { inspectWorkspace, type DoctorReport as WorkspaceDoctorReport } from "./schema.js";
import { inspectTaskLocks, type TaskLockDiagnostic } from "./task-locks.js";
import { validateWorkspace, type ValidationIssue } from "./validate.js";

const execFileAsync = promisify(execFile);

export interface DoctorReport extends WorkspaceDoctorReport {
  taskLocks: TaskLockDiagnostic[];
  rework: ReworkDiagnostic[];
  migration: {
    status: "none" | "pending" | "completed" | "invalid";
    operationId?: string;
  };
  gitStatus: {
    available: boolean;
    error: string | null;
  };
}

export interface ReworkDiagnostic {
  taskId: string;
  status: "pending" | "invalid";
  issues: ValidationIssue[];
}

export type { TaskLockDiagnostic } from "./task-locks.js";

export async function diagnoseWorkspace(paths: VineaPaths): Promise<DoctorReport> {
  const [workspace, runtimeSessions, taskLocks, migration, gitStatus, validation] = await Promise.all([
    inspectWorkspace(paths),
    inspectRuntimeSessions(paths),
    inspectTaskLocks(paths),
    inspectSchemaMigration(paths),
    inspectGitAvailability(paths.repoRoot),
    validateWorkspace(paths),
  ]);
  const rework = workspace.supportedSchema ? collectReworkDiagnostics(validation.issues) : [];
  const missingRequiredDirectories = workspace.missingRequiredDirectories.filter(
    (directory) => directory !== ".runtime/sessions" || runtimeSessions !== "missing",
  );
  if (runtimeSessions === "invalid" && !missingRequiredDirectories.includes(".runtime/sessions")) {
    missingRequiredDirectories.push(".runtime/sessions");
  }
  return {
    ...workspace,
    missingRequiredDirectories,
    migrationGuidance: migration.status === "pending"
      ? `Schema migration ${migration.operationId} is incomplete. Run \`vinea migrate\` to resume it.`
      : migration.status === "invalid"
        ? "Repair or restore .runtime/schema-migration.json before using lifecycle commands."
        : rework.length > 0 && rework[0]!.status === "pending"
          ? `Task ${rework[0]!.taskId} has a pending rework. Run \`vinea task show ${rework[0]!.taskId}\` to resume it before continuing work.`
          : rework.length > 0
            ? `Task ${rework[0]!.taskId} has invalid rework history. Run \`vinea validate\` and repair the reported records before continuing work.`
        : runtimeSessions === "invalid" && workspace.migrationGuidance === null
          ? "Repair or remove malformed local .runtime/sessions state before using session recovery."
          : workspace.migrationGuidance,
    healthy: workspace.supportedSchema
      && missingRequiredDirectories.length === 0
      && taskLocks.length === 0
      && rework.length === 0
      && migration.status !== "pending"
      && migration.status !== "invalid",
    taskLocks,
    rework,
    migration,
    gitStatus,
  };
}

function collectReworkDiagnostics(issues: ValidationIssue[]): ReworkDiagnostic[] {
  const byTask = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    if (!isReworkValidationIssue(issue.code)) continue;
    const taskId = issue.path.match(/^\.vinea\/tasks\/(?:active|archive)\/([^/]+)\//u)?.[1] ?? "unknown";
    const taskIssues = byTask.get(taskId) ?? [];
    taskIssues.push(issue);
    byTask.set(taskId, taskIssues);
  }
  return [...byTask.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([taskId, taskIssues]) => ({
      taskId,
      status: taskIssues.some(({ code }) => isInvalidReworkCode(code)) ? "invalid" : "pending",
      issues: taskIssues,
    }));
}

function isReworkValidationIssue(code: string): boolean {
  return code.startsWith("REWORK_")
    || code.startsWith("CHECK_HISTORY_")
    || code === "JOURNAL_REWORK_DISCONTINUITY"
    || code === "JOURNAL_TASK_REVISION_MISMATCH"
    || code === "EVIDENCE_REVISION_INVALID"
    || code === "CHECK_PAYLOAD_INVALID";
}

function isInvalidReworkCode(code: string): boolean {
  return code === "REWORK_COMPLETION_ORPHAN"
    || code === "REWORK_COMPLETION_MISMATCH"
    || code === "REWORK_INTENT_DUPLICATE"
    || code === "JOURNAL_REWORK_DISCONTINUITY"
    || code === "CHECK_HISTORY_OPERATION_DUPLICATE"
    || code === "CHECK_HISTORY_REVISION_DUPLICATE"
    || code === "CHECK_HISTORY_ORPHAN"
    || code === "JOURNAL_TASK_REVISION_MISMATCH"
    || code === "EVIDENCE_REVISION_INVALID"
    || code === "CHECK_PAYLOAD_INVALID";
}

async function inspectSchemaMigration(
  paths: VineaPaths,
): Promise<DoctorReport["migration"]> {
  try {
    const state = await readSchemaMigrationState(paths);
    if (state === null) return { status: "none" };
    return state.phase === "intent"
      ? { status: "pending", operationId: state.operationId }
      : { status: "completed", operationId: state.operationId };
  } catch {
    return { status: "invalid" };
  }
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
