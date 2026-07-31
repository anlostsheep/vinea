import { lstat } from "node:fs/promises";
import { SchemaError } from "./errors.js";
import { readJson } from "./json.js";
import { assertNoSymlink, type VineaPaths } from "./paths.js";
import { SCHEMA_VERSION, type VineaConfig } from "./types.js";

export interface DoctorReport {
  initialized: boolean;
  configSchemaVersion: number | null;
  missingRequiredDirectories: string[];
  supportedSchema: boolean;
  migrationGuidance: string | null;
  healthy: boolean;
}

export function assertSupportedSchema(value: unknown, filename: string): asserts value is VineaConfig {
  if (!isRecord(value)) {
    throw new SchemaError(`Invalid Vinea config in ${filename}: expected an object.`);
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    if (typeof value.schemaVersion === "number" && value.schemaVersion > SCHEMA_VERSION) {
      throw new SchemaError(
        `Vinea schema version ${value.schemaVersion} in ${filename} is newer than this CLI. Upgrade Vinea before modifying the workspace; do not recreate or overwrite it.`,
      );
    }
    throw new SchemaError(
      `Unsupported Vinea schema version ${String(value.schemaVersion)} in ${filename}; supported version is ${SCHEMA_VERSION}.`,
    );
  }
  if (!isStringList(value.riskRules, "medium") || !isStringList(value.riskRules, "high")) {
    throw new SchemaError(`Invalid Vinea config in ${filename}: riskRules.medium and riskRules.high must be string arrays.`);
  }
  if (!isRecord(value.context) || !isNonNegativeInteger(value.context.maxFiles) || !isNonNegativeInteger(value.context.maxEstimatedBytes)) {
    throw new SchemaError(`Invalid Vinea config in ${filename}: context limits must be non-negative integers.`);
  }
}

export async function inspectWorkspace(paths: VineaPaths): Promise<DoctorReport> {
  const initialized = await isDirectory(paths.vineaRoot, paths.repoRoot);
  if (!initialized) {
    return {
      initialized: false,
      configSchemaVersion: null,
      missingRequiredDirectories: ["specs", "tasks/active", "tasks/archive", ".runtime/sessions"],
      supportedSchema: false,
      migrationGuidance: "Run `vinea init` to create a version 1 workspace.",
      healthy: false,
    };
  }

  const missingRequiredDirectories = (
    await Promise.all(
      [
        ["specs", paths.specs],
        ["tasks/active", paths.activeTasks],
        ["tasks/archive", paths.archivedTasks],
        [".runtime/sessions", paths.sessions],
      ].map(async ([label, path]) => ((await isDirectory(path!, paths.repoRoot)) ? null : label!)),
    )
  ).filter((item): item is string => item !== null);

  let configSchemaVersion: number | null = null;
  let supportedSchema = false;
  let migrationGuidance: string | null = null;
  try {
    const value = await readJson<unknown>(paths.config, paths.repoRoot);
    if (isRecord(value) && typeof value.schemaVersion === "number") configSchemaVersion = value.schemaVersion;
    assertSupportedSchema(value, paths.config);
    supportedSchema = true;
  } catch (error) {
    migrationGuidance = error instanceof SchemaError && configSchemaVersion !== null && configSchemaVersion > SCHEMA_VERSION
      ? "This workspace uses a newer schema. Upgrade Vinea before modifying it."
      : "Repair or restore config.json with a supported Vinea schema before using lifecycle commands.";
  }

  return {
    initialized,
    configSchemaVersion,
    missingRequiredDirectories,
    supportedSchema,
    migrationGuidance,
    healthy: supportedSchema && missingRequiredDirectories.length === 0,
  };
}

async function isDirectory(path: string, repoRoot: string): Promise<boolean> {
  try {
    await assertNoSymlink(repoRoot, path);
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown, property: string): boolean {
  return isRecord(value) && Array.isArray(value[property]) && value[property].every((item) => typeof item === "string");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
