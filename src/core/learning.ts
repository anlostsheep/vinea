import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { readConfig } from "./config.js";
import { SchemaError, ValidationError } from "./errors.js";
import { writeJsonAtomic } from "./json.js";
import { assertNoSymlink, type VineaPaths } from "./paths.js";
import {
  appendTaskMutationIntent,
  assertTaskMutable,
  findTask,
  persistTaskMutation,
  type TaskLocation,
} from "./task-store.js";
import {
  SCHEMA_VERSION,
  type LearningCandidate,
  type TaskRecord,
} from "./types.js";

type Clock = () => Date;

const DOMAIN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DOMAIN_CHARACTERS = 100;
const MAX_ID_CHARACTERS = 200;
const MAX_RULE_CHARACTERS = 500;
const MAX_RATIONALE_CHARACTERS = 1000;
const MAX_REASON_CHARACTERS = 1000;
const MAX_ACTOR_CHARACTERS = 200;

export interface ProposeLearningInput {
  id: string;
  domain: string;
  text: string;
  rationale: string;
  actor: string;
}

export interface AcceptLearningInput {
  id: string;
  confirmedBy: string;
  actor: string;
}

export interface ArchiveLearningInput {
  id: string;
  reason: string;
  actor: string;
}

export async function proposeLearning(
  paths: VineaPaths,
  taskId: string,
  input: ProposeLearningInput,
  now: Clock = () => new Date(),
): Promise<TaskRecord> {
  await readConfig(paths);
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  const id = boundedNonempty(input.id, "Learning candidate ID", MAX_ID_CHARACTERS);
  const domain = validateDomain(input.domain);
  const text = boundedNonempty(input.text, "Learning text", MAX_RULE_CHARACTERS);
  const rationale = boundedNonempty(
    input.rationale,
    "Learning rationale",
    MAX_RATIONALE_CHARACTERS,
  );
  const actor = boundedNonempty(input.actor, "Learning actor", MAX_ACTOR_CHARACTERS);
  const existing = taskLearningCandidates(location);
  if (existing.some((candidate) => candidate.id === id)) {
    throw new ValidationError(`Learning candidate ID already exists in task ${taskId}: ${id}`);
  }
  const timestamp = timestampFrom(now);
  const candidate: LearningCandidate = {
    schemaVersion: SCHEMA_VERSION,
    id,
    domain,
    text,
    rationale,
    status: "proposed",
    proposedAt: timestamp,
  };
  const task: TaskRecord = {
    ...location.task,
    learningCandidates: [...existing, candidate],
    updatedAt: timestamp,
  };
  return (await persistTaskMutation(paths, location, task, {
    schemaVersion: SCHEMA_VERSION,
    type: "learning_proposed",
    timestamp,
    actor,
    learningCandidateId: id,
  })).task;
}

export async function acceptLearning(
  paths: VineaPaths,
  taskId: string,
  input: AcceptLearningInput,
  now: Clock = () => new Date(),
): Promise<TaskRecord> {
  await readConfig(paths);
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  const id = boundedNonempty(input.id, "Learning candidate ID", MAX_ID_CHARACTERS);
  const actor = boundedNonempty(input.actor, "Learning actor", MAX_ACTOR_CHARACTERS);
  if (input.confirmedBy !== "user") {
    throw new ValidationError("Learning acceptance requires literal --confirmed-by user.");
  }
  const candidates = taskLearningCandidates(location);
  const candidate = requireProposedCandidate(candidates, taskId, id);
  const normalizedRule = normalizeWhitespace(candidate.text);
  const specPath = join(paths.specs, `${candidate.domain}.md`);
  const [previousSpec, previousIndex] = await Promise.all([
    readTextIfPresent(paths, specPath),
    readTextIfPresent(paths, paths.specIndex),
  ]);
  if (previousIndex === undefined) {
    throw new SchemaError(`Missing managed spec index ${paths.specIndex}`);
  }
  if (containsNormalizedRule(previousSpec ?? "", normalizedRule)) {
    throw new ValidationError(
      `Learning rule already exists in ${candidate.domain} spec: ${normalizedRule}`,
    );
  }

  const timestamp = timestampFrom(now);
  const accepted: LearningCandidate = {
    ...candidate,
    status: "accepted",
    acceptedAt: timestamp,
    confirmedBy: "user",
  };
  const task: TaskRecord = {
    ...location.task,
    learningCandidates: replaceCandidate(candidates, accepted),
    updatedAt: timestamp,
  };
  const nextSpec = appendRule(previousSpec, candidate.domain, timestamp.slice(0, 10), normalizedRule);
  const indexEntry = `- [${candidate.domain}](${candidate.domain}.md)`;
  const nextIndex = containsDomainIndex(previousIndex, candidate.domain)
    ? previousIndex
    : appendLine(previousIndex, indexEntry);

  await appendTaskMutationIntent(paths, location, {
    schemaVersion: SCHEMA_VERSION,
    type: "learning_accepted",
    timestamp,
    actor,
    learningCandidateId: id,
    confirmedBy: "user",
  });

  let specWritten = false;
  let indexWritten = false;
  try {
    await writeTextAtomic(paths, specPath, nextSpec);
    specWritten = true;
    if (nextIndex !== previousIndex) {
      await writeTextAtomic(paths, paths.specIndex, nextIndex);
      indexWritten = true;
    }
    await writeJsonAtomic(join(location.directory, "task.json"), task, paths.repoRoot);
  } catch (error) {
    const rollbackFailures = await rollbackPromotion(
      paths,
      specWritten ? [specPath, previousSpec] : undefined,
      indexWritten ? [paths.specIndex, previousIndex] : undefined,
    );
    if (rollbackFailures.length > 0) {
      throw new SchemaError(
        `Unable to commit learning acceptance for ${id}; rollback also failed for ${rollbackFailures.join(", ")}`,
        error,
      );
    }
    throw new SchemaError(
      `Unable to commit learning acceptance for ${id}; spec changes were rolled back and journal intent remains pending`,
      error,
    );
  }
  return task;
}

export async function archiveLearning(
  paths: VineaPaths,
  taskId: string,
  input: ArchiveLearningInput,
  now: Clock = () => new Date(),
): Promise<TaskRecord> {
  await readConfig(paths);
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  const id = boundedNonempty(input.id, "Learning candidate ID", MAX_ID_CHARACTERS);
  const reason = boundedNonempty(input.reason, "Learning archive reason", MAX_REASON_CHARACTERS);
  const actor = boundedNonempty(input.actor, "Learning actor", MAX_ACTOR_CHARACTERS);
  const candidates = taskLearningCandidates(location);
  const candidate = requireProposedCandidate(candidates, taskId, id);
  const timestamp = timestampFrom(now);
  const archived: LearningCandidate = {
    ...candidate,
    status: "archived",
    archivedAt: timestamp,
    archiveReason: reason,
  };
  const task: TaskRecord = {
    ...location.task,
    learningCandidates: replaceCandidate(candidates, archived),
    updatedAt: timestamp,
  };
  return (await persistTaskMutation(paths, location, task, {
    schemaVersion: SCHEMA_VERSION,
    type: "learning_archived",
    timestamp,
    actor,
    learningCandidateId: id,
  })).task;
}

function taskLearningCandidates(location: TaskLocation): LearningCandidate[] {
  const candidates: unknown = location.task.learningCandidates;
  if (candidates === undefined) return [];
  if (!Array.isArray(candidates)) {
    throw new ValidationError(`Learning candidate data is malformed for task ${location.task.id}.`);
  }
  const validated = candidates.map((candidate) => validateStoredCandidate(candidate, location.task.id));
  if (new Set(validated.map(({ id }) => id)).size !== validated.length) {
    throw new ValidationError(`Learning candidate IDs are duplicated in task ${location.task.id}.`);
  }
  return validated;
}

function requireProposedCandidate(
  candidates: LearningCandidate[],
  taskId: string,
  id: string,
): LearningCandidate {
  const candidate = candidates.find((item) => item.id === id);
  if (candidate === undefined) {
    throw new ValidationError(`Learning candidate not found in task ${taskId}: ${id}`);
  }
  if (candidate.status !== "proposed") {
    throw new ValidationError(
      `Learning candidate ${id} must be proposed before classification; found ${candidate.status}.`,
    );
  }
  return candidate;
}

function replaceCandidate(
  candidates: LearningCandidate[],
  replacement: LearningCandidate,
): LearningCandidate[] {
  return candidates.map((candidate) => candidate.id === replacement.id ? replacement : candidate);
}

function validateDomain(value: string): string {
  const domain = boundedNonempty(value, "Learning domain", MAX_DOMAIN_CHARACTERS);
  if (!DOMAIN_PATTERN.test(domain) || domain === "index") {
    throw new ValidationError(
      `Invalid learning domain slug: ${domain}. Expected lowercase letters, digits, and single hyphens.`,
    );
  }
  return domain;
}

function boundedNonempty(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized === "") throw new ValidationError(`${label} must not be empty.`);
  if ([...normalized].length > maximum) {
    throw new ValidationError(`${label} exceeds the ${maximum}-character limit.`);
  }
  return normalized;
}

function timestampFrom(now: Clock): string {
  const date = now();
  if (Number.isNaN(date.valueOf())) throw new ValidationError("Clock returned an invalid date.");
  return date.toISOString();
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function containsNormalizedRule(contents: string, normalizedRule: string): boolean {
  return contents.split(/\r?\n/u).some((line) => {
    const match = line.match(/^\s*-\s+(.*?)\s*$/u);
    if (match === null) return false;
    const rule = match[1]!.replace(/^\d{4}-\d{2}-\d{2}:\s*/u, "");
    return normalizeWhitespace(rule) === normalizedRule;
  });
}

function containsDomainIndex(contents: string, domain: string): boolean {
  return contents.split(/\r?\n/u).some((line) => {
    const match = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*$/u);
    return match !== null && match[1] === domain && match[2] === `${domain}.md`;
  });
}

function appendRule(
  previous: string | undefined,
  domain: string,
  date: string,
  normalizedRule: string,
): string {
  const base = previous === undefined ? `# ${domain}\n\n` : ensureTrailingNewline(previous);
  return `${base}- ${date}: ${normalizedRule}\n`;
}

function appendLine(contents: string, line: string): string {
  return `${ensureTrailingNewline(contents)}${line}\n`;
}

function ensureTrailingNewline(contents: string): string {
  if (contents === "") return "";
  return contents.endsWith("\n") ? contents : `${contents}\n`;
}

function validateStoredCandidate(value: unknown, taskId: string): LearningCandidate {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION) {
    throw new ValidationError(`Learning candidate data is malformed for task ${taskId}.`);
  }
  if (typeof value.id !== "string"
    || typeof value.domain !== "string"
    || typeof value.text !== "string"
    || typeof value.rationale !== "string") {
    throw new ValidationError(`Learning candidate data is malformed for task ${taskId}.`);
  }
  boundedNonempty(value.id, "Learning candidate ID", MAX_ID_CHARACTERS);
  validateDomain(value.domain);
  boundedNonempty(value.text, "Learning text", MAX_RULE_CHARACTERS);
  boundedNonempty(value.rationale, "Learning rationale", MAX_RATIONALE_CHARACTERS);
  if (!isIsoTimestamp(value.proposedAt)) {
    throw new ValidationError(`Learning candidate data is malformed for task ${taskId}.`);
  }
  if (value.status === "accepted") {
    if (value.confirmedBy !== "user" || !isIsoTimestamp(value.acceptedAt)) {
      throw new ValidationError(`Learning candidate data is malformed for task ${taskId}.`);
    }
  } else if (value.status === "archived") {
    if (!isIsoTimestamp(value.archivedAt)) {
      throw new ValidationError(`Learning candidate data is malformed for task ${taskId}.`);
    }
    if (typeof value.archiveReason !== "string") {
      throw new ValidationError(`Learning candidate data is malformed for task ${taskId}.`);
    }
    boundedNonempty(value.archiveReason, "Learning archive reason", MAX_REASON_CHARACTERS);
  } else if (value.status !== "proposed") {
    throw new ValidationError(`Learning candidate data is malformed for task ${taskId}.`);
  }
  return value as unknown as LearningCandidate;
}

async function readTextIfPresent(paths: VineaPaths, filename: string): Promise<string | undefined> {
  await assertNoSymlink(paths.repoRoot, filename);
  try {
    return await readFile(filename, "utf8");
  } catch (error) {
    if (isCode(error, "ENOENT")) return undefined;
    throw new SchemaError(`Unable to read managed learning file ${filename}`, error);
  }
}

async function writeTextAtomic(paths: VineaPaths, filename: string, contents: string): Promise<void> {
  await assertNoSymlink(paths.repoRoot, filename);
  const temporary = join(dirname(filename), `.${basename(filename)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporary, filename);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (!isCode(cleanupError, "ENOENT")) {
        throw new SchemaError(`Unable to clean temporary learning file ${temporary}`, cleanupError);
      }
    }
    throw new SchemaError(`Unable to write managed learning file ${filename}`, error);
  }
}

async function rollbackPromotion(
  paths: VineaPaths,
  spec: readonly [string, string | undefined] | undefined,
  index: readonly [string, string] | undefined,
): Promise<string[]> {
  const restorations = [
    ...(spec === undefined ? [] : [restoreText(paths, spec[0], spec[1])]),
    ...(index === undefined ? [] : [restoreText(paths, index[0], index[1])]),
  ];
  const results = await Promise.allSettled(restorations);
  return results.flatMap((result, index_) => result.status === "rejected"
    ? [index_ === 0 && spec !== undefined ? spec[0] : index?.[0] ?? "unknown"]
    : []);
}

async function restoreText(
  paths: VineaPaths,
  filename: string,
  contents: string | undefined,
): Promise<void> {
  if (contents !== undefined) {
    await writeTextAtomic(paths, filename, contents);
    return;
  }
  try {
    await unlink(filename);
  } catch (error) {
    if (!isCode(error, "ENOENT")) {
      throw new SchemaError(`Unable to remove rolled-back learning file ${filename}`, error);
    }
  }
}

function isCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
