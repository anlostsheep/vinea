import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_CONFIG, readConfig } from "./config.js";
import { readCheckForLocation, renderCheckDocument } from "./check.js";
import { listContextReferences } from "./context.js";
import { FinishGateError, SchemaError, TransitionError, ValidationError } from "./errors.js";
import { assertTddReadyForCheck } from "./evidence.js";
import { inspectBusinessGitStatus } from "./git.js";
import {
  appendTaskContinuation,
  assertNoPendingTaskMutation,
  assertNoPendingTaskTransition,
  assertTaskMutable,
  createTaskArtifacts,
  executeTaskMutation,
  findTask,
  hasMatchingPendingTaskTransition,
  listStoredTasks,
  mutationFingerprint,
  mutationTargetSummary,
  mutationValueIdentity,
  persistTaskTransition,
  readLatestCheckEvent,
  readLatestEvidence,
  readSessionBinding,
  removeTaskSessionBindings,
  sessionBindingPath,
  writeSessionBinding,
  writeManagedMutationTarget,
  withTaskLock,
  type TaskLocation,
} from "./task-store.js";
import { assertInside, assertNoSymlink, type VineaPaths } from "./paths.js";
import { inspectWorkspace } from "./schema.js";
import { validateTaskStructure } from "./validate.js";
import {
  SCHEMA_VERSION,
  type ContinuationResult,
  type CheckRow,
  type CheckHistorySnapshot,
  type ExecutionMode,
  type Host,
  type InlineAuditRecord,
  type JournalContinuationEvent,
  type JournalCreationEvent,
  type JournalReworkIntentEvent,
  type JournalReworkedEvent,
  type JournalTransitionDetails,
  type OrientBinding,
  type OrientCandidate,
  type OrientSummary,
  type QualityMode,
  type RiskSuggestion,
  type SessionBinding,
  type TaskRecord,
  type TaskStatus,
  type TaskView,
  type VineaConfig,
} from "./types.js";
import { appendJsonl, writeJsonAtomic } from "./json.js";

type Clock = () => Date;
type RiskRules = VineaConfig["riskRules"];
const execFileAsync = promisify(execFile);

export interface CreateTaskInput {
  title: string;
  risk: RiskSuggestion;
  qualityMode: QualityMode;
  executionMode: ExecutionMode;
  confirmation: "user";
}

export interface CreatedTask {
  task: TaskRecord;
  directory: string;
}

export interface TransitionOptions {
  actor: string;
  reason: string;
  unblock?: boolean;
  now?: Clock;
}

export interface OrientInput {
  host: Host;
  sessionId?: string;
}

export interface ContinueTaskInput {
  host: Host;
  sessionId?: string;
  confirmed: boolean;
  start?: boolean;
  reason?: string;
  now?: Clock;
}

export interface InlineAuditInput {
  title: string;
  description: string;
  proposedRisk: RiskSuggestion;
  reason: string;
}

export interface RequirementInput {
  id: string;
  text: string;
  actor: string;
}

export interface TaskDocumentResult {
  taskId: string;
  artifact: "brief.md" | "plan.md";
  estimatedBytes: number;
}

export interface CompletionInput {
  confirmed: boolean;
  actor: string;
  now?: Clock;
}

export interface ReworkInput {
  actor: string;
  reason: string;
  now?: Clock;
}

export interface CheckHistoryRevisionSummary {
  verificationRevision: number;
  archivedAt: string;
  reworkReason: string;
  operationId: string;
  totals: {
    total: number;
    pass: number;
    fail: number;
    uncovered: number;
  };
}

export interface CheckHistoryListing {
  taskId: string;
  revisions: CheckHistoryRevisionSummary[];
}

export interface ArchiveOperations {
  removeTaskSessionBindings(paths: VineaPaths, taskId: string): Promise<string[]>;
}

export interface ReworkPersistenceOperations {
  appendJournal(filename: string, value: unknown, repoRoot: string): Promise<void>;
  appendHistory(filename: string, value: unknown, repoRoot: string): Promise<void>;
  writeCheck(paths: VineaPaths, location: TaskLocation, contents: string): Promise<void>;
  writeTask(filename: string, value: unknown, repoRoot: string): Promise<void>;
}

const DEFAULT_ARCHIVE_OPERATIONS: ArchiveOperations = { removeTaskSessionBindings };
const DEFAULT_REWORK_OPERATIONS: ReworkPersistenceOperations = {
  appendJournal: appendJsonl,
  appendHistory: appendJsonl,
  writeCheck: (paths, location, contents) => writeManagedMutationTarget(
    paths,
    location,
    join(location.directory, "check.md"),
    contents,
  ),
  writeTask: writeJsonAtomic,
};

const FORWARD_TRANSITIONS: Partial<Record<TaskStatus, TaskStatus>> = {
  planning: "ready",
  ready: "in_progress",
  in_progress: "checking",
  checking: "finished",
  finished: "archived",
};

const BLOCKABLE = new Set<TaskStatus>(["planning", "ready", "in_progress", "checking"]);
const UNBLOCK_TARGETS = new Set<TaskStatus>(["ready", "in_progress", "checking"]);

export function suggestRisk(
  title: string,
  description: string,
  changedPaths: string[] = [],
  rules: RiskRules = DEFAULT_CONFIG.riskRules,
): RiskSuggestion {
  const searchable = normalize([title, description, ...changedPaths].join(" "));
  const matchedHigh = matchedRules(searchable, rules.high);
  const matchedMedium = matchedRules(searchable, rules.medium);
  const reasons = [...matchedHigh, ...matchedMedium.filter((reason) => !matchedHigh.includes(reason))];
  return {
    level: matchedHigh.length > 0 ? "high" : matchedMedium.length > 0 ? "medium" : "low",
    reasons,
  };
}

export async function createTask(
  paths: VineaPaths,
  input: CreateTaskInput,
  now: Clock = () => new Date(),
): Promise<CreatedTask> {
  await readConfig(paths);
  assertNonempty(input.title, "Task title");
  const timestamp = now().toISOString();
  const slug = slugify(input.title);
  const id = `t-${formatTaskTimestamp(new Date(timestamp))}-${slug}`;
  const task: TaskRecord = {
    schemaVersion: SCHEMA_VERSION,
    id,
    title: input.title.trim(),
    status: "planning",
    risk: { level: input.risk.level, reasons: [...input.risk.reasons] },
    qualityMode: input.qualityMode,
    executionMode: input.executionMode,
    verificationRevision: 0,
    requirements: [],
    acceptanceCriteria: [],
    commit: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const event: JournalCreationEvent = {
    schemaVersion: SCHEMA_VERSION,
    type: "created",
    timestamp,
    actor: "cli",
    confirmation: input.confirmation,
    status: "planning",
  };
  const created = await createTaskArtifacts(paths, task, event);
  return { task: created.task, directory: created.directory };
}

export async function appendInlineAudit(
  paths: VineaPaths,
  input: InlineAuditInput,
  now: Clock = () => new Date(),
): Promise<InlineAuditRecord> {
  await readConfig(paths);
  assertNonempty(input.title, "Request title");
  assertNonempty(input.description, "Request description");
  assertNonempty(input.reason, "Inline skip reason");
  const record: InlineAuditRecord = {
    schemaVersion: SCHEMA_VERSION,
    timestamp: now().toISOString(),
    requestSummary: `${input.title.trim()}: ${input.description.trim()}`,
    proposedRisk: input.proposedRisk,
    reason: input.reason.trim(),
  };
  await appendJsonl(join(paths.vineaRoot, "inline-audit.jsonl"), record, paths.repoRoot);
  return record;
}

export async function readTask(paths: VineaPaths, taskId: string): Promise<TaskRecord> {
  await readConfig(paths);
  return (await findTask(paths, taskId)).task;
}

export async function listTasks(paths: VineaPaths, status: "active" | "all"): Promise<TaskRecord[]> {
  await readConfig(paths);
  const locations = await listStoredTasks(paths, status);
  await Promise.all(locations.map(({ task }) => recoverPendingRework(paths, task.id)));
  return (await listStoredTasks(paths, status)).map(({ task }) => task);
}

export async function orientWorkspace(
  paths: VineaPaths,
  input: OrientInput,
): Promise<OrientSummary> {
  assertHost(input.host);
  if (input.sessionId !== undefined) {
    sessionBindingPath(paths, input.host, input.sessionId);
  }
  const [health, gitStatus] = await Promise.all([
    inspectWorkspace(paths),
    inspectGitStatus(paths.repoRoot),
  ]);
  if (
    health.initialized
    && health.supportedSchema
    && health.missingRequiredDirectories.includes("tasks/active")
  ) {
    throw new SchemaError(
      "Active task storage tasks/active is missing, malformed, or unsafe; run `vinea doctor` for workspace diagnostics.",
    );
  }
  const canInspectTasks = health.initialized && health.supportedSchema;
  let locations = canInspectTasks ? await listStoredTasks(paths, "active") : [];
  if (canInspectTasks) {
    await Promise.all(locations.map(({ task }) => recoverPendingRework(paths, task.id)));
    locations = await listStoredTasks(paths, "active");
  }
  const candidates = await Promise.all(locations.map(async (location): Promise<OrientCandidate> => {
    const [context, latestEvidence, latestCheckEvent, check] = await Promise.all([
      listContextReferences(paths, location.task.id),
      readLatestEvidence(paths, location),
      readLatestCheckEvent(paths, location),
      readCheckForLocation(paths, location),
    ]);
    return {
      id: location.task.id,
      title: location.task.title,
      status: location.task.status,
      verificationRevision: location.task.verificationRevision,
      qualityMode: location.task.qualityMode,
      executionMode: location.task.executionMode,
      requirementsNotCovered: incompleteRequirements(location.task, check.summary.rows),
      failedOrUncoveredIds: failedOrUncoveredCheckIds(check.summary.rows),
      reworkEligible: isReworkEligible(location.task, check.summary.rows),
      nextAction: nextGate(location.task, check.summary.rows),
      contextReferences: context.references,
      latestEvidence,
      latestCheckEvent,
    };
  }));
  let binding: OrientBinding | null = null;
  let hasValidBinding = false;
  if (input.sessionId !== undefined) {
    const stored = await readSessionBinding(paths, input.host, input.sessionId);
    if (stored.status === "valid") {
      hasValidBinding = candidates.some(({ id }) => id === stored.binding.taskId);
      binding = {
        status: hasValidBinding ? "bound" : "stale",
        taskId: stored.binding.taskId,
        boundAt: stored.binding.boundAt,
      };
    } else if (stored.status === "malformed") {
      binding = { status: "malformed", message: stored.message };
    }
  }
  const recommendation = hasValidBinding
    ? "resume-bound"
    : candidates.length === 0
      ? "no-active-task"
      : candidates.length === 1
        ? "confirm-single"
        : "choose-task";
  return { health, gitStatus, binding, candidates, recommendation };
}

export async function continueTask(
  paths: VineaPaths,
  taskId: string,
  input: ContinueTaskInput,
): Promise<ContinuationResult> {
  return withTaskLock(paths, taskId, () => continueTaskLocked(paths, taskId, input));
}

async function continueTaskLocked(
  paths: VineaPaths,
  taskId: string,
  input: ContinueTaskInput,
): Promise<ContinuationResult> {
  assertHost(input.host);
  if (input.sessionId !== undefined) {
    sessionBindingPath(paths, input.host, input.sessionId);
  }
  if (!input.confirmed) {
    throw new ValidationError("Continuation requires explicit --confirmed.");
  }
  if (input.start === true) {
    assertNonempty(input.reason ?? "", "Continuation start reason");
  } else if (input.reason !== undefined) {
    throw new ValidationError("--reason requires --start.");
  }
  await readConfig(paths);
  let location = await findTask(paths, taskId);
  if (location.scope === "archive" || location.task.status === "archived") {
    throw new ValidationError(`Task is archived and cannot be continued: ${taskId}`);
  }
  if (location.task.status === "finished") {
    throw new ValidationError(`Task is finished and cannot be continued: ${taskId}`);
  }
  if (input.start === true && location.task.status !== "ready") {
    throw new ValidationError(
      `Only a ready task can be started during continuation; ${taskId} is ${location.task.status}.`,
    );
  }
  await assertTaskLifecycleStructure(paths, location);

  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  let task = location.task;
  if (input.start === true) {
    task = await transitionTask(paths, taskId, "in_progress", {
      actor: input.host,
      reason: input.reason!,
      now: () => new Date(timestamp),
    });
    location = await findTask(paths, taskId);
  }
  const event: JournalContinuationEvent = {
    schemaVersion: SCHEMA_VERSION,
    type: "continued",
    timestamp,
    actor: input.host,
    confirmation: "user",
    host: input.host,
    sessionBound: input.sessionId !== undefined,
    started: input.start === true,
    status: task.status,
  };
  await appendTaskContinuation(paths, location, event);

  let binding: SessionBinding | null = null;
  if (input.sessionId !== undefined) {
    binding = {
      schemaVersion: SCHEMA_VERSION,
      taskId,
      boundAt: timestamp,
    };
    await writeSessionBinding(paths, input.host, input.sessionId, binding);
  }
  return { task, binding };
}

export async function transitionTask(
  paths: VineaPaths,
  taskId: string,
  newStatus: TaskStatus,
  options: TransitionOptions,
): Promise<TaskRecord> {
  return withTaskLock(paths, taskId, () => transitionTaskLocked(paths, taskId, newStatus, options));
}

async function transitionTaskLocked(
  paths: VineaPaths,
  taskId: string,
  newStatus: TaskStatus,
  options: TransitionOptions,
): Promise<TaskRecord> {
  await readConfig(paths);
  assertNonempty(options.actor, "Transition actor");
  assertNonempty(options.reason, "Transition reason");
  const location = await findTask(paths, taskId);
  const oldStatus = location.task.status;
  const matchingPendingRetry = await hasMatchingPendingTaskTransition(paths, location, oldStatus, newStatus);
  assertTransitionAllowed(oldStatus, newStatus, options.unblock === true);
  if (newStatus === "ready") await assertReadyPrerequisites(paths, location);
  if (newStatus === "checking") await assertTddReadyForCheck(paths, location);
  await assertTaskLifecycleStructure(paths, location, matchingPendingRetry);

  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const task: TaskRecord = { ...location.task, status: newStatus, updatedAt: timestamp };
  const transition: JournalTransitionDetails = {
    schemaVersion: SCHEMA_VERSION,
    timestamp,
    actor: options.actor.trim(),
    reason: options.reason.trim(),
    oldStatus,
    newStatus,
  };
  return (await persistTaskTransition(paths, location, task, transition)).task;
}

export async function finishTask(
  paths: VineaPaths,
  taskId: string,
  input: CompletionInput,
): Promise<TaskRecord> {
  return withTaskLock(paths, taskId, () => finishTaskLocked(paths, taskId, input));
}

export async function reworkTask(
  paths: VineaPaths,
  taskId: string,
  input: ReworkInput,
  now: Clock = input.now ?? (() => new Date()),
  operationOverrides: Partial<ReworkPersistenceOperations> = {},
): Promise<TaskRecord> {
  return withTaskLock(paths, taskId, () => reworkTaskLocked(
    paths,
    taskId,
    input,
    now,
    operationOverrides,
  ));
}

export async function recoverPendingRework(
  paths: VineaPaths,
  taskId: string,
): Promise<TaskRecord | null> {
  await readConfig(paths);
  const location = await findTask(paths, taskId, { recoverPendingRework: false });
  const pending = await readPendingReworkIntent(paths, join(location.directory, "journal.md"));
  if (pending === null) return null;
  return withTaskLock(paths, taskId, () => recoverPendingReworkLocked(paths, taskId));
}

async function recoverPendingReworkLocked(paths: VineaPaths, taskId: string): Promise<TaskRecord | null> {
  await readConfig(paths);
  const location = await findTask(paths, taskId, { recoverPendingRework: false });
  const pending = await readPendingReworkIntent(paths, join(location.directory, "journal.md"));
  if (pending === null) return null;
  await assertNoPendingTaskTransition(paths, location);
  await assertNoPendingTaskMutation(paths, location);
  return recoverReworkIntent(paths, location, pending, DEFAULT_REWORK_OPERATIONS);
}

export async function listCheckHistory(
  paths: VineaPaths,
  taskId: string,
): Promise<CheckHistoryListing> {
  await readConfig(paths);
  const location = await findTask(paths, taskId);
  const snapshots = await readCheckHistory(paths, join(location.directory, "check-history.jsonl"));
  if (snapshots.some((snapshot) => snapshot.taskId !== taskId)) {
    throw new SchemaError(`Check history for ${taskId} contains a snapshot for another task.`);
  }
  return {
    taskId,
    revisions: snapshots
      .sort((left, right) => left.verificationRevision - right.verificationRevision)
      .map(summarizeCheckHistorySnapshot),
  };
}

export async function readCheckHistoryRevision(
  paths: VineaPaths,
  taskId: string,
  verificationRevision: number,
): Promise<CheckHistorySnapshot> {
  if (!isNonNegativeRevision(verificationRevision)) {
    throw new ValidationError("Check-history revision must be a non-negative safe integer.");
  }
  await readConfig(paths);
  const location = await findTask(paths, taskId);
  const snapshots = await readCheckHistory(paths, join(location.directory, "check-history.jsonl"));
  const snapshot = snapshots.find((candidate) => candidate.taskId === taskId
    && candidate.verificationRevision === verificationRevision);
  if (snapshot === undefined) {
    throw new ValidationError(`No check-history snapshot exists for ${taskId} revision ${verificationRevision}.`);
  }
  return snapshot;
}

function summarizeCheckHistorySnapshot(snapshot: CheckHistorySnapshot): CheckHistoryRevisionSummary {
  return {
    verificationRevision: snapshot.verificationRevision,
    archivedAt: snapshot.archivedAt,
    reworkReason: snapshot.reworkReason,
    operationId: snapshot.operationId,
    totals: {
      total: snapshot.rows.length,
      pass: snapshot.rows.filter(({ result }) => result === "pass").length,
      fail: snapshot.rows.filter(({ result }) => result === "fail").length,
      uncovered: snapshot.rows.filter(({ result }) => result === "uncovered").length,
    },
  };
}

async function reworkTaskLocked(
  paths: VineaPaths,
  taskId: string,
  input: ReworkInput,
  now: Clock,
  operationOverrides: Partial<ReworkPersistenceOperations>,
): Promise<TaskRecord> {
  await readConfig(paths);
  const actor = boundedTrimmed(input.actor, "Rework actor", 200);
  const reason = boundedTrimmed(input.reason, "Rework reason", 4000);
  const operations = { ...DEFAULT_REWORK_OPERATIONS, ...operationOverrides };
  const location = await findTask(paths, taskId, { recoverPendingRework: false });
  if (location.scope !== "active") {
    throw new TransitionError(`Rework requires task ${taskId} to remain active; found archived task storage.`);
  }
  await assertNoPendingTaskTransition(paths, location);
  await assertNoPendingTaskMutation(paths, location);

  const journalPath = join(location.directory, "journal.md");
  const pending = await readPendingReworkIntent(paths, journalPath);
  if (pending !== null) {
    return recoverReworkIntent(paths, location, pending, operations);
  }
  if (location.task.status !== "checking") {
    throw new TransitionError(
      `Rework requires task ${taskId} to have status checking; found ${location.task.status}.`,
    );
  }
  await assertTaskLifecycleStructure(paths, location);
  const { summary } = await readCheckForLocation(paths, location);
  if (!summary.rows.some(({ result }) => result === "fail" || result === "uncovered")) {
    throw new ValidationError(
      `Rework requires a failed or uncovered current verification check for ${taskId}.`,
    );
  }
  const timestamp = now().toISOString();
  const sourceVerificationRevision = location.task.verificationRevision;
  const operationId = reworkOperationId(taskId, sourceVerificationRevision);
  const snapshot: CheckHistorySnapshot = {
    schemaVersion: SCHEMA_VERSION,
    taskId,
    verificationRevision: sourceVerificationRevision,
    archivedAt: timestamp,
    reworkReason: reason,
    operationId,
    rows: summary.rows.map(cloneCheckRow),
  };
  const intent: JournalReworkIntentEvent = {
    schemaVersion: SCHEMA_VERSION,
    type: "rework_intent",
    operationId,
    timestamp,
    actor,
    reason,
    sourceVerificationRevision,
    snapshot,
  };
  await operations.appendJournal(journalPath, intent, paths.repoRoot);
  return recoverReworkIntent(paths, location, intent, operations);
}

async function recoverReworkIntent(
  paths: VineaPaths,
  initialLocation: TaskLocation,
  intent: JournalReworkIntentEvent,
  operations: ReworkPersistenceOperations,
): Promise<TaskRecord> {
  const location = await findTask(paths, intent.snapshot.taskId, { recoverPendingRework: false });
  if (location.scope !== "active") {
    throw new SchemaError(`Pending rework ${intent.operationId} is not in active task storage.`);
  }
  assertReworkIntentMatchesTask(intent, location.task);
  const historyPath = join(location.directory, "check-history.jsonl");
  await ensureReworkHistory(paths, historyPath, intent.snapshot, operations);

  const checkPath = join(location.directory, "check.md");
  const sourceCheck = renderCheckDocument(intent.snapshot.rows);
  const currentCheck = await readTaskArtifact(paths, checkPath, "current check matrix");
  if (currentCheck === sourceCheck) {
    try {
      await operations.writeCheck(paths, initialLocation, "");
    } catch (error) {
      throw new SchemaError(
        `Unable to clear current checks for rework ${intent.operationId}; rework intent remains pending for retry`,
        error,
      );
    }
  } else if (currentCheck !== "") {
    throw new SchemaError(
      `Pending rework ${intent.operationId} has a current check matrix that does not match its recorded source snapshot.`,
    );
  }

  const current = await findTask(paths, intent.snapshot.taskId, { recoverPendingRework: false });
  let task = current.task;
  if (task.status === "checking" && task.verificationRevision === intent.sourceVerificationRevision) {
    task = {
      ...task,
      status: "in_progress",
      verificationRevision: intent.sourceVerificationRevision + 1,
      updatedAt: intent.timestamp,
    };
    try {
      await operations.writeTask(join(current.directory, "task.json"), task, paths.repoRoot);
    } catch (error) {
      throw new SchemaError(
        `Unable to commit rework ${intent.operationId}; rework intent remains pending for retry`,
        error,
      );
    }
  } else if (task.status !== "in_progress"
    || task.verificationRevision !== intent.sourceVerificationRevision + 1
    || task.updatedAt !== intent.timestamp) {
    throw new SchemaError(
      `Pending rework ${intent.operationId} does not match task.json status or verification revision.`,
    );
  }

  const journalPath = join(current.directory, "journal.md");
  const completed = await hasReworkCompletion(paths, journalPath, intent);
  if (!completed) {
    const completion: JournalReworkedEvent = {
      schemaVersion: SCHEMA_VERSION,
      type: "reworked",
      operationId: intent.operationId,
      timestamp: intent.timestamp,
      actor: intent.actor,
      reason: intent.reason,
      sourceVerificationRevision: intent.sourceVerificationRevision,
      verificationRevision: intent.sourceVerificationRevision + 1,
      status: "in_progress",
    };
    try {
      await operations.appendJournal(journalPath, completion, paths.repoRoot);
    } catch (error) {
      throw new SchemaError(
        `Unable to complete rework ${intent.operationId}; rework intent remains pending for retry`,
        error,
      );
    }
  }
  return (await findTask(paths, intent.snapshot.taskId, { recoverPendingRework: false })).task;
}

function reworkOperationId(taskId: string, verificationRevision: number): string {
  return `rework-${taskId}-r${verificationRevision}`;
}

function cloneCheckRow(row: CheckRow): CheckRow {
  return { ...row, paths: [...row.paths], evidenceIds: [...row.evidenceIds] };
}

function assertReworkIntentMatchesTask(intent: JournalReworkIntentEvent, task: TaskRecord): void {
  const snapshot = intent.snapshot;
  if (snapshot.schemaVersion !== SCHEMA_VERSION
    || snapshot.taskId !== task.id
    || snapshot.verificationRevision !== intent.sourceVerificationRevision
    || snapshot.operationId !== intent.operationId
    || snapshot.reworkReason !== intent.reason
    || !Number.isSafeInteger(intent.sourceVerificationRevision)
    || intent.sourceVerificationRevision < 0) {
    throw new SchemaError(`Pending rework ${intent.operationId} has an invalid source snapshot.`);
  }
}

async function ensureReworkHistory(
  paths: VineaPaths,
  filename: string,
  snapshot: CheckHistorySnapshot,
  operations: ReworkPersistenceOperations,
): Promise<void> {
  const snapshots = await readCheckHistory(paths, filename);
  const matching = snapshots.filter((candidate) => candidate.operationId === snapshot.operationId
    || (candidate.taskId === snapshot.taskId && candidate.verificationRevision === snapshot.verificationRevision));
  if (matching.length > 1 || (matching.length === 1 && stableJson(matching[0]) !== stableJson(snapshot))) {
    throw new SchemaError(`Rework history for ${snapshot.operationId} is duplicate or does not match its journal intent.`);
  }
  if (matching.length === 0) {
    try {
      await operations.appendHistory(filename, snapshot, paths.repoRoot);
    } catch (error) {
      throw new SchemaError(
        `Unable to archive checks for rework ${snapshot.operationId}; rework intent remains pending for retry`,
        error,
      );
    }
  }
}

async function hasReworkCompletion(
  paths: VineaPaths,
  filename: string,
  intent: JournalReworkIntentEvent,
): Promise<boolean> {
  const journal = await readJsonlObjects(paths, filename, "task journal");
  const completions = journal.filter((event) => isJournalReworked(event)
    && event.operationId === intent.operationId);
  if (completions.length > 1) {
    throw new SchemaError(`Rework ${intent.operationId} has duplicate completion events.`);
  }
  if (completions.length === 0) return false;
  const completion = completions[0]!;
  if (!isJournalReworked(completion)) {
    throw new SchemaError(`Rework ${intent.operationId} has an invalid completion event.`);
  }
  if (!reworkCompletionMatchesIntent(completion, intent)) {
    throw new SchemaError(`Rework completion ${intent.operationId} does not match its rework intent.`);
  }
  return true;
}

async function readPendingReworkIntent(
  paths: VineaPaths,
  filename: string,
): Promise<JournalReworkIntentEvent | null> {
  const journal = await readJsonlObjects(paths, filename, "task journal");
  const intents = new Map<string, JournalReworkIntentEvent>();
  const completions = new Map<string, JournalReworkedEvent>();
  for (const event of journal) {
    if (event.type === "rework_intent") {
      if (!isJournalReworkIntent(event) || intents.has(event.operationId)) {
        throw new SchemaError(`Task journal ${filename} has an invalid or duplicate rework intent.`);
      }
      intents.set(event.operationId, event);
    } else if (event.type === "reworked") {
      if (!isJournalReworked(event) || completions.has(event.operationId)) {
        throw new SchemaError(`Task journal ${filename} has an invalid or duplicate rework completion.`);
      }
      completions.set(event.operationId, event);
    }
  }
  const pending = [...intents.values()].filter((intent) => !completions.has(intent.operationId));
  for (const [operationId, completion] of completions) {
    const intent = intents.get(operationId);
    if (intent === undefined) {
      throw new SchemaError(`Rework completion ${operationId} has no matching rework intent.`);
    }
    if (!reworkCompletionMatchesIntent(completion, intent)) {
      throw new SchemaError(`Rework completion ${operationId} does not match its rework intent.`);
    }
  }
  if (pending.length > 1) {
    throw new SchemaError(`Task journal ${filename} has more than one pending rework intent.`);
  }
  return pending[0] ?? null;
}

function reworkCompletionMatchesIntent(
  completion: JournalReworkedEvent,
  intent: JournalReworkIntentEvent,
): boolean {
  return completion.operationId === intent.operationId
    && completion.sourceVerificationRevision === intent.sourceVerificationRevision
    && completion.verificationRevision === intent.sourceVerificationRevision + 1
    && completion.timestamp === intent.timestamp
    && completion.actor === intent.actor
    && completion.reason === intent.reason
    && completion.status === "in_progress";
}

async function readCheckHistory(paths: VineaPaths, filename: string): Promise<CheckHistorySnapshot[]> {
  const records = await readJsonlObjects(paths, filename, "check history", true);
  const operationIds = new Set<string>();
  const revisions = new Set<string>();
  return records.map((record) => {
    if (!isCheckHistorySnapshot(record)) {
      throw new SchemaError(`Invalid check-history record in ${filename}.`);
    }
    const revisionKey = `${record.taskId}:${record.verificationRevision}`;
    if (operationIds.has(record.operationId) || revisions.has(revisionKey)) {
      throw new SchemaError(`Check history ${filename} has duplicate operation or task revision ${record.operationId}.`);
    }
    operationIds.add(record.operationId);
    revisions.add(revisionKey);
    return record;
  });
}

async function readJsonlObjects(
  paths: VineaPaths,
  filename: string,
  label: string,
  allowMissing = false,
): Promise<Record<string, unknown>[]> {
  await assertNoSymlink(paths.repoRoot, filename);
  let contents: string;
  try {
    contents = await readFile(filename, "utf8");
  } catch (error) {
    if (allowMissing && isMissingFile(error)) return [];
    throw new SchemaError(`Unable to read ${label} ${filename}`, error);
  }
  return contents.split("\n").filter((line) => line !== "").map((line, index) => {
    try {
      const value = JSON.parse(line) as unknown;
      if (!isRecord(value)) throw new Error("record is not an object");
      return value;
    } catch (error) {
      throw new SchemaError(`Invalid JSONL in ${label} ${filename} at line ${index + 1}`, error);
    }
  });
}

async function readTaskArtifact(paths: VineaPaths, filename: string, label: string): Promise<string> {
  await assertNoSymlink(paths.repoRoot, filename);
  try {
    return await readFile(filename, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read ${label} ${filename}`, error);
  }
}

function isJournalReworkIntent(
  value: Record<string, unknown>,
): value is Record<string, unknown> & JournalReworkIntentEvent {
  return value.schemaVersion === SCHEMA_VERSION
    && value.type === "rework_intent"
    && typeof value.operationId === "string"
    && value.operationId !== ""
    && isIsoTimestamp(value.timestamp)
    && typeof value.actor === "string"
    && value.actor.trim() !== ""
    && typeof value.reason === "string"
    && value.reason.trim() !== ""
    && isNonNegativeRevision(value.sourceVerificationRevision)
    && isCheckHistorySnapshot(value.snapshot)
    && value.snapshot.taskId !== ""
    && value.snapshot.verificationRevision === value.sourceVerificationRevision
    && value.snapshot.operationId === value.operationId
    && value.snapshot.reworkReason === value.reason;
}

function isJournalReworked(
  value: Record<string, unknown>,
): value is Record<string, unknown> & JournalReworkedEvent {
  return value.schemaVersion === SCHEMA_VERSION
    && value.type === "reworked"
    && typeof value.operationId === "string"
    && value.operationId !== ""
    && isIsoTimestamp(value.timestamp)
    && typeof value.actor === "string"
    && value.actor.trim() !== ""
    && typeof value.reason === "string"
    && value.reason.trim() !== ""
    && isNonNegativeRevision(value.sourceVerificationRevision)
    && isNonNegativeRevision(value.verificationRevision)
    && value.verificationRevision === value.sourceVerificationRevision + 1
    && value.status === "in_progress";
}

function isCheckHistorySnapshot(value: unknown): value is CheckHistorySnapshot {
  if (!isRecord(value)
    || value.schemaVersion !== SCHEMA_VERSION
    || typeof value.taskId !== "string"
    || value.taskId.trim() === ""
    || !isNonNegativeRevision(value.verificationRevision)
    || !isIsoTimestamp(value.archivedAt)
    || typeof value.reworkReason !== "string"
    || value.reworkReason.trim() === ""
    || typeof value.operationId !== "string"
    || value.operationId.trim() === ""
    || !Array.isArray(value.rows)) {
    return false;
  }
  const verificationRevision = value.verificationRevision;
  return value.rows.every((row) => isCheckRowSnapshot(row, verificationRevision));
}

function isCheckRowSnapshot(value: unknown, verificationRevision: number): value is CheckRow {
  if (!isRecord(value)
    || value.schemaVersion !== SCHEMA_VERSION
    || value.verificationRevision !== verificationRevision
    || typeof value.requirementId !== "string"
    || value.requirementId.trim() === ""
    || typeof value.planItem !== "string"
    || value.planItem.trim() === ""
    || !Array.isArray(value.paths)
    || !value.paths.every((path) => typeof path === "string")
    || !Array.isArray(value.evidenceIds)
    || !value.evidenceIds.every((id) => typeof id === "string")
    || (value.result !== "pass" && value.result !== "fail" && value.result !== "uncovered")
    || typeof value.summary !== "string"
    || value.summary.trim() === ""
    || !isIsoTimestamp(value.checkedAt)) {
    return false;
  }
  return true;
}

function isNonNegativeRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function finishTaskLocked(
  paths: VineaPaths,
  taskId: string,
  input: CompletionInput,
): Promise<TaskRecord> {
  if (!input.confirmed) throw new ValidationError("Finish requires explicit --confirmed.");
  await readConfig(paths);
  assertBoundedNonempty(input.actor, "Finish actor", 200);
  const location = await findTask(paths, taskId);
  if (location.scope !== "active" || location.task.status !== "checking") {
    throw new FinishGateError(
      `Finish requires task ${taskId} to be active with status checking; found ${location.task.status}.`,
    );
  }
  await assertTaskLifecycleStructure(paths, location);

  const { summary, evidence } = await readCheckForLocation(paths, location);
  const declaredIds = [
    ...location.task.requirements.map(({ id }) => id),
    ...location.task.acceptanceCriteria.map(({ id }) => id),
  ];
  const coveredIds = new Set(summary.rows.map(({ requirementId }) => requirementId));
  const missing = declaredIds.filter((id) => !coveredIds.has(id));
  if (missing.length > 0) {
    throw new FinishGateError(`Finish coverage is missing declared requirement or acceptance IDs: ${missing.join(", ")}.`);
  }
  const unsuccessful = summary.rows.filter(({ result }) => result !== "pass");
  if (unsuccessful.length > 0) {
    throw new FinishGateError(
      `Finish is blocked by failed or uncovered check rows: ${unsuccessful.map(({ requirementId }) => requirementId).join(", ")}.`,
    );
  }
  const evidenceById = new Map(
    evidence
      .filter((record) => record.verificationRevision === location.task.verificationRevision)
      .map((record) => [record.id, record]),
  );
  const withoutPassingEvidence = summary.rows.filter(
    (row) => !row.evidenceIds.some((id) => evidenceById.get(id)?.result === "pass"),
  );
  if (withoutPassingEvidence.length > 0) {
    throw new FinishGateError(
      `Finish is blocked by check rows without passing evidence: ${withoutPassingEvidence.map(({ requirementId }) => requirementId).join(", ")}.`,
    );
  }

  try {
    await assertTddReadyForCheck(paths, location);
  } catch (error) {
    throw new FinishGateError(
      `Finish TDD evidence is invalid; a valid tdd-red must precede tdd-green for ${taskId}.`,
    );
  }
  assertLearningCandidatesClassified(location.task);

  const gitStatus = await inspectBusinessGitStatus(paths.repoRoot);
  if (gitStatus.gitUnavailable) {
    throw new FinishGateError(
      `Finish gitUnavailable: ${gitStatus.error ?? "Git status could not be inspected."}`,
    );
  }
  if (gitStatus.businessDirtyPaths.length > 0) {
    throw new FinishGateError(
      `Finish is blocked by business dirty paths: ${gitStatus.businessDirtyPaths.join(", ")}.`,
    );
  }

  return transitionTask(paths, taskId, "finished", {
    actor: input.actor,
    reason: "Completion gates satisfied.",
    now: input.now,
  });
}

export async function archiveTask(
  paths: VineaPaths,
  taskId: string,
  input: CompletionInput,
  operationOverrides: Partial<ArchiveOperations> = {},
): Promise<TaskRecord> {
  return withTaskLock(paths, taskId, () => archiveTaskLocked(paths, taskId, input, operationOverrides));
}

async function archiveTaskLocked(
  paths: VineaPaths,
  taskId: string,
  input: CompletionInput,
  operationOverrides: Partial<ArchiveOperations>,
): Promise<TaskRecord> {
  if (!input.confirmed) throw new ValidationError("Archive requires explicit --confirmed.");
  await readConfig(paths);
  assertBoundedNonempty(input.actor, "Archive actor", 200);
  const location = await findTask(paths, taskId);
  if (location.task.status !== "finished") {
    throw new TransitionError(
      `Archive requires task ${taskId} to have status finished; found ${location.task.status}.`,
    );
  }
  await assertTaskLifecycleStructure(
    paths,
    location,
    await hasMatchingPendingTaskTransition(paths, location, "finished", "archived"),
  );
  const operations = { ...DEFAULT_ARCHIVE_OPERATIONS, ...operationOverrides };
  await operations.removeTaskSessionBindings(paths, taskId);
  return transitionTask(paths, taskId, "archived", {
    actor: input.actor,
    reason: "Task archived after confirmed finish.",
    now: input.now,
  });
}

export async function addRequirement(
  paths: VineaPaths,
  taskId: string,
  input: RequirementInput,
  now: Clock = () => new Date(),
): Promise<TaskRecord> {
  return withTaskLock(paths, taskId, () => addRequirementLike(paths, taskId, input, "requirements", "requirement_added", now));
}

export async function addAcceptanceCriterion(
  paths: VineaPaths,
  taskId: string,
  input: RequirementInput,
  now: Clock = () => new Date(),
): Promise<TaskRecord> {
  return withTaskLock(paths, taskId, () => addRequirementLike(
    paths,
    taskId,
    input,
    "acceptanceCriteria",
    "acceptance_criterion_added",
    now,
  ));
}

export async function setTaskBrief(
  paths: VineaPaths,
  taskId: string,
  sourceFile: string,
  actor = "cli",
  now: Clock = () => new Date(),
): Promise<TaskDocumentResult> {
  return setTaskDocument(paths, taskId, sourceFile, "brief.md", actor, now);
}

export async function setTaskPlan(
  paths: VineaPaths,
  taskId: string,
  sourceFile: string,
  actor = "cli",
  now: Clock = () => new Date(),
): Promise<TaskDocumentResult> {
  return setTaskDocument(paths, taskId, sourceFile, "plan.md", actor, now);
}

export function nextGate(task: TaskRecord, rows: CheckRow[] = []): string {
  if (task.status === "blocked") return "unblock to ready, in_progress, or checking";
  if (task.status === "archived") return "none";
  if (task.status === "checking") {
    if (isReworkEligible(task, rows)) return "task rework";
    if (incompleteRequirements(task, rows).length > 0) return "continue checking";
    return "finish";
  }
  return FORWARD_TRANSITIONS[task.status] ?? "none";
}

export function incompleteRequirements(task: TaskRecord, rows: CheckRow[] = []): string[] {
  const passingIds = new Set(rows.filter((row) => row.result === "pass").map((row) => row.requirementId));
  return [...task.requirements, ...task.acceptanceCriteria]
    .map((requirement) => requirement.id)
    .filter((id) => !passingIds.has(id));
}

export function taskView(task: TaskRecord, rows: CheckRow[]): TaskView {
  return {
    ...task,
    failedOrUncoveredIds: failedOrUncoveredCheckIds(rows),
    reworkEligible: isReworkEligible(task, rows),
    nextAction: nextGate(task, rows),
  };
}

export function failedOrUncoveredCheckIds(rows: CheckRow[]): string[] {
  return rows
    .filter(({ result }) => result === "fail" || result === "uncovered")
    .map(({ requirementId }) => requirementId);
}

export function isReworkEligible(task: TaskRecord, rows: CheckRow[]): boolean {
  return task.status === "checking" && failedOrUncoveredCheckIds(rows).length > 0;
}

function assertTransitionAllowed(oldStatus: TaskStatus, newStatus: TaskStatus, unblock: boolean): void {
  if (oldStatus === "blocked") {
    if (unblock && UNBLOCK_TARGETS.has(newStatus)) return;
    throw new TransitionError(`Blocked task requires explicit unblock to ready, in_progress, or checking.`);
  }
  if (unblock) throw new TransitionError(`Only blocked tasks can be unblocked.`);
  if (BLOCKABLE.has(oldStatus) && newStatus === "blocked") return;
  if (FORWARD_TRANSITIONS[oldStatus] === newStatus) return;
  throw new TransitionError(`Cannot transition task from ${oldStatus} to ${newStatus}.`);
}

async function addRequirementLike(
  paths: VineaPaths,
  taskId: string,
  input: RequirementInput,
  collection: "requirements" | "acceptanceCriteria",
  eventType: "requirement_added" | "acceptance_criterion_added",
  now: Clock,
): Promise<TaskRecord> {
  await readConfig(paths);
  assertBoundedNonempty(input.id, "Requirement ID", 200);
  assertNonempty(input.text, "Requirement text");
  assertBoundedNonempty(input.actor, "Requirement actor", 200);
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  const id = input.id.trim();
  const text = input.text.trim();
  const actor = input.actor.trim();
  await executeTaskMutation(paths, location, {
    mutationKind: eventType,
    actor,
    timestamp: now().toISOString(),
    fingerprint: mutationFingerprint({
      schemaVersion: SCHEMA_VERSION,
      type: eventType,
      actor,
      requirementId: id,
      text,
    }),
  }, async (timestamp, recovering) => {
    const current = await findTask(paths, taskId);
    assertTaskMutable(current);
    const allRequirements = [...current.task.requirements, ...current.task.acceptanceCriteria];
    if (allRequirements.some((requirement) => requirement.id === id)) {
      if (recovering) {
        throw new SchemaError(`Pending ${eventType} mutation already has requirement ${id}, but task.json does not match its recorded target.`);
      }
      throw new ValidationError(`Requirement ID already exists in task ${taskId}: ${id}`);
    }
    const requirement = {
      schemaVersion: SCHEMA_VERSION,
      id,
      text,
      createdAt: timestamp,
    };
    const task: TaskRecord = {
      ...current.task,
      [collection]: [...current.task[collection], requirement],
      updatedAt: timestamp,
    };
    return {
      expected: mutationTargetSummary(paths, [{
        filename: join(current.directory, "task.json"),
        contents: `${JSON.stringify(task, null, 2)}\n`,
      }], mutationValueIdentity({ requirementId: id }, requirement)),
      completion: {
        schemaVersion: SCHEMA_VERSION,
        type: eventType,
        mutationKind: eventType,
        mutationProtocolVersion: 1,
        timestamp,
        actor,
        requirementId: id,
      },
      apply: () => writeJsonAtomic(join(current.directory, "task.json"), task, paths.repoRoot),
    };
  });
  return (await findTask(paths, taskId)).task;
}

async function setTaskDocument(
  paths: VineaPaths,
  taskId: string,
  sourceFile: string,
  artifact: "brief.md" | "plan.md",
  actor: string,
  now: Clock,
): Promise<TaskDocumentResult> {
  return withTaskLock(paths, taskId, () => setTaskDocumentLocked(paths, taskId, sourceFile, artifact, actor, now));
}

async function setTaskDocumentLocked(
  paths: VineaPaths,
  taskId: string,
  sourceFile: string,
  artifact: "brief.md" | "plan.md",
  actor: string,
  now: Clock,
): Promise<TaskDocumentResult> {
  await readConfig(paths);
  assertNonempty(sourceFile, "Source file");
  assertBoundedNonempty(actor, "Task document actor", 200);
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  const { bytes } = await readTaskDocumentSource(paths, sourceFile);
  let contents: string;
  try {
    contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ValidationError(`Task document source must contain valid UTF-8: ${sourceFile}`, error);
  }
  if (contents.trim() === "") {
    throw new ValidationError(`Task document source must not be empty: ${sourceFile}`);
  }
  const type = artifact === "brief.md" ? "brief_set" : "plan_set";
  const normalizedActor = actor.trim();
  await executeTaskMutation(paths, location, {
    mutationKind: type,
    actor: normalizedActor,
    timestamp: now().toISOString(),
    fingerprint: mutationFingerprint({
      schemaVersion: SCHEMA_VERSION,
      type,
      actor: normalizedActor,
      artifact,
      contentsSha256: mutationFingerprint(contents),
    }),
  }, async (timestamp) => ({
    expected: mutationTargetSummary(paths, [{
      filename: join(location.directory, artifact),
      contents,
    }], { artifact, valueSha256: mutationFingerprint(contents) }),
    completion: {
      schemaVersion: SCHEMA_VERSION,
      type,
      mutationKind: type,
      mutationProtocolVersion: 1,
      timestamp,
      actor: normalizedActor,
      artifact,
    },
    apply: () => writeManagedMutationTarget(paths, location, join(location.directory, artifact), contents),
  }));
  return { taskId, artifact, estimatedBytes: bytes.byteLength };
}

async function assertTaskLifecycleStructure(
  paths: VineaPaths,
  location: TaskLocation,
  matchingPendingTransition = false,
): Promise<void> {
  const report = await validateTaskStructure(paths, location);
  const issues = matchingPendingTransition
    ? report.issues.filter(({ code }) => code !== "TASK_STATE_SCOPE_INVALID")
    : report.issues;
  if (issues.length === 0) return;
  const issue = issues[0]!;
  throw new SchemaError(
    `Task ${location.task.id} lifecycle is blocked by ${issue.code} at ${issue.path}: ${issue.message}. Run \`vinea validate\` to inspect all task-structure issues.`,
  );
}

async function readTaskDocumentSource(paths: VineaPaths, sourceFile: string): Promise<{ bytes: Buffer }> {
  const source = sourceFile.trim();
  if (
    isAbsolute(source)
    || /^\\/u.test(source)
    || /^[a-z]:[\\/]/iu.test(source)
    || source.includes("\0")
  ) {
    throw new ValidationError(`Task document source must be repository-relative: ${sourceFile}`);
  }
  const segments = source.split(/[\\/]/u);
  if (segments.includes("..")) {
    throw new ValidationError(`Task document source must not contain parent traversal: ${sourceFile}`);
  }
  const relativeSource = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (relativeSource === "") {
    throw new ValidationError(`Task document source must name a repository-relative file: ${sourceFile}`);
  }
  let filename: string;
  try {
    filename = assertInside(paths.repoRoot, resolve(paths.repoRoot, relativeSource));
    await assertNoSymlink(paths.repoRoot, filename);
  } catch (error) {
    throw new ValidationError(`Task document source must not contain symbolic links: ${sourceFile}`, error);
  }
  let entry;
  try {
    entry = await lstat(filename);
  } catch (error) {
    throw new ValidationError(`Unable to inspect task document source ${sourceFile}`, error);
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new ValidationError(`Task document source must be a regular non-symlink file: ${sourceFile}`);
  }
  try {
    return { bytes: await readFile(filename) };
  } catch (error) {
    throw new ValidationError(`Unable to read task document source ${sourceFile}`, error);
  }
}

async function assertReadyPrerequisites(paths: VineaPaths, location: TaskLocation): Promise<void> {
  const briefPath = join(location.directory, "brief.md");
  const planPath = join(location.directory, "plan.md");
  await Promise.all([
    assertNoSymlink(paths.repoRoot, briefPath),
    assertNoSymlink(paths.repoRoot, planPath),
  ]);
  const [brief, plan] = await Promise.all([
    readFile(briefPath, "utf8"),
    readFile(planPath, "utf8"),
  ]);
  const missing: string[] = [];
  if (brief.trim() === "") missing.push("brief.md");
  if (plan.trim() === "") missing.push("plan.md");
  const requirements: unknown[] = Array.isArray(location.task.requirements) ? location.task.requirements : [];
  const acceptanceCriteria: unknown[] = Array.isArray(location.task.acceptanceCriteria)
    ? location.task.acceptanceCriteria
    : [];
  if (![...requirements, ...acceptanceCriteria].some(isStructurallyValidRequirement)) {
    missing.push("valid requirement or acceptance criterion");
  }
  if (missing.length > 0) {
    throw new TransitionError(`Task is not ready; missing ${missing.join(", ")}.`);
  }
}

function isStructurallyValidRequirement(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== SCHEMA_VERSION) return false;
  if (typeof candidate.id !== "string" || candidate.id.trim() === "") return false;
  if (typeof candidate.text !== "string" || candidate.text.trim() === "") return false;
  if (typeof candidate.createdAt !== "string") return false;
  const parsed = new Date(candidate.createdAt);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === candidate.createdAt;
}

function matchedRules(searchable: string, rules: string[]): string[] {
  return rules.filter((rule) => {
    const normalizedRule = normalize(rule);
    return normalizedRule !== "" && (` ${searchable} `).includes(` ${normalizedRule} `);
  });
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(value: string): string {
  return normalize(value).replace(/ /g, "-") || "task";
}

function formatTaskTimestamp(date: Date): string {
  if (Number.isNaN(date.valueOf())) throw new ValidationError("Clock returned an invalid date.");
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}

function assertNonempty(value: string, label: string): void {
  if (value.trim() === "") throw new ValidationError(`${label} must not be empty.`);
}

function assertBoundedNonempty(value: string, label: string, maxBytes: number): void {
  assertNonempty(value, label);
  if (Buffer.byteLength(value.trim(), "utf8") > maxBytes) {
    throw new ValidationError(`${label} exceeds the ${maxBytes}-byte audit metadata limit.`);
  }
}

function boundedTrimmed(value: string, label: string, maxBytes: number): string {
  assertBoundedNonempty(value, label, maxBytes);
  return value.trim();
}

function assertHost(value: string): asserts value is Host {
  if (value !== "codex" && value !== "claude") {
    throw new ValidationError(`Invalid host: ${value}. Expected codex|claude.`);
  }
}

function assertLearningCandidatesClassified(task: TaskRecord): void {
  const candidates: unknown = task.learningCandidates;
  if (candidates === undefined) return;
  if (!Array.isArray(candidates)) {
    throw new FinishGateError("Finish learning candidate data is malformed.");
  }
  for (const candidate of candidates) {
    if (!isRecord(candidate)
      || candidate.schemaVersion !== SCHEMA_VERSION
      || typeof candidate.id !== "string"
      || candidate.id.trim() === ""
      || typeof candidate.domain !== "string"
      || candidate.domain.trim() === ""
      || typeof candidate.text !== "string"
      || candidate.text.trim() === ""
      || typeof candidate.rationale !== "string"
      || candidate.rationale.trim() === ""
      || !isIsoTimestamp(candidate.proposedAt)) {
      throw new FinishGateError("Finish learning candidate data is malformed.");
    }
    if (candidate.status === "accepted") {
      if (candidate.confirmedBy !== "user" || !isIsoTimestamp(candidate.acceptedAt)) {
        throw new FinishGateError(`Finish learning candidate ${candidate.id} is not validly accepted.`);
      }
      continue;
    }
    if (candidate.status === "archived") {
      if (!isIsoTimestamp(candidate.archivedAt)
        || typeof candidate.archiveReason !== "string"
        || candidate.archiveReason.trim() === "") {
        throw new FinishGateError(`Finish learning candidate ${candidate.id} is not validly archived.`);
      }
      continue;
    }
    throw new FinishGateError(
      `Finish learning candidate ${candidate.id} must be accepted or archived before completion.`,
    );
  }
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function inspectGitStatus(repoRoot: string): Promise<OrientSummary["gitStatus"]> {
  try {
    const result = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return {
      available: true,
      porcelain: result.stdout,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      porcelain: "",
      error: error instanceof Error ? error.message : "Unable to run git status --porcelain.",
    };
  }
}
