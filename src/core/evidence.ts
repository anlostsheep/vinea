import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readConfig } from "./config.js";
import { SchemaError, TransitionError, ValidationError } from "./errors.js";
import { assertNoSymlink, type VineaPaths } from "./paths.js";
import {
  assertTaskMutable,
  executeTaskMutation,
  findTask,
  mutationFingerprint,
  mutationTargetSummary,
  mutationValueIdentity,
  withTaskLock,
  writeManagedMutationTarget,
  type TaskLocation,
} from "./task-store.js";
import {
  SCHEMA_VERSION,
  type EvidenceRecord,
} from "./types.js";

type Clock = () => Date;

export const MAX_EVIDENCE_SUMMARY_BYTES = 2000;
export const MAX_EVIDENCE_COMMAND_BYTES = 4000;
const MAX_EVIDENCE_ID_BYTES = 200;
const MAX_EVIDENCE_ACTOR_BYTES = 200;
const EVIDENCE_KINDS = new Set<EvidenceRecord["kind"]>([
  "command",
  "manual",
  "tdd-red",
  "tdd-green",
]);
const EVIDENCE_RESULTS = new Set<EvidenceRecord["result"]>(["pass", "fail"]);
const EVIDENCE_FIELDS = new Set([
  "schemaVersion",
  "id",
  "kind",
  "summary",
  "result",
  "recordedAt",
  "command",
  "exitCode",
  "actor",
]);

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
  return withTaskLock(paths, taskId, () => recordEvidenceLocked(paths, taskId, input, now));
}

async function recordEvidenceLocked(
  paths: VineaPaths,
  taskId: string,
  input: RecordEvidenceInput,
  now: Clock,
): Promise<EvidenceRecord> {
  await readConfig(paths);
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  const summary = boundedNonempty(input.summary, "Evidence summary", MAX_EVIDENCE_SUMMARY_BYTES);
  const actor = boundedNonempty(input.actor, "Evidence actor", MAX_EVIDENCE_ACTOR_BYTES);
  const command = input.command === undefined
    ? undefined
    : boundedNonempty(input.command, "Evidence command", MAX_EVIDENCE_COMMAND_BYTES);
  const kind = validateKind(input.kind);
  const exitCode = validateExitCode(input.exitCode);
  const result = input.result === undefined ? inferResult(kind, exitCode) : validateResult(input.result);
  assertConsistentEvidence(kind, result, exitCode);

  const filename = join(location.directory, "evidence.jsonl");
  const intent = await executeTaskMutation(paths, location, {
    mutationKind: "evidence_recorded",
    actor,
    timestamp: now().toISOString(),
    fingerprint: mutationFingerprint({
      schemaVersion: SCHEMA_VERSION,
      type: "evidence_recorded",
      actor,
      kind,
      summary,
      command: command ?? null,
      exitCode: exitCode ?? null,
      result,
    }),
  }, async (timestamp, recovering, pending) => {
    const current = await findTask(paths, taskId);
    assertTaskMutable(current);
    const evidenceId = pending?.expected.identity.evidenceId ?? randomUUID();
    const record: EvidenceRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: evidenceId,
      kind,
      summary,
      result,
      recordedAt: timestamp,
      actor,
      ...(command === undefined ? {} : { command }),
      ...(exitCode === undefined ? {} : { exitCode }),
    };
    validateEvidenceRecord(record);
    const currentFilename = join(current.directory, "evidence.jsonl");
    const records = await readEvidenceRecords(paths.repoRoot, currentFilename);
    if (records.some((candidate) => candidate.id === evidenceId)) {
      if (recovering) {
        throw new SchemaError(`Pending evidence mutation already contains ${evidenceId}, but its managed target does not match.`);
      }
      throw new SchemaError(`Generated evidence ID already exists in ${currentFilename}: ${evidenceId}`);
    }
    const contents = renderEvidenceRecords([...records, record]);
    return {
      expected: mutationTargetSummary(paths, [{ filename: currentFilename, contents }], mutationValueIdentity({ evidenceId }, record)),
      completion: {
        schemaVersion: SCHEMA_VERSION,
        type: "evidence_recorded",
        mutationKind: "evidence_recorded",
        mutationProtocolVersion: 1,
        timestamp,
        actor,
        evidenceId,
        evidenceKind: kind,
      },
      apply: () => writeManagedMutationTarget(paths, current, currentFilename, contents),
    };
  });
  const evidenceId = intent.expected.identity.evidenceId;
  const record = (await readEvidenceRecords(paths.repoRoot, filename)).find((candidate) => candidate.id === evidenceId);
  if (record === undefined) throw new SchemaError(`Recovered evidence mutation did not record ${evidenceId}.`);
  return record;
}

export async function assertTddReadyForCheck(paths: VineaPaths, location: TaskLocation): Promise<void> {
  if (location.task.qualityMode !== "tdd") return;
  const evidence = await readEvidenceRecords(paths.repoRoot, join(location.directory, "evidence.jsonl"));
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

async function readEvidenceRecords(repoRoot: string, filename: string): Promise<EvidenceRecord[]> {
  await assertNoSymlink(repoRoot, filename);
  let contents: string;
  try {
    contents = await readFile(filename, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read evidence records ${filename}`, error);
  }
  return contents.split("\n").filter((line) => line !== "").map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      throw new SchemaError(`Invalid JSONL in ${filename} at line ${index + 1}`, error);
    }
    try {
      return validateEvidenceRecord(value);
    } catch (error) {
      throw new SchemaError(`Invalid evidence record in ${filename} at line ${index + 1}`, error);
    }
  });
}

function renderEvidenceRecords(records: EvidenceRecord[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function isValidRed(value: EvidenceRecord): boolean {
  return value.schemaVersion === SCHEMA_VERSION
    && value.kind === "tdd-red"
    && value.result === "fail"
    && value.exitCode !== undefined
    && value.exitCode > 0;
}

function isValidGreen(value: EvidenceRecord): boolean {
  return value.schemaVersion === SCHEMA_VERSION
    && value.kind === "tdd-green"
    && value.result === "pass"
    && value.exitCode === 0;
}

export function validateEvidenceRecord(value: unknown): EvidenceRecord {
  if (!isRecord(value)) throw new ValidationError("Evidence record must be an object.");
  if (Object.keys(value).some((field) => !EVIDENCE_FIELDS.has(field))) {
    throw new ValidationError("Evidence record contains unsupported fields.");
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new ValidationError(`Evidence record schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  const id = boundedUnknownString(value.id, "Evidence ID", MAX_EVIDENCE_ID_BYTES);
  const kind = validateKind(value.kind);
  const summary = boundedUnknownString(
    value.summary,
    "Evidence summary",
    MAX_EVIDENCE_SUMMARY_BYTES,
  );
  const result = validateResult(value.result);
  const recordedAt = validateTimestamp(value.recordedAt);
  const actor = boundedUnknownString(value.actor, "Evidence actor", MAX_EVIDENCE_ACTOR_BYTES);
  const command = value.command === undefined
    ? undefined
    : boundedUnknownString(value.command, "Evidence command", MAX_EVIDENCE_COMMAND_BYTES);
  const exitCode = validateUnknownExitCode(value.exitCode);
  assertConsistentEvidence(kind, result, exitCode);
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    kind,
    summary,
    result,
    recordedAt,
    actor,
    ...(command === undefined ? {} : { command }),
    ...(exitCode === undefined ? {} : { exitCode }),
  };
}

function validateKind(value: unknown): EvidenceRecord["kind"] {
  if (typeof value !== "string" || !EVIDENCE_KINDS.has(value as EvidenceRecord["kind"])) {
    throw new ValidationError("Evidence kind is invalid.");
  }
  return value as EvidenceRecord["kind"];
}

function validateResult(value: unknown): EvidenceRecord["result"] {
  if (typeof value !== "string" || !EVIDENCE_RESULTS.has(value as EvidenceRecord["result"])) {
    throw new ValidationError("Evidence result is invalid.");
  }
  return value as EvidenceRecord["result"];
}

function validateTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("Evidence recordedAt must be an ISO timestamp.");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new ValidationError("Evidence recordedAt must be an ISO timestamp.");
  }
  return value;
}

function boundedUnknownString(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string") throw new ValidationError(`${label} must be a string.`);
  return boundedNonempty(value, label, maxBytes);
}

function validateUnknownExitCode(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number") {
    throw new ValidationError("Evidence exit code must be a non-negative integer.");
  }
  return validateExitCode(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
