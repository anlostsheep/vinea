import { lstat } from "node:fs/promises";
import { readJson, writeJsonAtomic } from "./json.js";
import { SchemaError } from "./errors.js";
import { assertNoSymlink, ensureDirectory, type VineaPaths } from "./paths.js";
import { LEGACY_SCHEMA_VERSION, SCHEMA_VERSION, type IsoTimestamp } from "./types.js";

const TASK_ID_PATTERN = /^t-\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SchemaMigrationState {
  schemaVersion: typeof SCHEMA_VERSION;
  type: "schema_migration";
  operationId: string;
  fromSchemaVersion: typeof LEGACY_SCHEMA_VERSION;
  toSchemaVersion: typeof SCHEMA_VERSION;
  phase: "intent" | "completed";
  taskIds: string[];
  migratedTaskIds: string[];
  startedAt: IsoTimestamp;
  completedAt?: IsoTimestamp;
}

export async function readSchemaMigrationState(paths: VineaPaths): Promise<SchemaMigrationState | null> {
  await assertNoSymlink(paths.repoRoot, paths.runtime);
  try {
    const entry = await lstat(paths.migrationState);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new SchemaError(`Migration state must be a regular file: ${paths.migrationState}`);
    }
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const value = await readJson<unknown>(paths.migrationState, paths.repoRoot);
  if (!isSchemaMigrationState(value)) {
    throw new SchemaError(`Invalid schema migration state in ${paths.migrationState}.`);
  }
  return value;
}

export async function writeSchemaMigrationState(
  paths: VineaPaths,
  state: SchemaMigrationState,
): Promise<void> {
  await ensureDirectory(paths.repoRoot, paths.runtime);
  await writeJsonAtomic(paths.migrationState, state, paths.repoRoot);
}

export function isPendingSchemaMigration(state: SchemaMigrationState | null): boolean {
  return state?.phase === "intent";
}

function isSchemaMigrationState(value: unknown): value is SchemaMigrationState {
  if (!isRecord(value)
    || Object.keys(value).some((key) => ![
      "schemaVersion",
      "type",
      "operationId",
      "fromSchemaVersion",
      "toSchemaVersion",
      "phase",
      "taskIds",
      "migratedTaskIds",
      "startedAt",
      "completedAt",
    ].includes(key))
    || value.schemaVersion !== SCHEMA_VERSION
    || value.type !== "schema_migration"
    || typeof value.operationId !== "string"
    || value.operationId.trim() === ""
    || value.fromSchemaVersion !== LEGACY_SCHEMA_VERSION
    || value.toSchemaVersion !== SCHEMA_VERSION
    || (value.phase !== "intent" && value.phase !== "completed")
    || !isUniqueTaskIds(value.taskIds)
    || !isUniqueTaskIds(value.migratedTaskIds)
    || !isIsoTimestamp(value.startedAt)
  ) {
    return false;
  }
  if (value.phase === "completed") return isIsoTimestamp(value.completedAt);
  return value.completedAt === undefined;
}

function isUniqueTaskIds(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((taskId) => typeof taskId === "string" && TASK_ID_PATTERN.test(taskId))
    && new Set(value).size === value.length;
}

function isIsoTimestamp(value: unknown): value is IsoTimestamp {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
