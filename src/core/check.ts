import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { readConfig } from "./config.js";
import { SchemaError, ValidationError } from "./errors.js";
import { appendJsonl } from "./json.js";
import { assertInside, assertNoSymlink, type VineaPaths } from "./paths.js";
import {
  assertNoPendingTaskTransition,
  findTask,
  withTaskLock,
  writeCheckArtifact,
  type TaskLocation,
} from "./task-store.js";
import {
  SCHEMA_VERSION,
  type CheckRow,
  type EvidenceRecord,
} from "./types.js";

type Clock = () => Date;
const CHECK_PREFIX = "<!-- vinea-checks:v1:";
const CHECK_SUFFIX = " -->";
const MAX_TEXT_BYTES = 4000;
const MAX_ID_BYTES = 200;

export interface UpsertCheckInput {
  requirementId: string;
  planItem: string;
  paths: string[];
  evidenceIds: string[];
  result: CheckRow["result"];
  summary: string;
  actor: string;
}

export interface CheckTotals {
  total: number;
  pass: number;
  fail: number;
  uncovered: number;
}

export interface CheckSummary {
  taskId: string;
  rows: CheckRow[];
  totals: CheckTotals;
}

interface CheckPayload {
  schemaVersion: typeof SCHEMA_VERSION;
  rows: CheckRow[];
}

export async function upsertCheck(
  paths: VineaPaths,
  taskId: string,
  input: UpsertCheckInput,
  now: Clock = () => new Date(),
): Promise<CheckSummary> {
  return withTaskLock(paths, taskId, () => upsertCheckLocked(paths, taskId, input, now));
}

async function upsertCheckLocked(
  paths: VineaPaths,
  taskId: string,
  input: UpsertCheckInput,
  now: Clock,
): Promise<CheckSummary> {
  await readConfig(paths);
  const location = await findTask(paths, taskId);
  if (location.scope === "archive" || location.task.status === "archived") {
    throw new ValidationError(`Archived task check rows cannot be edited: ${taskId}`);
  }
  if (location.task.status === "finished") {
    throw new ValidationError(`Finished task check rows cannot be edited: ${taskId}`);
  }
  await assertNoPendingTaskTransition(paths, location);
  const evidence = await readEvidence(paths, location);
  const requirementId = boundedNonempty(input.requirementId, "Requirement ID", MAX_ID_BYTES);
  const declaredIds = declaredRequirementIds(location);
  if (!declaredIds.includes(requirementId)) {
    throw new ValidationError(`Requirement or acceptance ID is not declared for ${taskId}: ${requirementId}`);
  }
  const evidenceIds = uniqueStrings(
    input.evidenceIds.map((id) => boundedNonempty(id, "Evidence ID", MAX_ID_BYTES)),
  );
  const knownEvidenceIds = new Set(evidence.map(({ id }) => id));
  const missingEvidence = evidenceIds.find((id) => !knownEvidenceIds.has(id));
  if (missingEvidence !== undefined) {
    throw new ValidationError(`Evidence ID is not present for ${taskId}: ${missingEvidence}`);
  }
  const result = validateResult(input.result);
  if (result === "pass" && evidenceIds.length === 0) {
    throw new ValidationError("A passing check row requires at least one evidence ID.");
  }
  const row: CheckRow = {
    schemaVersion: SCHEMA_VERSION,
    requirementId,
    planItem: boundedNonempty(input.planItem, "Check plan item", MAX_TEXT_BYTES),
    paths: uniqueStrings(input.paths.map((path) => normalizeRepositoryPath(paths.repoRoot, path))),
    evidenceIds,
    result,
    summary: boundedNonempty(input.summary, "Check summary", MAX_TEXT_BYTES),
    checkedAt: now().toISOString(),
  };
  if (row.paths.length === 0) {
    throw new ValidationError("Check paths must contain at least one repository-relative path.");
  }

  const existing = await readRows(paths, location, evidence);
  const eventType = existing.some((candidate) => candidate.requirementId === requirementId)
    ? "check_updated"
    : "check_recorded";
  const byId = new Map(existing.map((candidate) => [candidate.requirementId, candidate]));
  byId.set(requirementId, row);
  const rows = declaredIds.flatMap((id) => {
    const candidate = byId.get(id);
    return candidate === undefined ? [] : [candidate];
  });
  await appendJsonl(join(location.directory, "journal.md"), {
    schemaVersion: SCHEMA_VERSION,
    type: eventType,
    operationId: randomUUID(),
    timestamp: row.checkedAt,
    actor: boundedNonempty(input.actor, "Check actor", MAX_ID_BYTES),
    requirementId,
    result,
  }, paths.repoRoot);
  await writeCheckArtifact(paths, location, renderCheckDocument(rows));
  return summarize(taskId, rows);
}

export async function showCheck(paths: VineaPaths, taskId: string): Promise<CheckSummary> {
  await readConfig(paths);
  const location = await findTask(paths, taskId);
  const evidence = await readEvidence(paths, location);
  return summarize(taskId, await readRows(paths, location, evidence));
}

export async function readCheckForLocation(
  paths: VineaPaths,
  location: TaskLocation,
): Promise<{ summary: CheckSummary; evidence: EvidenceRecord[] }> {
  const evidence = await readEvidence(paths, location);
  const rows = await readRows(paths, location, evidence);
  return { summary: summarize(location.task.id, rows), evidence };
}

function summarize(taskId: string, rows: CheckRow[]): CheckSummary {
  return {
    taskId,
    rows,
    totals: {
      total: rows.length,
      pass: rows.filter(({ result }) => result === "pass").length,
      fail: rows.filter(({ result }) => result === "fail").length,
      uncovered: rows.filter(({ result }) => result === "uncovered").length,
    },
  };
}

async function readRows(
  paths: VineaPaths,
  location: TaskLocation,
  evidence: EvidenceRecord[],
): Promise<CheckRow[]> {
  const filename = join(location.directory, "check.md");
  await assertNoSymlink(paths.repoRoot, filename);
  let contents: string;
  try {
    contents = await readFile(filename, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read check matrix ${filename}`, error);
  }
  return parseCheckDocument(contents, paths.repoRoot, declaredRequirementIds(location), evidence, filename);
}

export function parseCheckDocument(
  contents: string,
  repoRoot: string,
  declaredIds: string[],
  evidence: EvidenceRecord[],
  filename: string,
): CheckRow[] {
  if (contents === "") return [];
  const firstLineEnd = contents.indexOf("\n");
  const firstLine = firstLineEnd === -1 ? contents : contents.slice(0, firstLineEnd);
  if (!firstLine.startsWith(CHECK_PREFIX) || !firstLine.endsWith(CHECK_SUFFIX)) {
    throw new SchemaError(`Invalid authoritative check payload in ${filename}`);
  }
  const encoded = firstLine.slice(CHECK_PREFIX.length, -CHECK_SUFFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new SchemaError(`Invalid authoritative check payload encoding in ${filename}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
  } catch (error) {
    throw new SchemaError(`Invalid authoritative check payload in ${filename}`, error);
  }
  if (!isRecord(value)
    || Object.keys(value).some((key) => key !== "schemaVersion" && key !== "rows")
    || value.schemaVersion !== SCHEMA_VERSION
    || !Array.isArray(value.rows)) {
    throw new SchemaError(`Invalid authoritative check payload in ${filename}`);
  }
  const evidenceIds = new Set(evidence.map(({ id }) => id));
  const seen = new Set<string>();
  let previousDeclarationIndex = -1;
  const rows = value.rows.map((candidate, index) => {
    const row = validateStoredRow(candidate, repoRoot, filename, index + 1);
    const declarationIndex = declaredIds.indexOf(row.requirementId);
    if (declarationIndex === -1) {
      throw new SchemaError(`Check row references undeclared requirement ${row.requirementId} in ${filename}`);
    }
    if (declarationIndex <= previousDeclarationIndex) {
      throw new SchemaError(`Check rows are not in declaration order in ${filename}`);
    }
    previousDeclarationIndex = declarationIndex;
    if (seen.has(row.requirementId)) {
      throw new SchemaError(`Duplicate check row for ${row.requirementId} in ${filename}`);
    }
    seen.add(row.requirementId);
    const missingEvidence = row.evidenceIds.find((id) => !evidenceIds.has(id));
    if (missingEvidence !== undefined) {
      throw new SchemaError(`Check row references absent evidence ${missingEvidence} in ${filename}`);
    }
    if (row.result === "pass" && row.evidenceIds.length === 0) {
      throw new SchemaError(`Passing check row ${row.requirementId} has no evidence in ${filename}`);
    }
    return row;
  });
  if (contents !== renderCheckDocument(rows)) {
    throw new SchemaError(`Check table does not match its authoritative payload in ${filename}`);
  }
  return rows;
}

function validateStoredRow(
  value: unknown,
  repoRoot: string,
  filename: string,
  rowNumber: number,
): CheckRow {
  if (!isRecord(value)) throw new SchemaError(`Invalid check row ${rowNumber} in ${filename}`);
  const fields = [
    "schemaVersion",
    "requirementId",
    "planItem",
    "paths",
    "evidenceIds",
    "result",
    "summary",
    "checkedAt",
  ];
  if (Object.keys(value).some((key) => !fields.includes(key))
    || value.schemaVersion !== SCHEMA_VERSION
    || typeof value.requirementId !== "string"
    || typeof value.planItem !== "string"
    || !Array.isArray(value.paths)
    || !value.paths.every((path) => typeof path === "string")
    || !Array.isArray(value.evidenceIds)
    || !value.evidenceIds.every((id) => typeof id === "string")
    || typeof value.summary !== "string"
    || typeof value.checkedAt !== "string") {
    throw new SchemaError(`Invalid check row ${rowNumber} in ${filename}`);
  }
  if (value.requirementId.trim() === ""
    || Buffer.byteLength(value.requirementId.trim(), "utf8") > MAX_ID_BYTES
    || value.planItem.trim() === ""
    || Buffer.byteLength(value.planItem.trim(), "utf8") > MAX_TEXT_BYTES
    || value.summary.trim() === ""
    || Buffer.byteLength(value.summary.trim(), "utf8") > MAX_TEXT_BYTES
    || value.paths.length === 0) {
    throw new SchemaError(`Invalid check row fields at row ${rowNumber} in ${filename}`);
  }
  const checkedAt = new Date(value.checkedAt);
  if (Number.isNaN(checkedAt.valueOf()) || checkedAt.toISOString() !== value.checkedAt) {
    throw new SchemaError(`Invalid check row timestamp at row ${rowNumber} in ${filename}`);
  }
  let result: CheckRow["result"];
  try {
    result = validateResult(value.result);
  } catch (error) {
    throw new SchemaError(`Invalid check row result at row ${rowNumber} in ${filename}`, error);
  }
  const storedPaths = value.paths as string[];
  const storedEvidenceIds = value.evidenceIds as string[];
  if (new Set(storedPaths).size !== storedPaths.length
    || new Set(storedEvidenceIds).size !== storedEvidenceIds.length
    || storedEvidenceIds.some((id) =>
      id.trim() === "" || Buffer.byteLength(id.trim(), "utf8") > MAX_ID_BYTES
    )) {
    throw new SchemaError(`Invalid duplicate or empty check values at row ${rowNumber} in ${filename}`);
  }
  let normalizedPaths: string[];
  try {
    normalizedPaths = storedPaths.map((path) => normalizeRepositoryPath(repoRoot, path));
  } catch (error) {
    throw new SchemaError(`Invalid check row path at row ${rowNumber} in ${filename}`, error);
  }
  if (normalizedPaths.some((path, index) => path !== storedPaths[index])) {
    throw new SchemaError(`Non-canonical check row path at row ${rowNumber} in ${filename}`);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    requirementId: value.requirementId,
    planItem: value.planItem,
    paths: uniqueStrings(normalizedPaths),
    evidenceIds: uniqueStrings(storedEvidenceIds),
    result,
    summary: value.summary,
    checkedAt: value.checkedAt,
  };
}

async function readEvidence(paths: VineaPaths, location: TaskLocation): Promise<EvidenceRecord[]> {
  const filename = join(location.directory, "evidence.jsonl");
  await assertNoSymlink(paths.repoRoot, filename);
  let contents: string;
  try {
    contents = await readFile(filename, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read evidence records ${filename}`, error);
  }
  const seen = new Set<string>();
  return contents.split("\n").filter(Boolean).map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      throw new SchemaError(`Invalid evidence JSONL in ${filename} at line ${index + 1}`, error);
    }
    if (!isEvidenceRecord(value) || seen.has(value.id)) {
      throw new SchemaError(`Invalid evidence record in ${filename} at line ${index + 1}`);
    }
    seen.add(value.id);
    return value;
  });
}

function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  if (!isRecord(value)) return false;
  const fields = [
    "schemaVersion", "id", "kind", "summary", "result", "recordedAt",
    "command", "exitCode", "actor",
  ];
  if (Object.keys(value).some((key) => !fields.includes(key))) return false;
  const timestamp = typeof value.recordedAt === "string" ? new Date(value.recordedAt) : null;
  const exitCodeValid = value.exitCode === undefined
    || (typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode) && value.exitCode >= 0);
  if (!exitCodeValid) return false;
  if (value.result === "pass" && value.exitCode !== undefined && value.exitCode !== 0) return false;
  if (value.result === "fail" && value.exitCode === 0) return false;
  if (value.kind === "tdd-red"
    && (value.result !== "fail" || typeof value.exitCode !== "number" || value.exitCode === 0)) {
    return false;
  }
  if (value.kind === "tdd-green" && (value.result !== "pass" || value.exitCode !== 0)) return false;
  return value.schemaVersion === SCHEMA_VERSION
    && typeof value.id === "string"
    && value.id.trim() !== ""
    && ["command", "manual", "tdd-red", "tdd-green"].includes(String(value.kind))
    && typeof value.summary === "string"
    && value.summary.trim() !== ""
    && ["pass", "fail"].includes(String(value.result))
    && timestamp !== null
    && !Number.isNaN(timestamp.valueOf())
    && timestamp.toISOString() === value.recordedAt
    && typeof value.actor === "string"
    && value.actor.trim() !== ""
    && (value.command === undefined || (typeof value.command === "string" && value.command.trim() !== ""));
}

function renderCheckDocument(rows: CheckRow[]): string {
  const payload: CheckPayload = { schemaVersion: SCHEMA_VERSION, rows };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const lines = [
    `${CHECK_PREFIX}${encoded}${CHECK_SUFFIX}`,
    "",
    "# Check matrix",
    "",
    "| Requirement/acceptance ID | Task item | Implementation/change paths | Test/verification evidence | Result | Summary |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => [
      row.requirementId,
      row.planItem,
      row.paths.map((path) => `\`${path.replace(/`/g, "\\`")}\``).join("<br>"),
      row.evidenceIds.map((id) => `\`${id.replace(/`/g, "\\`")}\``).join("<br>") || "none",
      row.result,
      row.summary,
    ].map(escapeTableCell).join(" | ")).map((line) => `| ${line} |`),
    "",
  ];
  return lines.join("\n");
}

function escapeTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function declaredRequirementIds(location: TaskLocation): string[] {
  return [...location.task.requirements, ...location.task.acceptanceCriteria].map(({ id }) => id);
}

function normalizeRepositoryPath(repoRoot: string, path: string): string {
  const trimmed = boundedNonempty(path, "Check path", MAX_TEXT_BYTES);
  if (trimmed.includes("\0")
    || trimmed.includes("\\")
    || isAbsolute(trimmed)
    || /^[a-zA-Z]:/.test(trimmed)
    || trimmed.startsWith("//")) {
    throw new ValidationError(`Check path must be repository-relative: ${path}`);
  }
  const resolved = assertInside(repoRoot, resolve(repoRoot, trimmed));
  const normalized = relative(repoRoot, resolved).split("\\").join("/");
  if (normalized === "" || normalized === "." || normalized !== trimmed) {
    throw new ValidationError(`Check path must identify a repository file or directory: ${path}`);
  }
  return normalized;
}

function boundedNonempty(value: string, label: string, maxBytes: number): string {
  const normalized = value.trim();
  if (normalized === "") throw new ValidationError(`${label} must not be empty.`);
  if (Buffer.byteLength(normalized, "utf8") > maxBytes) {
    throw new ValidationError(`${label} exceeds the ${maxBytes}-byte audit metadata limit.`);
  }
  return normalized;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function validateResult(value: unknown): CheckRow["result"] {
  if (value !== "pass" && value !== "fail" && value !== "uncovered") {
    throw new ValidationError("Check result must be pass, fail, or uncovered.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
