import { lstat, readFile, realpath } from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { readConfig } from "./config.js";
import { SchemaError, ValidationError } from "./errors.js";
import { assertInside, assertNoSymlink, type VineaPaths } from "./paths.js";
import {
  assertTaskMutable,
  executeTaskMutation,
  findTask,
  mutationFingerprint,
  mutationTargetSummary,
  mutationValueIdentity,
  withTaskLock,
  writeManagedMutationTarget,
} from "./task-store.js";
import {
  LEGACY_SCHEMA_VERSION,
  SCHEMA_VERSION,
  type ContextReference,
  type VineaConfig,
} from "./types.js";

type Clock = () => Date;

export interface AddContextInput {
  path: string;
  purpose: string;
  actor: string;
}

export interface ContextManifest {
  references: ContextReference[];
  totals: {
    files: number;
    estimatedBytes: number;
  };
  limits: VineaConfig["context"];
}

export async function addContextReference(
  paths: VineaPaths,
  taskId: string,
  input: AddContextInput,
  now: Clock = () => new Date(),
): Promise<ContextReference> {
  return withTaskLock(paths, taskId, () => addContextReferenceLocked(paths, taskId, input, now));
}

async function addContextReferenceLocked(
  paths: VineaPaths,
  taskId: string,
  input: AddContextInput,
  now: Clock,
): Promise<ContextReference> {
  const config = await readConfig(paths);
  assertNonempty(input.purpose, "Context purpose");
  assertBoundedNonempty(input.actor, "Context actor", 200);
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  const normalizedPath = normalizeRepositoryPath(input.path);
  if (Buffer.byteLength(normalizedPath, "utf8") > 4096) {
    throw new ValidationError("Context path exceeds the 4096-byte audit metadata limit.");
  }
  const estimatedBytes = await inspectContextFile(paths.repoRoot, normalizedPath);
  const purpose = input.purpose.trim();
  const actor = input.actor.trim();
  const filename = resolve(location.directory, "context.jsonl");
  const intent = await executeTaskMutation(paths, location, {
    mutationKind: "context_added",
    actor,
    timestamp: now().toISOString(),
    fingerprint: mutationFingerprint({
      schemaVersion: SCHEMA_VERSION,
      type: "context_added",
      actor,
      path: normalizedPath,
      purpose,
      estimatedBytes,
    }),
  }, async (timestamp, recovering) => {
    const current = await findTask(paths, taskId);
    assertTaskMutable(current);
    const currentFilename = resolve(current.directory, "context.jsonl");
    const existing = await readContextFile(paths.repoRoot, currentFilename);
    const references = existing.references;
    if (references.some((reference) => reference.path === normalizedPath)) {
      if (recovering) {
        throw new SchemaError(`Pending context mutation already contains ${normalizedPath}, but its managed target does not match.`);
      }
      throw new ValidationError(`Context path is already registered for task ${taskId}: ${normalizedPath}`);
    }
    const nextFiles = references.length + 1;
    const nextEstimatedBytes = references.reduce(
      (total, reference) => total + reference.estimatedBytes,
      estimatedBytes,
    );
    if (!recovering && nextFiles > config.context.maxFiles) {
      throw new ValidationError(
        `Context file budget exceeded for task ${taskId}: ${nextFiles} > ${config.context.maxFiles}`,
      );
    }
    if (!recovering && nextEstimatedBytes > config.context.maxEstimatedBytes) {
      throw new ValidationError(
        `Context byte budget exceeded for task ${taskId}: ${nextEstimatedBytes} > ${config.context.maxEstimatedBytes}`,
      );
    }
    const reference: ContextReference = {
      schemaVersion: SCHEMA_VERSION,
      path: normalizedPath,
      purpose,
      estimatedBytes,
      addedAt: timestamp,
    };
    const contents = appendContextReference(existing.contents, reference);
    return {
      expected: mutationTargetSummary(paths, [{ filename: currentFilename, contents }], mutationValueIdentity({ path: normalizedPath }, reference)),
      completion: {
        schemaVersion: SCHEMA_VERSION,
        type: "context_added",
        mutationKind: "context_added",
        mutationProtocolVersion: 1,
        timestamp,
        actor,
        path: normalizedPath,
      },
      apply: () => writeManagedMutationTarget(paths, current, currentFilename, contents),
    };
  });
  const reference = (await readContextReferences(paths.repoRoot, filename)).find(
    (candidate) => candidate.path === intent.expected.identity.path,
  );
  if (reference === undefined) throw new SchemaError(`Recovered context mutation did not record ${normalizedPath}.`);
  return reference;
}

export async function listContextReferences(
  paths: VineaPaths,
  taskId: string,
): Promise<ContextManifest> {
  const config = await readConfig(paths);
  const location = await findTask(paths, taskId);
  const references = await readContextReferences(paths.repoRoot, resolve(location.directory, "context.jsonl"));
  return {
    references,
    totals: {
      files: references.length,
      estimatedBytes: references.reduce((total, reference) => total + reference.estimatedBytes, 0),
    },
    limits: { ...config.context },
  };
}

function normalizeRepositoryPath(input: string): string {
  const value = input.trim();
  if (value === "") throw new ValidationError("Context path must not be empty.");
  if (isAbsolute(value) || /^[a-zA-Z]:[/\\]/.test(value) || value.startsWith("\\")) {
    throw new ValidationError(`Context path must be repository-relative: ${input}`);
  }
  const segments = value.split(/[/\\]/);
  if (segments.includes("..")) {
    throw new ValidationError(`Context path must not contain parent traversal: ${input}`);
  }
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (normalized === "") throw new ValidationError(`Context path must name a file: ${input}`);
  if (normalized === ".vinea/.runtime" || normalized.startsWith(".vinea/.runtime/")) {
    throw new ValidationError(`Context path must not reference ignored runtime data: ${input}`);
  }
  return normalized;
}

async function inspectContextFile(repoRoot: string, repositoryPath: string): Promise<number> {
  const candidate = assertInside(repoRoot, resolve(repoRoot, repositoryPath));
  const segments = repositoryPath.split("/");
  let current = repoRoot;
  try {
    for (const segment of segments) {
      current = resolve(current, segment);
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new ValidationError(`Context path must not contain symbolic links: ${repositoryPath}`);
      }
    }
    const entry = await lstat(candidate);
    if (!entry.isFile()) {
      throw new ValidationError(`Context path must reference a regular file: ${repositoryPath}`);
    }
    const [realRoot, realCandidate] = await Promise.all([realpath(repoRoot), realpath(candidate)]);
    const difference = relative(realRoot, realCandidate);
    if (isAbsolute(difference) || difference === ".." || difference.startsWith("../")) {
      throw new ValidationError(`Context path resolves outside the repository: ${repositoryPath}`);
    }
    return entry.size;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (isMissing(error)) {
      throw new ValidationError(`Context path does not exist: ${repositoryPath}`, error);
    }
    throw new ValidationError(`Unable to inspect context path: ${repositoryPath}`, error);
  }
}

async function readContextReferences(repoRoot: string, filename: string): Promise<ContextReference[]> {
  return (await readContextFile(repoRoot, filename)).references;
}

async function readContextFile(
  repoRoot: string,
  filename: string,
): Promise<{ contents: string; references: ContextReference[] }> {
  await assertNoSymlink(repoRoot, filename);
  let contents: string;
  try {
    contents = await readFile(filename, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read context manifest ${filename}`, error);
  }
  const references = contents.split("\n").filter((line) => line !== "").map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new SchemaError(`Invalid JSONL in ${filename} at line ${index + 1}`, error);
    }
    if (!isContextReference(value)) {
      throw new SchemaError(`Invalid context record in ${filename} at line ${index + 1}`);
    }
    return { ...value, schemaVersion: SCHEMA_VERSION };
  });
  return { contents, references };
}

function isContextReference(value: unknown): value is ContextReference {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (record.schemaVersion === LEGACY_SCHEMA_VERSION || record.schemaVersion === SCHEMA_VERSION)
    && typeof record.path === "string"
    && typeof record.purpose === "string"
    && typeof record.estimatedBytes === "number"
    && Number.isSafeInteger(record.estimatedBytes)
    && record.estimatedBytes >= 0
    && typeof record.addedAt === "string";
}

function appendContextReference(contents: string, reference: ContextReference): string {
  const separator = contents === "" || contents.endsWith("\n") ? "" : "\n";
  return `${contents}${separator}${JSON.stringify(reference)}\n`;
}

function assertNonempty(value: string, label: string): void {
  if (value.trim() === "") throw new ValidationError(`${label} must not be empty.`);
}

function assertBoundedNonempty(value: string, label: string, maxBytes: number): void {
  assertNonempty(value, label);
  if (Buffer.byteLength(value.trim(), "utf8") > maxBytes) {
    throw new ValidationError(`${label} exceeds the ${maxBytes}-byte audit metadata limit.`);
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
