import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG, readConfig } from "./config.js";
import { TransitionError, ValidationError } from "./errors.js";
import {
  createTaskArtifacts,
  findTask,
  listStoredTasks,
  persistTaskTransition,
  type TaskLocation,
} from "./task-store.js";
import type { VineaPaths } from "./paths.js";
import {
  SCHEMA_VERSION,
  type ExecutionMode,
  type InlineAuditRecord,
  type JournalCreationEvent,
  type JournalTransitionEvent,
  type QualityMode,
  type RiskSuggestion,
  type TaskRecord,
  type TaskStatus,
  type VineaConfig,
} from "./types.js";
import { appendJsonl } from "./json.js";

type Clock = () => Date;
type RiskRules = VineaConfig["riskRules"];

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

export interface InlineAuditInput {
  title: string;
  description: string;
  proposedRisk: RiskSuggestion;
  reason: string;
}

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

export async function transitionTask(
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
  if (newStatus === "ready") await assertReadyPrerequisites(location);

  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const task: TaskRecord = { ...location.task, status: newStatus, updatedAt: timestamp };
  const event: JournalTransitionEvent = {
    schemaVersion: SCHEMA_VERSION,
    type: "transition",
    timestamp,
    actor: options.actor.trim(),
    reason: options.reason.trim(),
    oldStatus,
    newStatus,
  };
  return (await persistTaskTransition(paths, location, task, event)).task;
}

export function nextGate(task: TaskRecord): string {
  if (task.status === "blocked") return "unblock to ready, in_progress, or checking";
  if (task.status === "archived") return "none";
  return FORWARD_TRANSITIONS[task.status] ?? "none";
}

export function incompleteRequirements(task: TaskRecord): string[] {
  return task.requirements
    .filter((requirement) => !task.acceptanceCriteria.some((criterion) => criterion.id === requirement.id))
    .map((requirement) => requirement.id);
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

async function assertReadyPrerequisites(location: TaskLocation): Promise<void> {
  const [brief, plan] = await Promise.all([
    readFile(join(location.directory, "brief.md"), "utf8"),
    readFile(join(location.directory, "plan.md"), "utf8"),
  ]);
  const missing: string[] = [];
  if (brief.trim() === "") missing.push("brief.md");
  if (plan.trim() === "") missing.push("plan.md");
  if (location.task.requirements.length === 0 && location.task.acceptanceCriteria.length === 0) {
    missing.push("requirement or acceptance criterion");
  }
  if (missing.length > 0) {
    throw new TransitionError(`Task is not ready; missing ${missing.join(", ")}.`);
  }
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
