import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseCheckDocument } from "./check.js";
import { validateEvidenceRecord } from "./evidence.js";
import { normalizeSpecTarget, parseSpecIndexTarget } from "./learning.js";
import type { VineaPaths } from "./paths.js";
import { inspectTaskLocks } from "./task-locks.js";
import { SCHEMA_VERSION, type EvidenceRecord, type TaskStatus } from "./types.js";

const REQUIRED_TASK_ARTIFACTS = [
  "brief.md",
  "plan.md",
  "context.jsonl",
  "evidence.jsonl",
  "check.md",
  "journal.md",
] as const;
const TASK_ID_PATTERN = /^t-\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ACTIVE_STATUSES = new Set(["planning", "ready", "in_progress", "checking", "finished", "blocked"]);
const ALL_STATUSES = new Set([...ACTIVE_STATUSES, "archived"]);
const FORWARD_TRANSITIONS: Partial<Record<TaskStatus, TaskStatus>> = {
  planning: "ready",
  ready: "in_progress",
  in_progress: "checking",
  checking: "finished",
  finished: "archived",
};
const BLOCKABLE_STATUSES = new Set<TaskStatus>(["planning", "ready", "in_progress", "checking"]);
const UNBLOCK_TARGETS = new Set<TaskStatus>(["ready", "in_progress", "checking"]);
const TASK_MUTATION_KINDS = new Set([
  "requirement_added",
  "acceptance_criterion_added",
  "brief_set",
  "plan_set",
  "context_added",
  "evidence_recorded",
  "learning_proposed",
  "learning_accepted",
  "learning_archived",
]);
const RUNTIME_IGNORE = ".runtime/\n";
const MANAGED_SPEC_TARGET = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
}

interface ContextLimits {
  maxFiles: number;
  maxEstimatedBytes: number;
}

interface TaskScan {
  activeTaskIds: Set<string>;
  taskIdsByScope: Map<string, Set<"active" | "archive">>;
}

export async function validateWorkspace(paths: VineaPaths): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const add = (code: string, filename: string, message: string): void => {
    issues.push({ code, path: displayPath(paths, filename), message });
  };

  const root = await entryKind(paths.vineaRoot);
  if (root === "missing") {
    add("WORKSPACE_NOT_INITIALIZED", paths.vineaRoot, "Run `vinea init` before validating this repository.");
    return { issues: sortIssues(issues) };
  }
  if (root !== "directory") {
    add("WORKSPACE_INVALID", paths.vineaRoot, "The Vinea root must be a regular directory and not a symbolic link.");
    return { issues: sortIssues(issues) };
  }

  const limits = await validateConfig(paths, add);
  await validateManagedSpecs(paths, add);
  await validateInlineAudit(paths, add);

  for (const [label, directory] of [
    ["specs", paths.specs],
    ["tasks/active", paths.activeTasks],
    ["tasks/archive", paths.archivedTasks],
  ] as const) {
    const kind = await entryKind(directory);
    if (kind === "missing") {
      add("DIRECTORY_MISSING", directory, `Required Vinea directory ${label} is missing.`);
    } else if (kind !== "directory") {
      add("DIRECTORY_INVALID", directory, `Required Vinea path ${label} must be a regular directory.`);
    }
  }

  const taskScan: TaskScan = {
    activeTaskIds: new Set<string>(),
    taskIdsByScope: new Map<string, Set<"active" | "archive">>(),
  };
  await scanTaskScope(paths, paths.activeTasks, "active", limits, taskScan, add);
  await scanTaskScope(paths, paths.archivedTasks, "archive", limits, taskScan, add);
  for (const [taskId, scopes] of taskScan.taskIdsByScope) {
    if (scopes.size > 1) {
      add(
        "TASK_LOCATION_DUPLICATE",
        join(paths.tasks, taskId),
        `Task ${taskId} is present in both active and archive storage.`,
      );
    }
  }

  await validateSessionBindings(paths, taskScan.activeTaskIds, add);
  await validateTaskLocks(paths, add);
  return { issues: sortIssues(issues) };
}

async function validateTaskLocks(paths: VineaPaths, add: IssueAdder): Promise<void> {
  const locks = await inspectTaskLocks(paths);
  for (const lock of locks) {
    const association = lock.taskId === null ? "unknown task" : `task ${lock.taskId}`;
    const age = lock.ageMilliseconds === null ? "unknown age" : `age ${lock.ageMilliseconds}ms`;
    const message = `${association}; ${age}. ${lock.recoveryInstruction}`;
    if (lock.status === "directory_invalid") {
      add("TASK_LOCK_DIRECTORY_INVALID", join(paths.repoRoot, lock.path), message);
    } else if (lock.status === "retained") {
      add("TASK_LOCK_RETAINED", join(paths.repoRoot, lock.path), message);
    } else if (lock.status === "owner_missing") {
      add("TASK_LOCK_OWNER_MISSING", join(paths.repoRoot, lock.path), message);
    } else if (lock.status === "owner_malformed") {
      add("TASK_LOCK_OWNER_MALFORMED", join(paths.repoRoot, lock.path), message);
    } else if (lock.status === "owner_unreadable") {
      add("TASK_LOCK_OWNER_UNREADABLE", join(paths.repoRoot, lock.path), message);
    } else {
      add("TASK_LOCK_OWNER_UNSAFE", join(paths.repoRoot, lock.path), message);
    }
  }
}

async function validateManagedSpecs(paths: VineaPaths, add: IssueAdder): Promise<void> {
  const gitignore = await readRequiredRegularFile(paths.gitignore, "VINEA_GITIGNORE", add);
  if (gitignore !== null && gitignore !== RUNTIME_IGNORE) {
    add(
      "VINEA_GITIGNORE_INVALID",
      paths.gitignore,
      "Managed .vinea/.gitignore must contain exactly .runtime/.",
    );
  }

  if (await entryKind(paths.specs) !== "directory") return;
  const index = await readRequiredRegularFile(paths.specIndex, "SPEC_INDEX", add);
  if (index === null) return;
  const seenTargets = new Set<string>();
  for (const [index_, line] of index.split(/\r?\n/u).entries()) {
    if (!/^\s*-\s*\[/u.test(line)) continue;
    const target = parseSpecIndexTarget(line);
    if (target === undefined) {
      add("SPEC_INDEX_ENTRY_INVALID", paths.specIndex, `Line ${index_ + 1} is not a valid indexed spec link.`);
      continue;
    }
    const normalized = normalizeSpecTarget(target);
    if (!MANAGED_SPEC_TARGET.test(normalized)) {
      add(
        "SPEC_INDEX_TARGET_INVALID",
        paths.specIndex,
        `Line ${index_ + 1} must target a managed relative <domain>.md spec file.`,
      );
      continue;
    }
    if (seenTargets.has(normalized)) {
      add("SPEC_INDEX_TARGET_DUPLICATE", paths.specIndex, `Line ${index_ + 1} duplicates spec target ${normalized}.`);
      continue;
    }
    seenTargets.add(normalized);
    const targetPath = join(paths.specs, normalized);
    const kind = await entryKind(targetPath);
    if (kind === "missing") {
      add("SPEC_INDEX_TARGET_MISSING", targetPath, `Indexed spec target ${normalized} is missing.`);
    } else if (kind !== "file") {
      add("SPEC_INDEX_TARGET_INVALID", targetPath, `Indexed spec target ${normalized} must be a regular file.`);
    }
  }
}

async function validateConfig(
  paths: VineaPaths,
  add: IssueAdder,
): Promise<ContextLimits | null> {
  const value = await readJsonObject(paths.config, "CONFIG", add);
  if (value === null) return null;
  if (value.schemaVersion !== SCHEMA_VERSION) {
    add(
      "CONFIG_SCHEMA_UNSUPPORTED",
      paths.config,
      `Config schema ${String(value.schemaVersion)} is unsupported; this CLI supports ${SCHEMA_VERSION}.`,
    );
  }
  const riskRules = value.riskRules;
  const context = value.context;
  const validRiskRules = isRecord(riskRules)
    && isStringArray(riskRules.medium)
    && isStringArray(riskRules.high);
  const validContext = isRecord(context)
    && isNonNegativeSafeInteger(context.maxFiles)
    && isNonNegativeSafeInteger(context.maxEstimatedBytes);
  if (!validRiskRules || !validContext) {
    add(
      "CONFIG_INVALID",
      paths.config,
      "Config must define string risk-rule arrays and non-negative integer context budgets.",
    );
  }
  return validContext
    ? {
        maxFiles: context.maxFiles as number,
        maxEstimatedBytes: context.maxEstimatedBytes as number,
      }
    : null;
}

async function validateInlineAudit(paths: VineaPaths, add: IssueAdder): Promise<void> {
  const filename = join(paths.vineaRoot, "inline-audit.jsonl");
  const contents = await readOptionalRegularFile(filename, "INLINE_AUDIT", add);
  if (contents === null) return;
  for (const { line, lineNumber } of jsonlLines(contents)) {
    const value = parseJsonl(line, lineNumber, filename, "INLINE_AUDIT_JSONL_INVALID", add);
    if (value === null) continue;
    if (!isRecord(value)) {
      add("INLINE_AUDIT_RECORD_INVALID", filename, `Line ${lineNumber} must contain an object.`);
      continue;
    }
    if (value.schemaVersion !== SCHEMA_VERSION) {
      add(
        "INLINE_AUDIT_SCHEMA_UNSUPPORTED",
        filename,
        `Line ${lineNumber} uses unsupported schema ${String(value.schemaVersion)}.`,
      );
    }
    if (
      !isIsoTimestamp(value.timestamp)
      || typeof value.requestSummary !== "string"
      || value.requestSummary.trim() === ""
      || typeof value.reason !== "string"
      || value.reason.trim() === ""
      || !isRecord(value.proposedRisk)
      || !["low", "medium", "high"].includes(String(value.proposedRisk.level))
      || !isStringArray(value.proposedRisk.reasons)
    ) {
      add("INLINE_AUDIT_RECORD_INVALID", filename, `Line ${lineNumber} is not a valid inline-audit record.`);
    }
  }
}

async function scanTaskScope(
  paths: VineaPaths,
  directory: string,
  scope: "active" | "archive",
  limits: ContextLimits | null,
  scan: TaskScan,
  add: IssueAdder,
): Promise<void> {
  if (await entryKind(directory) !== "directory") return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    add("DIRECTORY_UNREADABLE", directory, describeError("Unable to list task storage", error));
    return;
  }
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const taskDirectory = join(directory, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      add("TASK_ENTRY_INVALID", taskDirectory, "Task storage entries must be regular directories.");
      continue;
    }
    const scopes = scan.taskIdsByScope.get(entry.name) ?? new Set<"active" | "archive">();
    scopes.add(scope);
    scan.taskIdsByScope.set(entry.name, scopes);
    await validateTaskDirectory(paths, taskDirectory, entry.name, scope, limits, scan.activeTaskIds, add);
  }
}

async function validateTaskDirectory(
  paths: VineaPaths,
  directory: string,
  directoryName: string,
  scope: "active" | "archive",
  limits: ContextLimits | null,
  activeTaskIds: Set<string>,
  add: IssueAdder,
): Promise<void> {
  const taskFilename = join(directory, "task.json");
  const task = await readJsonObject(taskFilename, "TASK", add);
  if (task !== null) {
    const taskId = typeof task.id === "string" ? task.id : null;
    if (!TASK_ID_PATTERN.test(directoryName)) {
      add("TASK_ID_INVALID", taskFilename, `Task directory name is invalid: ${directoryName}.`);
    }
    if (taskId !== directoryName) {
      add("TASK_ID_MISMATCH", taskFilename, `Task ID ${String(task.id)} does not match directory ${directoryName}.`);
    }
    if (task.schemaVersion !== SCHEMA_VERSION) {
      add(
        "TASK_SCHEMA_UNSUPPORTED",
        taskFilename,
        `Task schema ${String(task.schemaVersion)} is unsupported; this CLI supports ${SCHEMA_VERSION}.`,
      );
    }
    const status = typeof task.status === "string" ? task.status : "";
    if (!ALL_STATUSES.has(status)) {
      add("TASK_STATUS_INVALID", taskFilename, `Unknown task status: ${String(task.status)}.`);
    } else if (
      (scope === "active" && status === "archived")
      || (scope === "archive" && status !== "archived")
    ) {
      add(
        "TASK_STATE_SCOPE_INVALID",
        taskFilename,
        `Status ${status} is invalid in ${scope} task storage.`,
      );
    }
    if (!isTaskRecordShape(task)) {
      add("TASK_RECORD_INVALID", taskFilename, "Task record does not match the supported task structure.");
    }
    validateTaskRequirementIds(task, taskFilename, add);
    if (
      scope === "active"
      && taskId === directoryName
      && TASK_ID_PATTERN.test(taskId)
      && task.schemaVersion === SCHEMA_VERSION
      && ACTIVE_STATUSES.has(status)
      && isTaskRecordShape(task)
    ) {
      activeTaskIds.add(taskId);
    }
  }

  for (const artifact of REQUIRED_TASK_ARTIFACTS) {
    const filename = join(directory, artifact);
    const kind = await entryKind(filename);
    if (kind === "missing") {
      add("TASK_ARTIFACT_MISSING", filename, `Required task artifact ${artifact} is missing.`);
    } else if (kind !== "file") {
      add("TASK_ARTIFACT_INVALID", filename, `Required task artifact ${artifact} must be a regular file.`);
    }
  }

  await validateContextManifest(paths, join(directory, "context.jsonl"), limits, add);
  const evidence = await validateEvidenceArtifact(join(directory, "evidence.jsonl"), add);
  await validateJournalArtifact(paths, join(directory, "journal.md"), task, directory, scope, add);
  await validateCheckArtifact(paths, join(directory, "check.md"), task, evidence, add);
}

async function validateContextManifest(
  paths: VineaPaths,
  filename: string,
  limits: ContextLimits | null,
  add: IssueAdder,
): Promise<void> {
  const contents = await readOptionalRegularFile(filename, "CONTEXT", add);
  if (contents === null) return;
  let files = 0;
  let estimatedBytes = 0;
  const pathsSeen = new Set<string>();
  for (const { line, lineNumber } of jsonlLines(contents)) {
    const value = parseJsonl(line, lineNumber, filename, "CONTEXT_JSONL_INVALID", add);
    if (value === null) continue;
    if (!isRecord(value)) {
      add("CONTEXT_RECORD_INVALID", filename, `Line ${lineNumber} must contain an object.`);
      continue;
    }
    if (value.schemaVersion !== SCHEMA_VERSION) {
      add(
        "CONTEXT_SCHEMA_UNSUPPORTED",
        filename,
        `Line ${lineNumber} uses unsupported schema ${String(value.schemaVersion)}.`,
      );
    }
    const validBytes = isNonNegativeSafeInteger(value.estimatedBytes);
    const normalizedPath = typeof value.path === "string"
      ? normalizeRepositoryPath(value.path)
      : null;
    if (
      typeof value.path !== "string"
      || normalizedPath === null
      || normalizedPath !== value.path
      || typeof value.purpose !== "string"
      || value.purpose.trim() === ""
      || !validBytes
      || !isIsoTimestamp(value.addedAt)
    ) {
      add("CONTEXT_RECORD_INVALID", filename, `Line ${lineNumber} is not a valid context reference.`);
    }
    files += 1;
    if (validBytes) estimatedBytes += value.estimatedBytes as number;
    if (typeof value.path !== "string") continue;
    const duplicateKey = normalizedPath ?? value.path;
    if (pathsSeen.has(duplicateKey)) {
      add("CONTEXT_DUPLICATE", filename, `Line ${lineNumber} duplicates context path ${duplicateKey}.`);
    } else {
      pathsSeen.add(duplicateKey);
    }
    await validateContextPath(paths, filename, value.path, lineNumber, add);
  }
  if (limits !== null && files > limits.maxFiles) {
    add(
      "CONTEXT_FILE_BUDGET_EXCEEDED",
      filename,
      `Context manifest has ${files} files; configured maximum is ${limits.maxFiles}.`,
    );
  }
  if (limits !== null && estimatedBytes > limits.maxEstimatedBytes) {
    add(
      "CONTEXT_BYTE_BUDGET_EXCEEDED",
      filename,
      `Context manifest estimates ${estimatedBytes} bytes; configured maximum is ${limits.maxEstimatedBytes}.`,
    );
  }
}

async function validateContextPath(
  paths: VineaPaths,
  manifest: string,
  repositoryPath: string,
  lineNumber: number,
  add: IssueAdder,
): Promise<void> {
  const normalized = normalizeRepositoryPath(repositoryPath);
  if (normalized === null) {
    add("CONTEXT_PATH_INVALID", manifest, `Line ${lineNumber} has an unsafe context path: ${repositoryPath}.`);
    return;
  }
  let current = paths.repoRoot;
  for (const segment of normalized.split("/")) {
    current = join(current, segment);
    const kind = await entryKind(current);
    if (kind === "missing") {
      add("CONTEXT_PATH_MISSING", manifest, `Line ${lineNumber} references missing path ${normalized}.`);
      return;
    }
    if (kind === "symlink") {
      add("CONTEXT_PATH_UNSAFE", manifest, `Line ${lineNumber} references symbolic link ${normalized}.`);
      return;
    }
  }
  if (await entryKind(resolve(paths.repoRoot, normalized)) !== "file") {
    add("CONTEXT_PATH_INVALID", manifest, `Line ${lineNumber} must reference a regular file: ${normalized}.`);
  }
}

async function validateEvidenceArtifact(filename: string, add: IssueAdder): Promise<EvidenceRecord[]> {
  const contents = await readOptionalRegularFile(filename, "EVIDENCE", add);
  if (contents === null) return [];
  const records: EvidenceRecord[] = [];
  const seenIds = new Set<string>();
  for (const { line, lineNumber } of jsonlLines(contents)) {
    const value = parseJsonl(line, lineNumber, filename, "EVIDENCE_JSONL_INVALID", add);
    if (value === null) continue;
    if (isRecord(value) && value.schemaVersion !== SCHEMA_VERSION) {
      add(
        "EVIDENCE_SCHEMA_UNSUPPORTED",
        filename,
        `Line ${lineNumber} uses unsupported schema ${String(value.schemaVersion)}.`,
      );
    }
    let record: EvidenceRecord;
    try {
      record = validateEvidenceRecord(value);
    } catch {
      add("EVIDENCE_RECORD_INVALID", filename, `Line ${lineNumber} is not a valid evidence record.`);
      continue;
    }
    if (seenIds.has(record.id)) {
      add("EVIDENCE_ID_DUPLICATE", filename, `Line ${lineNumber} duplicates evidence ID ${record.id}.`);
      continue;
    }
    seenIds.add(record.id);
    records.push(record);
  }
  return records;
}

async function validateJournalArtifact(
  paths: VineaPaths,
  filename: string,
  task: Record<string, unknown> | null,
  taskDirectory: string,
  scope: "active" | "archive",
  add: IssueAdder,
): Promise<void> {
  const contents = await readOptionalRegularFile(filename, "JOURNAL", add);
  if (contents === null) return;
  if (contents.trim() === "") {
    add("JOURNAL_EMPTY", filename, "Task journal must contain its creation event.");
    return;
  }
  const operationIds = new Set<string>();
  let creationCount = 0;
  let firstEvent = true;
  let currentStatus: TaskStatus | null = null;
  let replayIsValid = true;
  let lastTransition: { oldStatus: TaskStatus; newStatus: TaskStatus } | null = null;
  let lastValidEventType: string | null = null;
  const pendingMutationIntents = new Map<string, Record<string, unknown>>();
  const committedMutationIntents: Record<string, unknown>[] = [];
  const latestLearningMutationOperation = new Map<string, string>();
  for (const { line, lineNumber } of jsonlLines(contents)) {
    const value = parseJsonl(line, lineNumber, filename, "JOURNAL_JSONL_INVALID", add);
    if (value === null) continue;
    if (isRecord(value) && value.schemaVersion !== SCHEMA_VERSION) {
      add(
        "JOURNAL_SCHEMA_UNSUPPORTED",
        filename,
        `Line ${lineNumber} uses unsupported schema ${String(value.schemaVersion)}.`,
      );
    }
    if (!isJournalEvent(value)) {
      add("JOURNAL_EVENT_INVALID", filename, `Line ${lineNumber} is not a valid journal event.`);
      replayIsValid = false;
      continue;
    }
    lastValidEventType = value.type;
    if (value.type === "mutation_intent") {
      const operationId = value.operationId as string;
      if (pendingMutationIntents.has(operationId)) {
        add("MUTATION_INTENT_DUPLICATE", filename, `Line ${lineNumber} duplicates pending mutation intent ${operationId}.`);
      } else {
        pendingMutationIntents.set(operationId, value);
      }
    } else if (isMutationCompletionEvent(value)) {
      const operationId = value.operationId as string;
      const intent = pendingMutationIntents.get(operationId);
      if (intent !== undefined) {
        if (!matchesMutationCompletion(intent, value)) {
          add("MUTATION_COMPLETION_MISMATCH", filename, `Line ${lineNumber} does not match mutation intent ${operationId}.`);
        } else {
          pendingMutationIntents.delete(operationId);
          committedMutationIntents.push(intent);
        }
      }
      if (String(value.type).startsWith("learning_") && typeof value.learningCandidateId === "string") {
        latestLearningMutationOperation.set(value.learningCandidateId, operationId);
      }
    }
    if (value.type === "created") {
      creationCount += 1;
      if (!firstEvent) {
        add("JOURNAL_CREATION_NOT_FIRST", filename, `Line ${lineNumber} creation event must be the first journal event.`);
        replayIsValid = false;
      }
      if (creationCount === 1) currentStatus = "planning";
    } else if (creationCount === 0) {
      add("JOURNAL_EVENT_BEFORE_CREATION", filename, `Line ${lineNumber} occurs before the task creation event.`);
      replayIsValid = false;
    } else if (value.type === "transition_intent") {
      const oldStatus = value.oldStatus as TaskStatus;
      const newStatus = value.newStatus as TaskStatus;
      if (currentStatus === null || oldStatus !== currentStatus) {
        add(
          "JOURNAL_STATUS_DISCONTINUITY",
          filename,
          `Line ${lineNumber} transition starts at ${oldStatus}, but the prior journal status is ${String(currentStatus)}.`,
        );
        replayIsValid = false;
      } else if (!isLegalJournalTransition(oldStatus, newStatus)) {
        add(
          "JOURNAL_TRANSITION_INVALID",
          filename,
          `Line ${lineNumber} transition from ${oldStatus} to ${newStatus} is not allowed.`,
        );
        replayIsValid = false;
      } else {
        currentStatus = newStatus;
        lastTransition = { oldStatus, newStatus };
      }
    } else if (value.type === "continued") {
      const status = value.status as TaskStatus;
      if (currentStatus === null || status !== currentStatus) {
        add(
          "JOURNAL_STATUS_DISCONTINUITY",
          filename,
          `Line ${lineNumber} continuation records ${status}, but the prior journal status is ${String(currentStatus)}.`,
        );
        replayIsValid = false;
      }
    }
    // A mutation intent and its semantic completion deliberately share one
    // operation ID. The completion is the unique operation record; only it
    // participates in the legacy duplicate-ID check.
    if (typeof value.operationId === "string" && value.type !== "mutation_intent") {
      if (operationIds.has(value.operationId)) {
        add("JOURNAL_OPERATION_ID_DUPLICATE", filename, `Line ${lineNumber} duplicates operation ID ${value.operationId}.`);
      } else {
        operationIds.add(value.operationId);
      }
    }
    firstEvent = false;
  }
  if (creationCount === 0) {
    add("JOURNAL_CREATION_MISSING", filename, "Task journal is missing its creation event.");
  } else if (creationCount > 1) {
    add("JOURNAL_CREATION_DUPLICATE", filename, "Task journal contains multiple creation events.");
    replayIsValid = false;
  }
  if (
    replayIsValid
    && creationCount === 1
    && currentStatus !== null
    && task !== null
    && isTaskStatus(task.status)
    && task.status !== currentStatus
    && (
      lastValidEventType !== "transition_intent"
      || lastTransition === null
      || task.status !== lastTransition.oldStatus
    )
  ) {
    add(
      "JOURNAL_TASK_STATUS_MISMATCH",
      filename,
      `Journal resolves to ${currentStatus}, but task.json records ${task.status}.`,
    );
  }
  for (const intent of pendingMutationIntents.values()) {
    add(
      "MUTATION_INTENT_UNCOMMITTED",
      filename,
      `Mutation intent ${String(intent.operationId)} for ${String(intent.mutationKind)} has no matching completion event.`,
    );
  }
  const pendingTargetFiles = new Set<string>();
  for (const intent of pendingMutationIntents.values()) {
    const expected = intent.expected;
    if (!isMutationTargetSummary(expected)) continue;
    const identity = expected.identity as Record<string, unknown>;
    if (String(intent.mutationKind).startsWith("learning_")
      && typeof identity.learningCandidateId === "string") {
      latestLearningMutationOperation.set(identity.learningCandidateId, intent.operationId as string);
    }
    for (const target of expected.files as Array<Record<string, unknown>>) {
      pendingTargetFiles.add(target.path as string);
    }
  }
  const latestIntentByFile = new Map<string, Record<string, unknown>>();
  const latestIntentBySemanticIdentity = new Map<string, Record<string, unknown>>();
  for (const intent of committedMutationIntents) {
    latestIntentBySemanticIdentity.set(mutationSemanticIdentityKey(intent), intent);
    const expected = intent.expected as Record<string, unknown>;
    if (!isMutationTargetSummary(expected)) continue;
    for (const target of expected.files as Array<Record<string, unknown>>) {
      const path = target.path as string;
      if (!path.endsWith("/task.json")) latestIntentByFile.set(path, intent);
    }
  }
  for (const intent of latestIntentBySemanticIdentity.values()) {
    if (isSupersededLearningMutation(intent, latestLearningMutationOperation)) continue;
    if (!semanticMutationTargetMatches(task, intent)) {
      add(
        "MUTATION_TARGET_MISMATCH",
        filename,
        `Completed mutation ${String(intent.operationId)} for ${String(intent.mutationKind)} does not match its expected managed target identity.`,
      );
    }
  }
  for (const [path, intent] of latestIntentByFile) {
    if (pendingTargetFiles.has(path)) continue;
    if (!await mutationFilesMatch(paths, taskDirectory, scope, intent.expected as Record<string, unknown>)) {
      add(
        "MUTATION_TARGET_MISMATCH",
        filename,
        `Completed mutation ${String(intent.operationId)} for ${String(intent.mutationKind)} does not match its latest expected managed files.`,
      );
    }
  }
}

function isSupersededLearningMutation(
  intent: Record<string, unknown>,
  latestLearningMutationOperation: ReadonlyMap<string, string>,
): boolean {
  const expected = intent.expected;
  if (!isMutationTargetSummary(expected) || !String(intent.mutationKind).startsWith("learning_")) return false;
  const id = (expected.identity as Record<string, unknown>).learningCandidateId;
  return typeof id === "string" && latestLearningMutationOperation.get(id) !== intent.operationId;
}

function mutationSemanticIdentityKey(intent: Record<string, unknown>): string {
  const expected = intent.expected;
  if (!isMutationTargetSummary(expected)) return `operation:${String(intent.operationId)}`;
  const identity = expected.identity as Record<string, unknown>;
  const mutationKind = String(intent.mutationKind);
  if (mutationKind.startsWith("learning_") && typeof identity.learningCandidateId === "string") {
    return `learning:${identity.learningCandidateId}`;
  }
  if (typeof identity.requirementId === "string") {
    return `${mutationKind}:${identity.requirementId}`;
  }
  return `operation:${String(intent.operationId)}`;
}

async function mutationFilesMatch(
  paths: VineaPaths,
  taskDirectory: string,
  scope: "active" | "archive",
  expected: Record<string, unknown>,
): Promise<boolean> {
  if (!isMutationTargetSummary(expected)) return false;
  for (const target of expected.files as Array<Record<string, unknown>>) {
    const path = target.path as string;
    if (!isManagedMutationTarget(path)) return false;
    const filename = resolveMutationTargetFilename(paths, taskDirectory, scope, path);
    if (filename === null) return false;
    if (path.endsWith("/task.json")) continue;
    if (await entryKind(filename) !== "file") return false;
    try {
      const contents = await readFile(filename);
      if (createHash("sha256").update(contents).digest("hex") !== target.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function resolveMutationTargetFilename(
  paths: VineaPaths,
  taskDirectory: string,
  scope: "active" | "archive",
  target: string,
): string | null {
  if (target === ".vinea/specs/index.md" || /^\.vinea\/specs\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.test(target)) {
    return resolve(paths.repoRoot, target);
  }
  const taskPrefix = relative(paths.repoRoot, taskDirectory).split("\\").join("/");
  const artifact = target.startsWith(`${taskPrefix}/`) ? target.slice(taskPrefix.length + 1) : null;
  if (artifact !== null && isMutationTaskArtifact(artifact)) return join(taskDirectory, artifact);
  if (scope !== "archive") return null;
  const activePrefix = taskPrefix.replace(/^\.vinea\/tasks\/archive\//u, ".vinea/tasks/active/");
  if (activePrefix === taskPrefix || !target.startsWith(`${activePrefix}/`)) return null;
  const legacyArtifact = target.slice(activePrefix.length + 1);
  return isMutationTaskArtifact(legacyArtifact) ? join(taskDirectory, legacyArtifact) : null;
}

function isMutationTaskArtifact(value: string): boolean {
  return /^(?:task\.json|brief\.md|plan\.md|context\.jsonl|evidence\.jsonl|check\.md)$/u.test(value);
}

function semanticMutationTargetMatches(task: Record<string, unknown> | null, intent: Record<string, unknown>): boolean {
  const expected = intent.expected;
  if (task === null || !isMutationTargetSummary(expected)) return false;
  const identity = expected.identity as Record<string, unknown>;
  const mutationKind = intent.mutationKind;
  if (mutationKind === "requirement_added" || mutationKind === "acceptance_criterion_added") {
    const collection = mutationKind === "requirement_added" ? task.requirements : task.acceptanceCriteria;
    const requirement = Array.isArray(collection)
      ? collection.find((item) => isRecord(item) && item.id === identity.requirementId)
      : undefined;
    return requirement !== undefined && mutationIdentityValueMatches(requirement, identity);
  }
  if (mutationKind === "learning_proposed") {
    return hasLearningCandidate(task, identity, "proposed");
  }
  if (mutationKind === "learning_archived") {
    return hasLearningCandidate(task, identity, "archived");
  }
  if (mutationKind === "learning_accepted") {
    return hasLearningCandidate(task, identity, "accepted");
  }
  return true;
}

function hasLearningCandidate(task: Record<string, unknown>, identity: Record<string, unknown>, status: string): boolean {
  if (typeof identity.learningCandidateId !== "string" || !Array.isArray(task.learningCandidates)) return false;
  const candidate = task.learningCandidates.find((item) => isRecord(item)
    && item.id === identity.learningCandidateId
    && item.status === status);
  return candidate !== undefined && mutationIdentityValueMatches(candidate, identity);
}

function mutationIdentityValueMatches(value: unknown, identity: Record<string, unknown>): boolean {
  if (identity.valueSha256 === undefined) return true;
  return typeof identity.valueSha256 === "string"
    && /^[a-f0-9]{64}$/u.test(identity.valueSha256)
    && createHash("sha256").update(stableJson(value)).digest("hex") === identity.valueSha256;
}

async function validateCheckArtifact(
  paths: VineaPaths,
  filename: string,
  task: Record<string, unknown> | null,
  evidence: EvidenceRecord[],
  add: IssueAdder,
): Promise<void> {
  const contents = await readOptionalRegularFile(filename, "CHECK", add);
  if (contents === null || contents === "") return;
  const declaredIds = task === null ? [] : taskRequirementIds(task);
  try {
    parseCheckDocument(contents, paths.repoRoot, declaredIds, evidence, filename);
  } catch {
    add(
      "CHECK_PAYLOAD_INVALID",
      filename,
      "Check document must match a valid authoritative payload, declared requirements, evidence, and rendered table.",
    );
  }
}

async function validateSessionBindings(
  paths: VineaPaths,
  activeTaskIds: ReadonlySet<string>,
  add: IssueAdder,
): Promise<void> {
  const runtimeKind = await entryKind(paths.runtime);
  if (runtimeKind === "missing") return;
  if (runtimeKind !== "directory") {
    add("RUNTIME_INVALID", paths.runtime, "Runtime state must be a regular directory.");
    return;
  }
  const sessionsKind = await entryKind(paths.sessions);
  if (sessionsKind === "missing") return;
  if (sessionsKind !== "directory") {
    add("RUNTIME_INVALID", paths.sessions, "Session binding storage must be a regular directory.");
    return;
  }

  let entries;
  try {
    entries = await readdir(paths.sessions, { withFileTypes: true });
  } catch (error) {
    add("RUNTIME_UNREADABLE", paths.sessions, describeError("Unable to list session bindings", error));
    return;
  }
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const filename = join(paths.sessions, entry.name);
    const validFilename = isValidSessionBindingFilename(entry.name);
    if (!validFilename) {
      add(
        "SESSION_FILENAME_INVALID",
        filename,
        "Session bindings must use <codex|claude>-sid-<lowercase UTF-8 hex>.json filenames.",
      );
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      add("SESSION_BINDING_INVALID", filename, "Session bindings must be regular files.");
      continue;
    }
    if (!validFilename) continue;
    const value = await readJsonObject(filename, "SESSION_BINDING", add);
    if (value === null) continue;
    if (value.schemaVersion !== SCHEMA_VERSION) {
      add(
        "SESSION_SCHEMA_UNSUPPORTED",
        filename,
        `Session binding schema ${String(value.schemaVersion)} is unsupported.`,
      );
    }
    if (!isSessionBindingShape(value)) {
      add("SESSION_BINDING_INVALID", filename, "Session binding record is malformed.");
      continue;
    }
    if (!activeTaskIds.has(value.taskId as string)) {
      add(
        "SESSION_BINDING_STALE",
        filename,
        `Session binding points to non-active task ${String(value.taskId)}.`,
      );
    }
  }
}

async function readJsonObject(
  filename: string,
  prefix: string,
  add: IssueAdder,
): Promise<Record<string, unknown> | null> {
  const contents = await readRequiredRegularFile(filename, prefix, add);
  if (contents === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch {
    add(`${prefix}_JSON_INVALID`, filename, "File does not contain valid JSON.");
    return null;
  }
  if (!isRecord(value)) {
    add(`${prefix}_INVALID`, filename, "File must contain a JSON object.");
    return null;
  }
  return value;
}

async function readRequiredRegularFile(
  filename: string,
  prefix: string,
  add: IssueAdder,
): Promise<string | null> {
  const kind = await entryKind(filename);
  if (kind === "missing") {
    add(`${prefix}_MISSING`, filename, "Required file is missing.");
    return null;
  }
  if (kind !== "file") {
    add(`${prefix}_INVALID`, filename, "Expected a regular file and not a symbolic link.");
    return null;
  }
  try {
    return await readFile(filename, "utf8");
  } catch (error) {
    add(`${prefix}_UNREADABLE`, filename, describeError("Unable to read file", error));
    return null;
  }
}

async function readOptionalRegularFile(
  filename: string,
  prefix: string,
  add: IssueAdder,
): Promise<string | null> {
  if (await entryKind(filename) === "missing") return null;
  return readRequiredRegularFile(filename, prefix, add);
}

function parseJsonl(
  line: string,
  lineNumber: number,
  filename: string,
  code: string,
  add: IssueAdder,
): unknown | null {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    add(code, filename, `Line ${lineNumber} is not valid JSON.`);
    return null;
  }
}

function jsonlLines(contents: string): Array<{ line: string; lineNumber: number }> {
  return contents
    .split("\n")
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim() !== "");
}

function isTaskRecordShape(value: Record<string, unknown>): boolean {
  return value.schemaVersion === SCHEMA_VERSION
    && typeof value.id === "string"
    && TASK_ID_PATTERN.test(value.id)
    && typeof value.title === "string"
    && value.title.trim() !== ""
    && ALL_STATUSES.has(String(value.status))
    && isRecord(value.risk)
    && ["low", "medium", "high"].includes(String(value.risk.level))
    && isStringArray(value.risk.reasons)
    && ["standard", "tdd"].includes(String(value.qualityMode))
    && ["single-agent", "delegated"].includes(String(value.executionMode))
    && Array.isArray(value.requirements)
    && value.requirements.every(isRequirement)
    && Array.isArray(value.acceptanceCriteria)
    && value.acceptanceCriteria.every(isRequirement)
    && isLearningCandidates(value.learningCandidates)
    && isCommitMetadata(value.commit)
    && isIsoTimestamp(value.createdAt)
    && isIsoTimestamp(value.updatedAt);
}

function validateTaskRequirementIds(
  task: Record<string, unknown>,
  filename: string,
  add: IssueAdder,
): void {
  const seen = new Set<string>();
  for (const id of taskRequirementIds(task)) {
    if (seen.has(id)) {
      add("TASK_REQUIREMENT_ID_DUPLICATE", filename, `Task declares duplicate requirement or acceptance ID ${id}.`);
    } else {
      seen.add(id);
    }
  }
}

function taskRequirementIds(task: Record<string, unknown>): string[] {
  return [task.requirements, task.acceptanceCriteria]
    .flatMap((collection) => Array.isArray(collection) ? collection : [])
    .flatMap((requirement) => isRecord(requirement) && typeof requirement.id === "string" ? [requirement.id] : []);
}

function isLegalJournalTransition(oldStatus: TaskStatus, newStatus: TaskStatus): boolean {
  if (oldStatus === newStatus) return false;
  if (oldStatus === "blocked") return UNBLOCK_TARGETS.has(newStatus);
  return (BLOCKABLE_STATUSES.has(oldStatus) && newStatus === "blocked")
    || FORWARD_TRANSITIONS[oldStatus] === newStatus;
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && ALL_STATUSES.has(value);
}

function isJournalEvent(value: unknown): value is Record<string, unknown> & { type: string } {
  if (!isRecord(value)
    || value.schemaVersion !== SCHEMA_VERSION
    || !isIsoTimestamp(value.timestamp)
    || !isNonemptyString(value.actor)
    || typeof value.type !== "string") {
    return false;
  }
  if (value.type === "created") {
    return hasOnlyKeys(value, ["schemaVersion", "type", "timestamp", "actor", "confirmation", "status"])
      && value.confirmation === "user"
      && value.status === "planning";
  }
  if (value.type === "transition_intent") {
    return hasOnlyKeys(value, [
      "schemaVersion", "type", "operationId", "timestamp", "actor", "reason", "oldStatus", "newStatus",
    ])
      && isNonemptyString(value.operationId)
      && isNonemptyString(value.reason)
      && ALL_STATUSES.has(String(value.oldStatus))
      && ALL_STATUSES.has(String(value.newStatus));
  }
  if (value.type === "mutation_intent") {
    return hasOnlyKeys(value, [
      "schemaVersion", "type", "operationId", "timestamp", "actor", "mutationKind", "fingerprint", "expected", "completion",
    ])
      && isNonemptyString(value.operationId)
      && isMutationKind(value.mutationKind)
      && /^[a-f0-9]{64}$/u.test(String(value.fingerprint))
      && isMutationTargetSummary(value.expected)
      && isMutationCompletion(value.completion, value.operationId, value.mutationKind);
  }
  if (value.type === "continued") {
    return hasOnlyKeys(value, [
      "schemaVersion", "type", "timestamp", "actor", "confirmation", "host", "sessionBound", "started", "status",
    ])
      && value.confirmation === "user"
      && (value.host === "codex" || value.host === "claude")
      && typeof value.sessionBound === "boolean"
      && typeof value.started === "boolean"
      && ALL_STATUSES.has(String(value.status));
  }
  if (value.type === "check_recorded" || value.type === "check_updated") {
    return hasOnlyKeys(value, [
      "schemaVersion", "type", "mutationKind", "operationId", "timestamp", "actor", "requirementId", "result",
    ])
      && isNonemptyString(value.operationId)
      && (value.mutationKind === undefined || value.mutationKind === value.type)
      && isNonemptyString(value.requirementId)
      && ["pass", "fail", "uncovered"].includes(String(value.result));
  }
  if (!TASK_MUTATION_KINDS.has(value.type)) return false;
  if (value.mutationKind !== value.type
    || !isNonemptyString(value.operationId)) {
    return false;
  }
  if (value.type === "requirement_added" || value.type === "acceptance_criterion_added") {
    return hasOnlyKeys(value, [
      "schemaVersion", "type", "mutationKind", "operationId", "timestamp", "actor", "requirementId",
    ]) && isNonemptyString(value.requirementId);
  }
  if (value.type === "brief_set") {
    return hasOnlyKeys(value, [
      "schemaVersion", "type", "mutationKind", "operationId", "timestamp", "actor", "artifact",
    ]) && value.artifact === "brief.md";
  }
  if (value.type === "plan_set") {
    return hasOnlyKeys(value, [
      "schemaVersion", "type", "mutationKind", "operationId", "timestamp", "actor", "artifact",
    ]) && value.artifact === "plan.md";
  }
  if (value.type === "context_added") {
    return hasOnlyKeys(value, [
      "schemaVersion", "type", "mutationKind", "operationId", "timestamp", "actor", "path",
    ]) && isNonemptyString(value.path);
  }
  if (value.type === "evidence_recorded") {
    return hasOnlyKeys(value, [
      "schemaVersion", "type", "mutationKind", "operationId", "timestamp", "actor", "evidenceId", "evidenceKind",
    ]) && isNonemptyString(value.evidenceId)
      && ["command", "manual", "tdd-red", "tdd-green"].includes(String(value.evidenceKind));
  }
  if (value.type === "learning_accepted") {
    return hasOnlyKeys(value, [
      "schemaVersion", "type", "mutationKind", "operationId", "timestamp", "actor", "learningCandidateId", "confirmedBy",
    ]) && isNonemptyString(value.learningCandidateId) && value.confirmedBy === "user";
  }
  return hasOnlyKeys(value, [
    "schemaVersion", "type", "mutationKind", "operationId", "timestamp", "actor", "learningCandidateId",
  ]) && isNonemptyString(value.learningCandidateId);
}

function isMutationCompletionEvent(value: Record<string, unknown>): boolean {
  return typeof value.type === "string"
    && (value.type === "check_recorded"
    || value.type === "check_updated"
    || TASK_MUTATION_KINDS.has(value.type));
}

function isMutationKind(value: unknown): boolean {
  return typeof value === "string" && (TASK_MUTATION_KINDS.has(value)
    || value === "check_recorded"
    || value === "check_updated"
    || value === "check_upsert");
}

function isMutationTargetSummary(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["identity", "files"]) || !isRecord(value.identity) || !Array.isArray(value.files)) {
    return false;
  }
  if (Object.values(value.identity).some((item) => typeof item !== "string" || item.trim() === "")) return false;
  const paths = new Set<string>();
  return value.files.length > 0 && value.files.every((target) => {
    if (!isRecord(target)
      || !hasOnlyKeys(target, ["path", "sha256"])
      || !isNonemptyString(target.path)
      || !/^[a-f0-9]{64}$/u.test(String(target.sha256))
      || paths.has(target.path)) {
      return false;
    }
    paths.add(target.path);
    return true;
  });
}

function isMutationCompletion(
  value: unknown,
  operationId: unknown,
  _mutationKind: unknown,
): boolean {
  if (!isRecord(value)) return false;
  return isJournalEvent({ ...value, operationId }) && value.operationId === undefined;
}

function matchesMutationCompletion(intent: Record<string, unknown>, completion: Record<string, unknown>): boolean {
  const expected = intent.completion;
  if (!isRecord(expected)) return false;
  const actual = { ...completion };
  delete actual.operationId;
  return stableJson(expected) === stableJson(actual);
}

function isManagedMutationTarget(path: string): boolean {
  return /^\.vinea\/tasks\/(?:active|archive)\/t-\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*\/(?:task\.json|brief\.md|plan\.md|context\.jsonl|evidence\.jsonl|check\.md)$/u.test(path)
    || path === ".vinea/specs/index.md"
    || /^\.vinea\/specs\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.test(path);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isSessionBindingShape(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => ["schemaVersion", "taskId", "boundAt"].includes(key))
    && value.schemaVersion === SCHEMA_VERSION
    && typeof value.taskId === "string"
    && TASK_ID_PATTERN.test(value.taskId)
    && isIsoTimestamp(value.boundAt);
}

function isRequirement(value: unknown): boolean {
  return isRecord(value)
    && Object.keys(value).every((key) => ["schemaVersion", "id", "text", "createdAt"].includes(key))
    && value.schemaVersion === SCHEMA_VERSION
    && typeof value.id === "string"
    && value.id.trim() !== ""
    && typeof value.text === "string"
    && value.text.trim() !== ""
    && isIsoTimestamp(value.createdAt);
}

function isLearningCandidates(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const candidate of value) {
    if (
      !isRecord(candidate)
      || candidate.schemaVersion !== SCHEMA_VERSION
      || typeof candidate.id !== "string"
      || candidate.id.trim() === ""
      || ids.has(candidate.id)
      || typeof candidate.domain !== "string"
      || candidate.domain.trim() === ""
      || typeof candidate.text !== "string"
      || candidate.text.trim() === ""
      || typeof candidate.rationale !== "string"
      || candidate.rationale.trim() === ""
      || !isIsoTimestamp(candidate.proposedAt)
    ) {
      return false;
    }
    ids.add(candidate.id);
    if (candidate.status === "proposed") continue;
    if (
      candidate.status === "accepted"
      && candidate.confirmedBy === "user"
      && isIsoTimestamp(candidate.acceptedAt)
    ) {
      continue;
    }
    if (
      candidate.status === "archived"
      && typeof candidate.archiveReason === "string"
      && candidate.archiveReason.trim() !== ""
      && isIsoTimestamp(candidate.archivedAt)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function isCommitMetadata(value: unknown): boolean {
  if (value === null) return true;
  return isRecord(value)
    && Object.keys(value).every((key) => ["sha", "message"].includes(key))
    && typeof value.sha === "string"
    && value.sha.trim() !== ""
    && (value.message === undefined || typeof value.message === "string");
}

function isValidSessionBindingFilename(filename: string): boolean {
  const match = /^(?:codex|claude)-sid-([0-9a-f]+)\.json$/.exec(filename);
  if (match === null) return false;
  const hex = match[1]!;
  if (hex.length === 0 || hex.length % 2 !== 0 || hex.length > 238) return false;
  const bytes = Buffer.from(hex, "hex");
  let sessionId: string;
  try {
    sessionId = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  return sessionId !== ""
    && sessionId !== "."
    && sessionId !== ".."
    && !sessionId.includes("/")
    && !sessionId.includes("\\")
    && !sessionId.includes("\0")
    && Buffer.from(sessionId, "utf8").toString("hex") === hex;
}

function normalizeRepositoryPath(input: string): string | null {
  const value = input.trim();
  if (value === "" || isAbsolute(value) || /^[a-zA-Z]:[/\\]/.test(value) || value.startsWith("\\")) {
    return null;
  }
  const segments = value.split(/[/\\]/);
  if (segments.includes("..")) return null;
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (
    normalized === ""
    || normalized === ".vinea/.runtime"
    || normalized.startsWith(".vinea/.runtime/")
  ) {
    return null;
  }
  return normalized;
}

async function entryKind(path: string): Promise<"missing" | "file" | "directory" | "symlink" | "other"> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) return "symlink";
    if (entry.isFile()) return "file";
    if (entry.isDirectory()) return "directory";
    return "other";
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return "missing";
    return "other";
  }
}

function displayPath(paths: VineaPaths, filename: string): string {
  const value = relative(paths.repoRoot, filename).split("\\").join("/");
  return value === "" ? "." : value;
}

function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.sort(
    (left, right) =>
      compareText(left.path, right.path)
      || compareText(left.code, right.code)
      || compareText(left.message, right.message),
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function describeError(prefix: string, error: unknown): string {
  return `${prefix}: ${error instanceof Error ? error.message : "unknown error"}.`;
}

type IssueAdder = (code: string, filename: string, message: string) => void;
