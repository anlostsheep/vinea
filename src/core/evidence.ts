import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readConfig } from "./config.js";
import { SchemaError, TransitionError, ValidationError } from "./errors.js";
import { appendJsonl } from "./json.js";
import type { VineaPaths } from "./paths.js";
import { findTask, type TaskLocation } from "./task-store.js";
import {
  SCHEMA_VERSION,
  type EvidenceRecord,
} from "./types.js";

type Clock = () => Date;

export const MAX_EVIDENCE_SUMMARY_BYTES = 2000;
export const MAX_EVIDENCE_COMMAND_BYTES = 4000;

export interface RecordEvidenceInput {
  kind: EvidenceRecord["kind"];
  summary: string;
  command?: string;
  exitCode?: number;
  result?: EvidenceRecord["result"];
  actor: string;
}

export async function recordEvidence(
  paths: VineaPaths,
  taskId: string,
  input: RecordEvidenceInput,
  now: Clock = () => new Date(),
): Promise<EvidenceRecord> {
  await readConfig(paths);
  const location = await findTask(paths, taskId);
  const summary = boundedNonempty(input.summary, "Evidence summary", MAX_EVIDENCE_SUMMARY_BYTES);
  const actor = boundedNonempty(input.actor, "Evidence actor", 200);
  const command = input.command === undefined
    ? undefined
    : boundedNonempty(input.command, "Evidence command", MAX_EVIDENCE_COMMAND_BYTES);
  const exitCode = validateExitCode(input.exitCode);
  const result = input.result ?? inferResult(input.kind, exitCode);
  assertConsistentEvidence(input.kind, result, exitCode);

  const record: EvidenceRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: randomUUID(),
    kind: input.kind,
    summary,
    result,
    recordedAt: now().toISOString(),
    actor,
    ...(command === undefined ? {} : { command }),
    ...(exitCode === undefined ? {} : { exitCode }),
  };
  await appendJsonl(join(location.directory, "evidence.jsonl"), record, paths.repoRoot);
  return record;
}

export async function assertTddReadyForCheck(location: TaskLocation): Promise<void> {
  if (location.task.qualityMode !== "tdd") return;
  const evidence = await readEvidenceRecords(join(location.directory, "evidence.jsonl"));
  let hasValidRed = false;
  for (const record of evidence) {
    if (isValidRed(record)) {
      hasValidRed = true;
      continue;
    }
    if (hasValidRed && isValidGreen(record)) return;
  }
  throw new TransitionError(
    `TDD task ${location.task.id} requires valid tdd-red evidence followed by valid tdd-green evidence before checking.`,
  );
}

function inferResult(
  kind: EvidenceRecord["kind"],
  exitCode: number | undefined,
): EvidenceRecord["result"] {
  if (kind === "tdd-red") return "fail";
  if (kind === "tdd-green") return "pass";
  if (exitCode !== undefined) return exitCode === 0 ? "pass" : "fail";
  return "pass";
}

function assertConsistentEvidence(
  kind: EvidenceRecord["kind"],
  result: EvidenceRecord["result"],
  exitCode: number | undefined,
): void {
  if (kind === "tdd-red" && (result !== "fail" || exitCode === undefined || exitCode === 0)) {
    throw new ValidationError("tdd-red evidence requires result fail and a nonzero exit code.");
  }
  if (kind === "tdd-green" && (result !== "pass" || exitCode !== 0)) {
    throw new ValidationError("tdd-green evidence requires result pass and exit code 0.");
  }
  if (exitCode !== undefined) {
    if (result === "pass" && exitCode !== 0) {
      throw new ValidationError("Passing evidence cannot have a nonzero exit code.");
    }
    if (result === "fail" && exitCode === 0) {
      throw new ValidationError("Failing evidence cannot have exit code 0.");
    }
  }
}

function validateExitCode(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError("Evidence exit code must be a non-negative integer.");
  }
  return value;
}

function boundedNonempty(value: string, label: string, maxBytes: number): string {
  const normalized = value.trim();
  if (normalized === "") throw new ValidationError(`${label} must not be empty.`);
  const bytes = Buffer.byteLength(normalized, "utf8");
  if (bytes > maxBytes) {
    throw new ValidationError(`${label} exceeds the ${maxBytes}-byte audit metadata limit.`);
  }
  return normalized;
}

async function readEvidenceRecords(filename: string): Promise<unknown[]> {
  let contents: string;
  try {
    contents = await readFile(filename, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read evidence records ${filename}`, error);
  }
  return contents.split("\n").filter((line) => line !== "").map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch (error) {
      throw new SchemaError(`Invalid JSONL in ${filename} at line ${index + 1}`, error);
    }
  });
}

function isValidRed(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.schemaVersion === SCHEMA_VERSION
    && value.kind === "tdd-red"
    && value.result === "fail"
    && typeof value.exitCode === "number"
    && Number.isSafeInteger(value.exitCode)
    && value.exitCode > 0;
}

function isValidGreen(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.schemaVersion === SCHEMA_VERSION
    && value.kind === "tdd-green"
    && value.result === "pass"
    && value.exitCode === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
