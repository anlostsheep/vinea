import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_CONFIG, readConfig } from "./config.js";
import { readCheckForLocation } from "./check.js";
import { listContextReferences } from "./context.js";
import { FinishGateError, SchemaError, TransitionError, ValidationError } from "./errors.js";
import { assertTddReadyForCheck } from "./evidence.js";
import { inspectBusinessGitStatus } from "./git.js";
import {
  appendTaskContinuation,
  assertTaskMutable,
  createTaskArtifacts,
  executeTaskMutation,
  findTask,
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
import { assertNoSymlink, type VineaPaths } from "./paths.js";
import { inspectWorkspace } from "./schema.js";
import {
  SCHEMA_VERSION,
  type ContinuationResult,
  type CheckRow,
  type ExecutionMode,
  type Host,
  type InlineAuditRecord,
  type JournalContinuationEvent,
  type JournalCreationEvent,
  type JournalTransitionDetails,
  type OrientBinding,
  type OrientCandidate,
  type OrientSummary,
  type QualityMode,
  type RiskSuggestion,
  type SessionBinding,
  type TaskRecord,
  type TaskStatus,
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

export interface ArchiveOperations {
  removeTaskSessionBindings(paths: VineaPaths, taskId: string): Promise<string[]>;
}

const DEFAULT_ARCHIVE_OPERATIONS: ArchiveOperations = { removeTaskSessionBindings };

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
  const locations = canInspectTasks ? await listStoredTasks(paths, "active") : [];
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
      qualityMode: location.task.qualityMode,
      executionMode: location.task.executionMode,
      requirementsNotCovered: incompleteRequirements(location.task, check.summary.rows),
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
  assertTransitionAllowed(oldStatus, newStatus, options.unblock === true);
  if (newStatus === "ready") await assertReadyPrerequisites(paths, location);
  if (newStatus === "checking") await assertTddReadyForCheck(paths, location);

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
  const evidenceById = new Map(evidence.map((record) => [record.id, record]));
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

export function nextGate(task: TaskRecord): string {
  if (task.status === "blocked") return "unblock to ready, in_progress, or checking";
  if (task.status === "archived") return "none";
  return FORWARD_TRANSITIONS[task.status] ?? "none";
}

export function incompleteRequirements(task: TaskRecord, rows: CheckRow[] = []): string[] {
  const passingIds = new Set(rows.filter((row) => row.result === "pass").map((row) => row.requirementId));
  return [...task.requirements, ...task.acceptanceCriteria]
    .map((requirement) => requirement.id)
    .filter((id) => !passingIds.has(id));
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
  const filename = isAbsolute(sourceFile) ? sourceFile : resolve(paths.repoRoot, sourceFile);
  let entry;
  try {
    entry = await lstat(filename);
  } catch (error) {
    throw new ValidationError(`Unable to inspect task document source ${sourceFile}`, error);
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new ValidationError(`Task document source must be a regular non-symlink file: ${sourceFile}`);
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(filename);
  } catch (error) {
    throw new ValidationError(`Unable to read task document source ${sourceFile}`, error);
  }
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
      timestamp,
      actor: normalizedActor,
      artifact,
    },
    apply: () => writeManagedMutationTarget(paths, location, join(location.directory, artifact), contents),
  }));
  return { taskId, artifact, estimatedBytes: bytes.byteLength };
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
