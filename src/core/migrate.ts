import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { migrateLegacyCheckDocument } from "./check.js";
import { normalizeEvidenceRecord } from "./evidence.js";
import { SchemaError } from "./errors.js";
import { readJson, writeJsonAtomic } from "./json.js";
import {
  readSchemaMigrationState,
  writeSchemaMigrationState,
  type SchemaMigrationState,
} from "./migration-state.js";
import { assertNoSymlink, type VineaPaths } from "./paths.js";
import { assertSupportedSchema } from "./schema.js";
import { writeManagedMutationTarget, type TaskLocation } from "./task-store.js";
import {
  LEGACY_SCHEMA_VERSION,
  SCHEMA_VERSION,
  type CommitMetadata,
  type EvidenceRecord,
  type LearningCandidate,
  type Requirement,
  type SessionBinding,
  type TaskRecord,
  type TaskStatus,
  type VineaConfig,
} from "./types.js";

const TASK_ID_PATTERN = /^t-\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TASK_STATUSES = new Set<TaskStatus>([
  "planning",
  "ready",
  "in_progress",
  "checking",
  "finished",
  "archived",
  "blocked",
]);

interface LegacyConfig extends Omit<VineaConfig, "schemaVersion"> {
  schemaVersion: typeof LEGACY_SCHEMA_VERSION;
}

interface LegacyRequirement extends Omit<Requirement, "schemaVersion"> {
  schemaVersion: typeof LEGACY_SCHEMA_VERSION;
}

interface LegacyLearningCandidate extends Omit<LearningCandidate, "schemaVersion"> {
  schemaVersion: typeof LEGACY_SCHEMA_VERSION;
}

interface LegacySessionBinding extends Omit<SessionBinding, "schemaVersion"> {
  schemaVersion: typeof LEGACY_SCHEMA_VERSION;
}

interface LegacyTaskRecord extends Omit<
  TaskRecord,
  "schemaVersion" | "verificationRevision" | "requirements" | "acceptanceCriteria" | "learningCandidates"
> {
  schemaVersion: typeof LEGACY_SCHEMA_VERSION;
  requirements: LegacyRequirement[];
  acceptanceCriteria: LegacyRequirement[];
  learningCandidates?: LegacyLearningCandidate[];
}

export interface MigrationResult {
  status: "migrated" | "already-current";
  fromSchemaVersion: 1 | 2;
  toSchemaVersion: typeof SCHEMA_VERSION;
  migratedTaskIds: string[];
}

export async function migrateWorkspace(paths: VineaPaths): Promise<MigrationResult> {
  const savedState = await readSchemaMigrationState(paths);
  await assertNoSymlink(paths.repoRoot, paths.config);
  const config = await readJson<unknown>(paths.config, paths.repoRoot);
  if (isCurrentConfig(config)) {
    assertSupportedSchema(config, paths.config);
    if (savedState?.phase === "intent") {
      const taskDirectories = await listAllTaskDirectories(paths);
      assertStateMatchesTaskDirectories(savedState, taskDirectories);
      await migrateTaskDirectories(paths, taskDirectories);
      await migrateSessionBindings(paths);
      await completeMigrationState(paths, savedState);
      return migrationResult(savedState.migratedTaskIds);
    }
    const migratedSessionBindings = await migrateSessionBindings(paths);
    if (migratedSessionBindings.length > 0) {
      return migrationResult([], SCHEMA_VERSION);
    }
    return {
      status: "already-current",
      fromSchemaVersion: SCHEMA_VERSION,
      toSchemaVersion: SCHEMA_VERSION,
      migratedTaskIds: [],
    };
  }
  if (!isLegacyConfig(config)) {
    throw new SchemaError(`Vinea migration supports only schema version ${LEGACY_SCHEMA_VERSION} workspaces.`);
  }
  if (savedState?.phase === "completed") {
    throw new SchemaError("Schema migration state is completed while config.json still uses schema version 1.");
  }

  const taskDirectories = await listAllTaskDirectories(paths);
  const state = savedState ?? createMigrationState(taskDirectories);
  assertStateMatchesTaskDirectories(state, taskDirectories);
  if (savedState === null) await writeSchemaMigrationState(paths, state);
  await migrateTaskDirectories(paths, taskDirectories);
  await migrateSessionBindings(paths);

  // Config is deliberately written after every mutable target. A process
  // interrupted at any later boundary has a durable intent and can resume from
  // the idempotent conversions above.
  await writeJsonAtomic(paths.config, {
    ...config,
    schemaVersion: SCHEMA_VERSION,
  }, paths.repoRoot);
  await completeMigrationState(paths, state);
  return migrationResult(state.migratedTaskIds);
}

function createMigrationState(
  taskDirectories: Array<{ directory: string; taskId: string; scope: TaskLocation["scope"] }>,
): SchemaMigrationState {
  const taskIds = taskDirectories.map(({ taskId }) => taskId);
  return {
    schemaVersion: SCHEMA_VERSION,
    type: "schema_migration",
    operationId: `schema-v1-to-v2-${createHash("sha256").update(taskIds.join("\n")).digest("hex").slice(0, 16)}`,
    fromSchemaVersion: LEGACY_SCHEMA_VERSION,
    toSchemaVersion: SCHEMA_VERSION,
    phase: "intent",
    taskIds,
    migratedTaskIds: [...taskIds],
    startedAt: new Date().toISOString(),
  };
}

async function completeMigrationState(paths: VineaPaths, state: SchemaMigrationState): Promise<void> {
  await writeSchemaMigrationState(paths, {
    ...state,
    phase: "completed",
    completedAt: new Date().toISOString(),
  });
}

function migrationResult(
  migratedTaskIds: string[],
  fromSchemaVersion: 1 | 2 = LEGACY_SCHEMA_VERSION,
): MigrationResult {
  return {
    status: "migrated",
    fromSchemaVersion,
    toSchemaVersion: SCHEMA_VERSION,
    migratedTaskIds,
  };
}

async function listAllTaskDirectories(
  paths: VineaPaths,
): Promise<Array<{ directory: string; taskId: string; scope: TaskLocation["scope"] }>> {
  const taskDirectories = [
    ...(await listTaskDirectories(paths, paths.activeTasks, "active")),
    ...(await listTaskDirectories(paths, paths.archivedTasks, "archive")),
  ].sort((left, right) => left.taskId.localeCompare(right.taskId));
  const ids = taskDirectories.map(({ taskId }) => taskId);
  if (new Set(ids).size !== ids.length) {
    throw new SchemaError("A schema migration cannot process duplicate task IDs across active and archive storage.");
  }
  return taskDirectories;
}

function assertStateMatchesTaskDirectories(
  state: SchemaMigrationState,
  taskDirectories: Array<{ taskId: string }>,
): void {
  const taskIds = taskDirectories.map(({ taskId }) => taskId);
  if (taskIds.length !== state.taskIds.length
    || taskIds.some((taskId, index) => taskId !== state.taskIds[index])) {
    throw new SchemaError("Task storage changed during schema migration; rerun only after the workspace is stable.");
  }
}

async function migrateTaskDirectories(
  paths: VineaPaths,
  taskDirectories: Array<{ directory: string; taskId: string; scope: TaskLocation["scope"] }>,
): Promise<void> {
  for (const { directory, taskId, scope } of taskDirectories) {
    const taskPath = join(directory, "task.json");
    await assertNoSymlink(paths.repoRoot, taskPath);
    const task = await readJson<unknown>(taskPath, paths.repoRoot);
    const currentTask = isCurrentTaskRecord(task)
      ? task
      : isLegacyTaskRecord(task) && task.id === taskId
        ? migrateTaskRecord(task)
        : null;
    if (currentTask === null) {
      throw new SchemaError(`Unable to migrate invalid schema-v1 task record in ${taskPath}.`);
    }
    const taskWasMigrated = !isCurrentTaskRecord(task);
    const checkPath = join(directory, "check.md");
    await assertNoSymlink(paths.repoRoot, checkPath);
    const currentCheck = await readFile(checkPath, "utf8");
    const migratedCheck = migrateLegacyCheckDocument(
      currentCheck,
      paths.repoRoot,
      [...currentTask.requirements, ...currentTask.acceptanceCriteria].map(({ id }) => id),
      await readEvidenceForMigration(paths, directory),
      checkPath,
    );
    if (migratedCheck !== currentCheck) {
      await writeManagedMutationTarget(
        paths,
        { task: currentTask, directory, scope },
        checkPath,
        migratedCheck,
      );
    }
    await ensureCheckHistoryArtifact(paths, { task: currentTask, directory, scope });
    if (taskWasMigrated) await writeJsonAtomic(taskPath, currentTask, paths.repoRoot);
  }
}

async function ensureCheckHistoryArtifact(paths: VineaPaths, location: TaskLocation): Promise<void> {
  const filename = join(location.directory, "check-history.jsonl");
  await assertNoSymlink(paths.repoRoot, filename);
  try {
    const contents = await readFile(filename, "utf8");
    if (contents !== "") {
      throw new SchemaError(`Legacy workspace has unexpected check history at ${filename}.`);
    }
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    await writeManagedMutationTarget(paths, location, filename, "");
  }
}

async function migrateSessionBindings(paths: VineaPaths): Promise<string[]> {
  await assertNoSymlink(paths.repoRoot, paths.sessions);
  let entries;
  try {
    entries = await readdir(paths.sessions, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw new SchemaError(`Unable to list session bindings in ${paths.sessions} during migration.`, error);
  }
  const migrated: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const filename = join(paths.sessions, entry.name);
    if (!isSessionBindingFilename(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
      throw new SchemaError(`Invalid session binding ${filename} during migration.`);
    }
    await assertNoSymlink(paths.repoRoot, filename);
    const value = await readJson<unknown>(filename, paths.repoRoot);
    if (isCurrentSessionBinding(value)) continue;
    if (!isLegacySessionBinding(value)) {
      throw new SchemaError(`Unable to migrate invalid schema-v1 session binding ${filename}.`);
    }
    await writeJsonAtomic(filename, {
      ...value,
      schemaVersion: SCHEMA_VERSION,
    }, paths.repoRoot);
    migrated.push(filename);
  }
  return migrated;
}

function migrateTaskRecord(task: LegacyTaskRecord): TaskRecord {
  const {
    schemaVersion: _schemaVersion,
    requirements,
    acceptanceCriteria,
    learningCandidates,
    ...taskBase
  } = task;
  return {
    ...taskBase,
    schemaVersion: SCHEMA_VERSION,
    verificationRevision: 0,
    requirements: requirements.map(migrateRequirement),
    acceptanceCriteria: acceptanceCriteria.map(migrateRequirement),
    ...(learningCandidates === undefined
      ? {}
      : { learningCandidates: learningCandidates.map(migrateLearningCandidate) }),
  };
}

function migrateRequirement(requirement: LegacyRequirement): Requirement {
  return { ...requirement, schemaVersion: SCHEMA_VERSION };
}

function migrateLearningCandidate(candidate: LegacyLearningCandidate): LearningCandidate {
  return { ...candidate, schemaVersion: SCHEMA_VERSION };
}

async function listTaskDirectories(
  paths: VineaPaths,
  root: string,
  scope: TaskLocation["scope"],
): Promise<Array<{ directory: string; taskId: string; scope: TaskLocation["scope"] }>> {
  await assertNoSymlink(paths.repoRoot, root);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    throw new SchemaError(`Unable to list task directory ${root} during migration.`, error);
  }
  const result: Array<{ directory: string; taskId: string; scope: TaskLocation["scope"] }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (!TASK_ID_PATTERN.test(entry.name)) {
      throw new SchemaError(`Invalid task directory ${entry.name} during migration.`);
    }
    const directory = join(root, entry.name);
    await assertNoSymlink(paths.repoRoot, directory);
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new SchemaError(`Invalid task directory ${directory} during migration.`);
    }
    result.push({ directory, taskId: entry.name, scope });
  }
  return result;
}

async function readEvidenceForMigration(paths: VineaPaths, directory: string): Promise<EvidenceRecord[]> {
  const filename = join(directory, "evidence.jsonl");
  await assertNoSymlink(paths.repoRoot, filename);
  let contents: string;
  try {
    contents = await readFile(filename, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read evidence records ${filename} during migration.`, error);
  }
  const seen = new Set<string>();
  return contents.split("\n").filter(Boolean).map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      throw new SchemaError(`Invalid evidence JSONL in ${filename} at line ${index + 1}`, error);
    }
    let evidence: EvidenceRecord;
    try {
      evidence = normalizeEvidenceRecord(value, true);
    } catch (error) {
      throw new SchemaError(`Invalid evidence record in ${filename} at line ${index + 1}`, error);
    }
    if (seen.has(evidence.id)) {
      throw new SchemaError(`Duplicate evidence ID ${evidence.id} in ${filename} during migration.`);
    }
    seen.add(evidence.id);
    return evidence;
  });
}

function isCurrentConfig(value: unknown): value is VineaConfig {
  return isRecord(value) && value.schemaVersion === SCHEMA_VERSION;
}

function isLegacyConfig(value: unknown): value is LegacyConfig {
  return isRecord(value)
    && value.schemaVersion === LEGACY_SCHEMA_VERSION
    && hasOnlyKeys(value, ["schemaVersion", "riskRules", "context"])
    && isRiskRules(value.riskRules)
    && isContextLimits(value.context);
}

function isCurrentTaskRecord(value: unknown): value is TaskRecord {
  return isRecord(value)
    && value.schemaVersion === SCHEMA_VERSION
    && isTaskBase(value)
    && isNonNegativeSafeInteger(value.verificationRevision)
    && isRequirements(value.requirements, SCHEMA_VERSION)
    && isRequirements(value.acceptanceCriteria, SCHEMA_VERSION)
    && isLearningCandidates(value.learningCandidates, SCHEMA_VERSION)
    && isCommitMetadata(value.commit);
}

function isCurrentSessionBinding(value: unknown): value is SessionBinding {
  return isRecord(value)
    && value.schemaVersion === SCHEMA_VERSION
    && isSessionBindingBase(value);
}

function isLegacySessionBinding(value: unknown): value is LegacySessionBinding {
  return isRecord(value)
    && value.schemaVersion === LEGACY_SCHEMA_VERSION
    && isSessionBindingBase(value);
}

function isSessionBindingBase(value: Record<string, unknown>): boolean {
  return hasOnlyKeys(value, ["schemaVersion", "taskId", "boundAt"])
    && typeof value.taskId === "string"
    && TASK_ID_PATTERN.test(value.taskId)
    && isIsoTimestamp(value.boundAt);
}

function isLegacyTaskRecord(value: unknown): value is LegacyTaskRecord {
  return isRecord(value)
    && value.schemaVersion === LEGACY_SCHEMA_VERSION
    && hasOnlyKeys(value, [
      "schemaVersion",
      "id",
      "title",
      "status",
      "risk",
      "qualityMode",
      "executionMode",
      "requirements",
      "acceptanceCriteria",
      "learningCandidates",
      "commit",
      "createdAt",
      "updatedAt",
    ])
    && isTaskBase(value)
    && isRequirements(value.requirements, LEGACY_SCHEMA_VERSION)
    && isRequirements(value.acceptanceCriteria, LEGACY_SCHEMA_VERSION)
    && isLearningCandidates(value.learningCandidates, LEGACY_SCHEMA_VERSION)
    && isCommitMetadata(value.commit);
}

function isTaskBase(value: Record<string, unknown>): boolean {
  return typeof value.id === "string"
    && TASK_ID_PATTERN.test(value.id)
    && typeof value.title === "string"
    && value.title.trim() !== ""
    && typeof value.status === "string"
    && TASK_STATUSES.has(value.status as TaskStatus)
    && isRisk(value.risk)
    && (value.qualityMode === "standard" || value.qualityMode === "tdd")
    && (value.executionMode === "single-agent" || value.executionMode === "delegated")
    && isIsoTimestamp(value.createdAt)
    && isIsoTimestamp(value.updatedAt);
}

function isRequirements(value: unknown, schemaVersion: 1 | 2): value is LegacyRequirement[] | Requirement[] {
  return Array.isArray(value) && value.every((requirement) =>
    isRecord(requirement)
    && hasOnlyKeys(requirement, ["schemaVersion", "id", "text", "createdAt"])
    && requirement.schemaVersion === schemaVersion
    && typeof requirement.id === "string"
    && requirement.id.trim() !== ""
    && typeof requirement.text === "string"
    && requirement.text.trim() !== ""
    && isIsoTimestamp(requirement.createdAt),
  );
}

function isLearningCandidates(
  value: unknown,
  schemaVersion: 1 | 2,
): value is LegacyLearningCandidate[] | LearningCandidate[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((candidate) => {
    if (!isRecord(candidate)
      || candidate.schemaVersion !== schemaVersion
      || typeof candidate.id !== "string"
      || candidate.id.trim() === ""
      || ids.has(candidate.id)
      || typeof candidate.domain !== "string"
      || candidate.domain.trim() === ""
      || typeof candidate.text !== "string"
      || candidate.text.trim() === ""
      || typeof candidate.rationale !== "string"
      || candidate.rationale.trim() === ""
      || !isIsoTimestamp(candidate.proposedAt)) {
      return false;
    }
    ids.add(candidate.id);
    if (candidate.status === "proposed") return true;
    if (candidate.status === "accepted") {
      return candidate.confirmedBy === "user" && isIsoTimestamp(candidate.acceptedAt);
    }
    return candidate.status === "archived"
      && typeof candidate.archiveReason === "string"
      && candidate.archiveReason.trim() !== ""
      && isIsoTimestamp(candidate.archivedAt);
  });
}

function isRiskRules(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ["medium", "high"])
    && isStringArray(value.medium)
    && isStringArray(value.high);
}

function isContextLimits(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ["maxFiles", "maxEstimatedBytes"])
    && isNonNegativeSafeInteger(value.maxFiles)
    && isNonNegativeSafeInteger(value.maxEstimatedBytes);
}

function isRisk(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ["level", "reasons"])
    && (value.level === "low" || value.level === "medium" || value.level === "high")
    && isStringArray(value.reasons);
}

function isCommitMetadata(value: unknown): value is CommitMetadata | null {
  return value === null || (isRecord(value)
    && hasOnlyKeys(value, ["sha", "message"])
    && typeof value.sha === "string"
    && value.sha.trim() !== ""
    && (value.message === undefined || typeof value.message === "string"));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionBindingFilename(value: string): boolean {
  return /^(codex|claude)-sid-[0-9a-f]+\.json$/u.test(value);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
