import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
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
const PROMOTION_LOCK_DIRECTORY = "learning-promotion.lock";
const PROMOTION_LOCK_OWNER = "owner.json";
const PROMOTION_LOCK_RETRY_MILLISECONDS = 25;
const PROMOTION_LOCK_TIMEOUT_MILLISECONDS = 5000;
const PROMOTION_LOCK_STALE_MILLISECONDS = 5 * 60 * 1000;

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
  const id = boundedNonempty(input.id, "Learning candidate ID", MAX_ID_CHARACTERS);
  const actor = boundedNonempty(input.actor, "Learning actor", MAX_ACTOR_CHARACTERS);
  if (input.confirmedBy !== "user") {
    throw new ValidationError("Learning acceptance requires literal --confirmed-by user.");
  }
  return withPromotionLock(
    paths,
    () => acceptLearningWhileLocked(paths, taskId, id, actor, now),
  );
}

async function acceptLearningWhileLocked(
  paths: VineaPaths,
  taskId: string,
  id: string,
  actor: string,
  now: Clock,
): Promise<TaskRecord> {
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
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
  const domainIndexEntries = countDomainIndexTargets(previousIndex, candidate.domain);
  if (domainIndexEntries > 1) {
    throw new ValidationError(
      `Spec index contains duplicate targets for learning domain ${candidate.domain}; resolve them before promotion.`,
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
  const nextIndex = domainIndexEntries === 1
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

function countDomainIndexTargets(contents: string, domain: string): number {
  return contents.split(/\r?\n/u).filter((line) => {
    const target = parseSpecIndexTarget(line);
    return target !== undefined && normalizeSpecTarget(target) === `${domain}.md`;
  }).length;
}

export function parseSpecIndexTarget(line: string): string | undefined {
  const match = line.match(
    /^\s*-\s*\[[^\]]*\]\(\s*(<[^>\r\n]+>|[^\s)]+)(?:[ \t]+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\)))?\s*\)\s*$/u,
  );
  return match?.[1];
}

export function normalizeSpecTarget(value: string): string {
  let target = value.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1).trim();
  }
  return target.replace(/\\/gu, "/").replace(/^(?:\.\/)+/u, "");
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

interface PromotionLock {
  directory: string;
  ownerPath: string;
  token: string;
}

async function withPromotionLock<T>(
  paths: VineaPaths,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquirePromotionLock(paths);
  let result: T | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }
  try {
    await releasePromotionLock(paths, lock);
  } catch (releaseError) {
    if (operationFailed) {
      throw new SchemaError(
        `Learning promotion failed and its repository lock could not be released safely: ${errorMessage(operationError)}`,
        { operationError, releaseError },
      );
    }
    throw releaseError;
  }
  if (operationFailed) throw operationError;
  return result as T;
}

async function acquirePromotionLock(paths: VineaPaths): Promise<PromotionLock> {
  const directory = join(paths.runtime, PROMOTION_LOCK_DIRECTORY);
  const ownerPath = join(directory, PROMOTION_LOCK_OWNER);
  const token = randomUUID();
  const deadline = Date.now() + PROMOTION_LOCK_TIMEOUT_MILLISECONDS;
  await assertNoSymlink(paths.repoRoot, paths.runtime);
  for (;;) {
    await assertNoSymlink(paths.repoRoot, directory);
    try {
      await mkdir(directory);
    } catch (error) {
      if (!isCode(error, "EEXIST")) {
        throw new SchemaError(`Unable to acquire learning promotion lock ${directory}`, error);
      }
      if (Date.now() >= deadline) {
        throw new ValidationError(await describePromotionLock(paths, directory, ownerPath));
      }
      await delay(PROMOTION_LOCK_RETRY_MILLISECONDS);
      continue;
    }

    const owner = {
      token,
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    };
    try {
      await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      const cleanupFailures = await cleanupOwnedLock(directory, ownerPath);
      if (cleanupFailures.length > 0) {
        throw new SchemaError(
          `Unable to initialize learning promotion lock ${directory}; cleanup failed for ${cleanupFailures.join(", ")}`,
          error,
        );
      }
      throw new SchemaError(`Unable to initialize learning promotion lock ${directory}`, error);
    }
    return { directory, ownerPath, token };
  }
}

async function releasePromotionLock(paths: VineaPaths, lock: PromotionLock): Promise<void> {
  await assertNoSymlink(paths.repoRoot, lock.ownerPath);
  let owner: unknown;
  try {
    owner = JSON.parse(await readFile(lock.ownerPath, "utf8")) as unknown;
  } catch (error) {
    throw new SchemaError(
      `Unable to verify ownership before releasing learning promotion lock ${lock.directory}; inspect it manually`,
      error,
    );
  }
  if (!isRecord(owner) || owner.token !== lock.token) {
    throw new SchemaError(
      `Learning promotion lock ownership changed at ${lock.directory}; refusing unsafe cleanup`,
    );
  }
  try {
    await unlink(lock.ownerPath);
    await rmdir(lock.directory);
  } catch (error) {
    throw new SchemaError(
      `Unable to release learning promotion lock ${lock.directory}; inspect and remove it only after confirming no promotion is active`,
      error,
    );
  }
}

async function describePromotionLock(
  paths: VineaPaths,
  directory: string,
  ownerPath: string,
): Promise<string> {
  let ageMilliseconds: number | undefined;
  try {
    ageMilliseconds = Math.max(0, Date.now() - (await lstat(directory)).mtimeMs);
  } catch (error) {
    if (!isCode(error, "ENOENT")) {
      return `Learning promotion lock is busy at ${directory}; retry after the active promotion completes.`;
    }
  }
  let ownerDescription = "owner metadata is unavailable";
  try {
    await assertNoSymlink(paths.repoRoot, ownerPath);
    const owner = JSON.parse(await readFile(ownerPath, "utf8")) as unknown;
    if (isRecord(owner)) {
      const pid = typeof owner.pid === "number" ? `pid ${owner.pid}` : "unknown pid";
      const acquiredAt = typeof owner.acquiredAt === "string" ? ` since ${owner.acquiredAt}` : "";
      ownerDescription = `${pid}${acquiredAt}`;
    }
  } catch {
    // The directory can briefly exist before its owner record is written.
  }
  const stale = ageMilliseconds !== undefined && ageMilliseconds >= PROMOTION_LOCK_STALE_MILLISECONDS;
  const guidance = stale
    ? "The lock appears stale; verify no Vinea promotion process is active, then remove this lock directory and retry."
    : "Wait for the active promotion to finish, then retry.";
  return `Learning promotion lock is busy at ${directory} (${ownerDescription}). ${guidance}`;
}

async function cleanupOwnedLock(directory: string, ownerPath: string): Promise<string[]> {
  const failures: string[] = [];
  try {
    await unlink(ownerPath);
  } catch (error) {
    if (!isCode(error, "ENOENT")) failures.push(ownerPath);
  }
  try {
    await rmdir(directory);
  } catch (error) {
    if (!isCode(error, "ENOENT")) failures.push(directory);
  }
  return failures;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
