#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/core/errors.ts
var VineaError, SchemaError, ValidationError, AmbiguousTaskError, TransitionError, FinishGateError;
var init_errors = __esm({
  "src/core/errors.ts"() {
    "use strict";
    VineaError = class extends Error {
      constructor(code, message, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = "VineaError";
      }
    };
    SchemaError = class extends VineaError {
      constructor(message, cause) {
        super("VINEA_SCHEMA_INVALID", message, cause);
        this.name = "SchemaError";
      }
    };
    ValidationError = class extends VineaError {
      constructor(message, cause) {
        super("VINEA_VALIDATION_INVALID", message, cause);
        this.name = "ValidationError";
      }
    };
    AmbiguousTaskError = class extends VineaError {
      constructor(message) {
        super("VINEA_TASK_AMBIGUOUS", message);
        this.name = "AmbiguousTaskError";
      }
    };
    TransitionError = class extends VineaError {
      constructor(message) {
        super("VINEA_TRANSITION_INVALID", message);
        this.name = "TransitionError";
      }
    };
    FinishGateError = class extends VineaError {
      constructor(message) {
        super("VINEA_FINISH_GATE_FAILED", message);
        this.name = "FinishGateError";
      }
    };
  }
});

// src/core/paths.ts
import { lstat, mkdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
function resolveVineaPaths(repoRoot) {
  const root = resolve(repoRoot);
  const vineaRoot = inside(root, ".vinea");
  const tasks = inside(vineaRoot, "tasks");
  const runtime = inside(vineaRoot, ".runtime");
  return {
    repoRoot: root,
    vineaRoot,
    config: inside(vineaRoot, "config.json"),
    gitignore: inside(vineaRoot, ".gitignore"),
    specs: inside(vineaRoot, "specs"),
    specIndex: inside(vineaRoot, "specs/index.md"),
    tasks,
    activeTasks: inside(tasks, "active"),
    archivedTasks: inside(tasks, "archive"),
    runtime,
    sessions: inside(runtime, "sessions")
  };
}
function assertInside(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const difference = relative(resolvedRoot, resolvedCandidate);
  if (isAbsolute(difference) || difference === ".." || difference.startsWith("../") || difference.startsWith("..\\")) {
    throw new ValidationError(`Path escapes repository root: ${candidate}`);
  }
  return resolvedCandidate;
}
async function assertNoSymlink(root, candidate) {
  const resolvedRoot = resolve(root);
  const safeCandidate = assertInside(resolvedRoot, candidate);
  try {
    if ((await lstat(resolvedRoot)).isSymbolicLink()) {
      throw new SchemaError(`Unsafe symbolic link at ${resolvedRoot}`);
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const segments = relative(resolvedRoot, safeCandidate).split(/[/\\]/).filter(Boolean);
  let current = resolvedRoot;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new SchemaError(`Unsafe symbolic link at ${current}`);
      }
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
  }
}
async function ensureDirectory(root, directory) {
  const safeDirectory = assertInside(root, directory);
  await assertNoSymlink(root, safeDirectory);
  await mkdir(safeDirectory, { recursive: true });
  const entry = await lstat(safeDirectory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new SchemaError(`Expected directory at ${safeDirectory}`);
  }
}
function inside(root, child) {
  return assertInside(root, join(root, child));
}
function isMissing(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
var init_paths = __esm({
  "src/core/paths.ts"() {
    "use strict";
    init_errors();
  }
});

// src/core/json.ts
import { appendFile, lstat as lstat2, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join as join2 } from "node:path";
import { randomUUID } from "node:crypto";
async function readJson(filename, repoRoot) {
  await assertNoSymlink(repoRoot, filename);
  let content;
  try {
    const { readFile: readFile10 } = await import("node:fs/promises");
    content = await readFile10(filename, "utf8");
  } catch (error) {
    if (error instanceof SchemaError) throw error;
    throw new SchemaError(`Unable to read JSON file ${filename}`, error);
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new SchemaError(`Invalid JSON in ${filename}`, error);
  }
}
async function writeJsonAtomic(filename, value, repoRoot) {
  const parent = dirname(filename);
  await assertNoSymlink(repoRoot, parent);
  await assertExistingFileIsNotSymlink(filename);
  const temporary = join2(parent, `.${basename(filename)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}
`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, filename);
  } catch (error) {
    throw new SchemaError(`Unable to write JSON file ${filename}`, error);
  }
}
async function appendJsonl(filename, value, repoRoot) {
  await assertNoSymlink(repoRoot, dirname(filename));
  await assertExistingFileIsNotSymlink(filename);
  try {
    await appendFile(filename, `${JSON.stringify(value)}
`, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to append JSONL file ${filename}`, error);
  }
}
async function assertExistingFileIsNotSymlink(filename) {
  try {
    const entry = await lstat2(filename);
    if (entry.isSymbolicLink()) throw new SchemaError(`Unsafe symbolic link at ${filename}`);
  } catch (error) {
    if (isMissing2(error) || error instanceof SchemaError) {
      if (error instanceof SchemaError) throw error;
      return;
    }
    throw new SchemaError(`Unable to inspect ${filename}`, error);
  }
}
function isMissing2(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
var init_json = __esm({
  "src/core/json.ts"() {
    "use strict";
    init_errors();
    init_paths();
  }
});

// src/core/types.ts
var SCHEMA_VERSION;
var init_types = __esm({
  "src/core/types.ts"() {
    "use strict";
    SCHEMA_VERSION = 1;
  }
});

// src/core/schema.ts
import { lstat as lstat3 } from "node:fs/promises";
function assertSupportedSchema(value, filename) {
  if (!isRecord(value)) {
    throw new SchemaError(`Invalid Vinea config in ${filename}: expected an object.`);
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    if (typeof value.schemaVersion === "number" && value.schemaVersion > SCHEMA_VERSION) {
      throw new SchemaError(
        `Vinea schema version ${value.schemaVersion} in ${filename} is newer than this CLI. Upgrade Vinea before modifying the workspace; do not recreate or overwrite it.`
      );
    }
    throw new SchemaError(
      `Unsupported Vinea schema version ${String(value.schemaVersion)} in ${filename}; supported version is ${SCHEMA_VERSION}.`
    );
  }
  if (!isStringList(value.riskRules, "medium") || !isStringList(value.riskRules, "high")) {
    throw new SchemaError(`Invalid Vinea config in ${filename}: riskRules.medium and riskRules.high must be string arrays.`);
  }
  if (!isRecord(value.context) || !isNonNegativeInteger(value.context.maxFiles) || !isNonNegativeInteger(value.context.maxEstimatedBytes)) {
    throw new SchemaError(`Invalid Vinea config in ${filename}: context limits must be non-negative integers.`);
  }
}
async function inspectWorkspace(paths) {
  const initialized = await isDirectory(paths.vineaRoot, paths.repoRoot);
  if (!initialized) {
    return {
      initialized: false,
      configSchemaVersion: null,
      missingRequiredDirectories: ["specs", "tasks/active", "tasks/archive", ".runtime/sessions"],
      supportedSchema: false,
      migrationGuidance: "Run `vinea init` to create a version 1 workspace.",
      healthy: false
    };
  }
  const missingRequiredDirectories = (await Promise.all(
    [
      ["specs", paths.specs],
      ["tasks/active", paths.activeTasks],
      ["tasks/archive", paths.archivedTasks],
      [".runtime/sessions", paths.sessions]
    ].map(async ([label, path]) => await isDirectory(path, paths.repoRoot) ? null : label)
  )).filter((item) => item !== null);
  let configSchemaVersion = null;
  let supportedSchema = false;
  let migrationGuidance = null;
  try {
    const value = await readJson(paths.config, paths.repoRoot);
    if (isRecord(value) && typeof value.schemaVersion === "number") configSchemaVersion = value.schemaVersion;
    assertSupportedSchema(value, paths.config);
    supportedSchema = true;
  } catch (error) {
    migrationGuidance = error instanceof SchemaError && configSchemaVersion !== null && configSchemaVersion > SCHEMA_VERSION ? "This workspace uses a newer schema. Upgrade Vinea before modifying it." : "Repair or restore config.json with a supported Vinea schema before using lifecycle commands.";
  }
  return {
    initialized,
    configSchemaVersion,
    missingRequiredDirectories,
    supportedSchema,
    migrationGuidance,
    healthy: supportedSchema && missingRequiredDirectories.every((directory) => directory === ".runtime/sessions")
  };
}
async function isDirectory(path, repoRoot) {
  try {
    await assertNoSymlink(repoRoot, path);
    return (await lstat3(path)).isDirectory();
  } catch {
    return false;
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringList(value, property) {
  return isRecord(value) && Array.isArray(value[property]) && value[property].every((item) => typeof item === "string");
}
function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
var init_schema = __esm({
  "src/core/schema.ts"() {
    "use strict";
    init_errors();
    init_json();
    init_paths();
    init_types();
  }
});

// src/core/config.ts
import { lstat as lstat4, readFile, writeFile as writeFile2 } from "node:fs/promises";
async function readConfig(paths) {
  const config = await readJson(paths.config, paths.repoRoot);
  assertSupportedSchema(config, paths.config);
  return config;
}
async function initializeWorkspace(paths) {
  await ensureDirectory(paths.repoRoot, paths.vineaRoot);
  await Promise.all([
    assertNoSymlink(paths.repoRoot, paths.config),
    assertNoSymlink(paths.repoRoot, paths.gitignore),
    assertNoSymlink(paths.repoRoot, paths.specIndex),
    assertNoSymlink(paths.repoRoot, paths.activeTasks),
    assertNoSymlink(paths.repoRoot, paths.archivedTasks),
    assertNoSymlink(paths.repoRoot, paths.sessions)
  ]);
  if (await exists(paths.config)) {
    await readConfig(paths);
  }
  if (await exists(paths.gitignore)) await ensureExactFile(paths.gitignore, RUNTIME_IGNORE, paths.repoRoot);
  await Promise.all([
    ensureDirectory(paths.repoRoot, paths.specs),
    ensureDirectory(paths.repoRoot, paths.activeTasks),
    ensureDirectory(paths.repoRoot, paths.archivedTasks),
    ensureDirectory(paths.repoRoot, paths.sessions)
  ]);
  if (!await exists(paths.config)) await writeJsonAtomic(paths.config, DEFAULT_CONFIG, paths.repoRoot);
  await ensureExactFile(paths.gitignore, RUNTIME_IGNORE, paths.repoRoot);
  await ensureFile(paths.specIndex, SPEC_INDEX, paths.repoRoot);
}
async function ensureExactFile(filename, contents, repoRoot) {
  await assertNoSymlink(repoRoot, filename);
  if (await exists(filename)) {
    const existing = await readFile(filename, "utf8");
    if (existing !== contents) throw new SchemaError(`Unexpected managed file contents in ${filename}`);
    return;
  }
  await writeFile2(filename, contents, { encoding: "utf8", flag: "wx" });
}
async function ensureFile(filename, contents, repoRoot) {
  await assertNoSymlink(repoRoot, filename);
  if (await exists(filename)) return;
  await writeFile2(filename, contents, { encoding: "utf8", flag: "wx" });
}
async function exists(filename) {
  try {
    await lstat4(filename);
    return true;
  } catch (error) {
    if (isMissing3(error)) return false;
    throw error;
  }
}
function isMissing3(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
var DEFAULT_CONFIG, SPEC_INDEX, RUNTIME_IGNORE;
var init_config = __esm({
  "src/core/config.ts"() {
    "use strict";
    init_errors();
    init_json();
    init_paths();
    init_schema();
    init_types();
    DEFAULT_CONFIG = {
      schemaVersion: SCHEMA_VERSION,
      riskRules: {
        medium: ["behavior", "bug", "cross-file", "external", "security", "data", "deploy"],
        high: ["production", "migration", "credential", "permission", "delete"]
      },
      context: { maxFiles: 12, maxEstimatedBytes: 8e4 }
    };
    SPEC_INDEX = "# Vinea Specs\n\n## Indexed specs\n\n";
    RUNTIME_IGNORE = ".runtime/\n";
  }
});

// src/core/evidence.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { readFile as readFile2 } from "node:fs/promises";
import { join as join3 } from "node:path";
async function recordEvidence(paths, taskId, input, now = () => /* @__PURE__ */ new Date()) {
  return withTaskLock(paths, taskId, () => recordEvidenceLocked(paths, taskId, input, now));
}
async function recordEvidenceLocked(paths, taskId, input, now) {
  await readConfig(paths);
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  const summary = boundedNonempty(input.summary, "Evidence summary", MAX_EVIDENCE_SUMMARY_BYTES);
  const actor = boundedNonempty(input.actor, "Evidence actor", MAX_EVIDENCE_ACTOR_BYTES);
  const command = input.command === void 0 ? void 0 : boundedNonempty(input.command, "Evidence command", MAX_EVIDENCE_COMMAND_BYTES);
  const kind = validateKind(input.kind);
  const exitCode = validateExitCode(input.exitCode);
  const result = input.result === void 0 ? inferResult(kind, exitCode) : validateResult(input.result);
  assertConsistentEvidence(kind, result, exitCode);
  const filename = join3(location.directory, "evidence.jsonl");
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
      result
    })
  }, async (timestamp, recovering, pending) => {
    const current = await findTask(paths, taskId);
    assertTaskMutable(current);
    const evidenceId2 = pending?.expected.identity.evidenceId ?? randomUUID2();
    const record2 = {
      schemaVersion: SCHEMA_VERSION,
      id: evidenceId2,
      kind,
      summary,
      result,
      recordedAt: timestamp,
      actor,
      ...command === void 0 ? {} : { command },
      ...exitCode === void 0 ? {} : { exitCode }
    };
    validateEvidenceRecord(record2);
    const currentFilename = join3(current.directory, "evidence.jsonl");
    const records = await readEvidenceRecords(paths.repoRoot, currentFilename);
    if (records.some((candidate) => candidate.id === evidenceId2)) {
      if (recovering) {
        throw new SchemaError(`Pending evidence mutation already contains ${evidenceId2}, but its managed target does not match.`);
      }
      throw new SchemaError(`Generated evidence ID already exists in ${currentFilename}: ${evidenceId2}`);
    }
    const contents = renderEvidenceRecords([...records, record2]);
    return {
      expected: mutationTargetSummary(paths, [{ filename: currentFilename, contents }], mutationValueIdentity({ evidenceId: evidenceId2 }, record2)),
      completion: {
        schemaVersion: SCHEMA_VERSION,
        type: "evidence_recorded",
        mutationKind: "evidence_recorded",
        mutationProtocolVersion: 1,
        timestamp,
        actor,
        evidenceId: evidenceId2,
        evidenceKind: kind
      },
      apply: () => writeManagedMutationTarget(paths, current, currentFilename, contents)
    };
  });
  const evidenceId = intent.expected.identity.evidenceId;
  const record = (await readEvidenceRecords(paths.repoRoot, filename)).find((candidate) => candidate.id === evidenceId);
  if (record === void 0) throw new SchemaError(`Recovered evidence mutation did not record ${evidenceId}.`);
  return record;
}
async function assertTddReadyForCheck(paths, location) {
  if (location.task.qualityMode !== "tdd") return;
  const evidence = await readEvidenceRecords(paths.repoRoot, join3(location.directory, "evidence.jsonl"));
  let hasValidRed = false;
  for (const record of evidence) {
    if (isValidRed(record)) {
      hasValidRed = true;
      continue;
    }
    if (hasValidRed && isValidGreen(record)) return;
  }
  throw new TransitionError(
    `TDD task ${location.task.id} requires valid tdd-red evidence followed by valid tdd-green evidence before checking.`
  );
}
function inferResult(kind, exitCode) {
  if (kind === "tdd-red") return "fail";
  if (kind === "tdd-green") return "pass";
  if (exitCode !== void 0) return exitCode === 0 ? "pass" : "fail";
  return "pass";
}
function assertConsistentEvidence(kind, result, exitCode) {
  if (kind === "tdd-red" && (result !== "fail" || exitCode === void 0 || exitCode === 0)) {
    throw new ValidationError("tdd-red evidence requires result fail and a nonzero exit code.");
  }
  if (kind === "tdd-green" && (result !== "pass" || exitCode !== 0)) {
    throw new ValidationError("tdd-green evidence requires result pass and exit code 0.");
  }
  if (exitCode !== void 0) {
    if (result === "pass" && exitCode !== 0) {
      throw new ValidationError("Passing evidence cannot have a nonzero exit code.");
    }
    if (result === "fail" && exitCode === 0) {
      throw new ValidationError("Failing evidence cannot have exit code 0.");
    }
  }
}
function validateExitCode(value) {
  if (value === void 0) return void 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError("Evidence exit code must be a non-negative integer.");
  }
  return value;
}
function boundedNonempty(value, label, maxBytes) {
  const normalized = value.trim();
  if (normalized === "") throw new ValidationError(`${label} must not be empty.`);
  const bytes = Buffer.byteLength(normalized, "utf8");
  if (bytes > maxBytes) {
    throw new ValidationError(`${label} exceeds the ${maxBytes}-byte audit metadata limit.`);
  }
  return normalized;
}
async function readEvidenceRecords(repoRoot, filename) {
  await assertNoSymlink(repoRoot, filename);
  let contents;
  try {
    contents = await readFile2(filename, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read evidence records ${filename}`, error);
  }
  return contents.split("\n").filter((line) => line !== "").map((line, index) => {
    let value;
    try {
      value = JSON.parse(line);
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
function renderEvidenceRecords(records) {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}
function isValidRed(value) {
  return value.schemaVersion === SCHEMA_VERSION && value.kind === "tdd-red" && value.result === "fail" && value.exitCode !== void 0 && value.exitCode > 0;
}
function isValidGreen(value) {
  return value.schemaVersion === SCHEMA_VERSION && value.kind === "tdd-green" && value.result === "pass" && value.exitCode === 0;
}
function validateEvidenceRecord(value) {
  if (!isRecord2(value)) throw new ValidationError("Evidence record must be an object.");
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
    MAX_EVIDENCE_SUMMARY_BYTES
  );
  const result = validateResult(value.result);
  const recordedAt = validateTimestamp(value.recordedAt);
  const actor = boundedUnknownString(value.actor, "Evidence actor", MAX_EVIDENCE_ACTOR_BYTES);
  const command = value.command === void 0 ? void 0 : boundedUnknownString(value.command, "Evidence command", MAX_EVIDENCE_COMMAND_BYTES);
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
    ...command === void 0 ? {} : { command },
    ...exitCode === void 0 ? {} : { exitCode }
  };
}
function validateKind(value) {
  if (typeof value !== "string" || !EVIDENCE_KINDS.has(value)) {
    throw new ValidationError("Evidence kind is invalid.");
  }
  return value;
}
function validateResult(value) {
  if (typeof value !== "string" || !EVIDENCE_RESULTS.has(value)) {
    throw new ValidationError("Evidence result is invalid.");
  }
  return value;
}
function validateTimestamp(value) {
  if (typeof value !== "string") throw new ValidationError("Evidence recordedAt must be an ISO timestamp.");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new ValidationError("Evidence recordedAt must be an ISO timestamp.");
  }
  return value;
}
function boundedUnknownString(value, label, maxBytes) {
  if (typeof value !== "string") throw new ValidationError(`${label} must be a string.`);
  return boundedNonempty(value, label, maxBytes);
}
function validateUnknownExitCode(value) {
  if (value === void 0) return void 0;
  if (typeof value !== "number") {
    throw new ValidationError("Evidence exit code must be a non-negative integer.");
  }
  return validateExitCode(value);
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var MAX_EVIDENCE_SUMMARY_BYTES, MAX_EVIDENCE_COMMAND_BYTES, MAX_EVIDENCE_ID_BYTES, MAX_EVIDENCE_ACTOR_BYTES, EVIDENCE_KINDS, EVIDENCE_RESULTS, EVIDENCE_FIELDS;
var init_evidence = __esm({
  "src/core/evidence.ts"() {
    "use strict";
    init_config();
    init_errors();
    init_paths();
    init_task_store();
    init_types();
    MAX_EVIDENCE_SUMMARY_BYTES = 2e3;
    MAX_EVIDENCE_COMMAND_BYTES = 4e3;
    MAX_EVIDENCE_ID_BYTES = 200;
    MAX_EVIDENCE_ACTOR_BYTES = 200;
    EVIDENCE_KINDS = /* @__PURE__ */ new Set([
      "command",
      "manual",
      "tdd-red",
      "tdd-green"
    ]);
    EVIDENCE_RESULTS = /* @__PURE__ */ new Set(["pass", "fail"]);
    EVIDENCE_FIELDS = /* @__PURE__ */ new Set([
      "schemaVersion",
      "id",
      "kind",
      "summary",
      "result",
      "recordedAt",
      "command",
      "exitCode",
      "actor"
    ]);
  }
});

// src/core/learning.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { lstat as lstat5, mkdir as mkdir2, readFile as readFile3, rmdir, unlink, writeFile as writeFile3 } from "node:fs/promises";
import { join as join4 } from "node:path";
async function proposeLearning(paths, taskId, input, now = () => /* @__PURE__ */ new Date()) {
  return withTaskLock(paths, taskId, () => proposeLearningLocked(paths, taskId, input, now));
}
async function proposeLearningLocked(paths, taskId, input, now) {
  await readConfig(paths);
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  const id = boundedNonempty2(input.id, "Learning candidate ID", MAX_ID_CHARACTERS);
  const domain = validateDomain(input.domain);
  const text = boundedNonempty2(input.text, "Learning text", MAX_RULE_CHARACTERS);
  const rationale = boundedNonempty2(
    input.rationale,
    "Learning rationale",
    MAX_RATIONALE_CHARACTERS
  );
  const actor = boundedNonempty2(input.actor, "Learning actor", MAX_ACTOR_CHARACTERS);
  await executeTaskMutation(paths, location, {
    mutationKind: "learning_proposed",
    actor,
    timestamp: timestampFrom(now),
    fingerprint: mutationFingerprint({
      schemaVersion: SCHEMA_VERSION,
      type: "learning_proposed",
      actor,
      learningCandidateId: id,
      domain,
      text,
      rationale
    })
  }, async (timestamp, recovering) => {
    const current = await findTask(paths, taskId);
    assertTaskMutable(current);
    const existing = taskLearningCandidates(current);
    if (existing.some((candidate2) => candidate2.id === id)) {
      if (recovering) {
        throw new SchemaError(`Pending learning proposal ${id} already exists in task.json, but does not match its recorded target.`);
      }
      throw new ValidationError(`Learning candidate ID already exists in task ${taskId}: ${id}`);
    }
    const candidate = {
      schemaVersion: SCHEMA_VERSION,
      id,
      domain,
      text,
      rationale,
      status: "proposed",
      proposedAt: timestamp
    };
    const task = {
      ...current.task,
      learningCandidates: [...existing, candidate],
      updatedAt: timestamp
    };
    return {
      expected: mutationTargetSummary(paths, [{
        filename: join4(current.directory, "task.json"),
        contents: `${JSON.stringify(task, null, 2)}
`
      }], mutationValueIdentity({ learningCandidateId: id }, candidate)),
      completion: {
        schemaVersion: SCHEMA_VERSION,
        type: "learning_proposed",
        mutationKind: "learning_proposed",
        mutationProtocolVersion: 1,
        timestamp,
        actor,
        learningCandidateId: id
      },
      apply: () => writeJsonAtomic(join4(current.directory, "task.json"), task, paths.repoRoot)
    };
  });
  return (await findTask(paths, taskId)).task;
}
async function acceptLearning(paths, taskId, input, now = () => /* @__PURE__ */ new Date()) {
  await readConfig(paths);
  const id = boundedNonempty2(input.id, "Learning candidate ID", MAX_ID_CHARACTERS);
  const actor = boundedNonempty2(input.actor, "Learning actor", MAX_ACTOR_CHARACTERS);
  if (input.confirmedBy !== "user") {
    throw new ValidationError("Learning acceptance requires literal --confirmed-by user.");
  }
  return withTaskLock(paths, taskId, () => withPromotionLock(
    paths,
    () => acceptLearningWhileLocked(paths, taskId, id, actor, now)
  ));
}
async function acceptLearningWhileLocked(paths, taskId, id, actor, now) {
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  await executeTaskMutation(paths, location, {
    mutationKind: "learning_accepted",
    actor,
    timestamp: timestampFrom(now),
    fingerprint: mutationFingerprint({
      schemaVersion: SCHEMA_VERSION,
      type: "learning_accepted",
      actor,
      learningCandidateId: id,
      confirmedBy: "user"
    })
  }, async (timestamp, recovering) => {
    const current = await findTask(paths, taskId);
    assertTaskMutable(current);
    const candidates = taskLearningCandidates(current);
    const candidate = reconcileAcceptedCandidate(candidates, taskId, id, timestamp, recovering);
    const normalizedRule = normalizeWhitespace(candidate.text);
    const specPath = join4(paths.specs, `${candidate.domain}.md`);
    const [previousSpec, previousIndex] = await Promise.all([
      readTextIfPresent(paths, specPath),
      readTextIfPresent(paths, paths.specIndex)
    ]);
    if (previousIndex === void 0) {
      throw new SchemaError(`Missing managed spec index ${paths.specIndex}`);
    }
    const nextSpec = reconcilePromotionRule(
      previousSpec,
      candidate.domain,
      timestamp.slice(0, 10),
      normalizedRule,
      recovering
    );
    const domainIndexEntries = countDomainIndexTargets(previousIndex, candidate.domain);
    if (domainIndexEntries > 1) {
      throw new ValidationError(
        `Spec index contains duplicate targets for learning domain ${candidate.domain}; resolve them before promotion.`
      );
    }
    const indexEntry = `- [${candidate.domain}](${candidate.domain}.md)`;
    const nextIndex = domainIndexEntries === 1 ? previousIndex : appendLine(previousIndex, indexEntry);
    const accepted = candidate.status === "accepted" ? candidate : {
      ...candidate,
      status: "accepted",
      acceptedAt: timestamp,
      confirmedBy: "user"
    };
    const task = candidate.status === "accepted" ? current.task : {
      ...current.task,
      learningCandidates: replaceCandidate(candidates, accepted),
      updatedAt: timestamp
    };
    const taskContents = `${JSON.stringify(task, null, 2)}
`;
    return {
      expected: mutationTargetSummary(paths, [
        { filename: specPath, contents: nextSpec },
        { filename: paths.specIndex, contents: nextIndex },
        { filename: join4(current.directory, "task.json"), contents: taskContents }
      ], mutationValueIdentity({ learningCandidateId: id }, accepted)),
      completion: {
        schemaVersion: SCHEMA_VERSION,
        type: "learning_accepted",
        mutationKind: "learning_accepted",
        mutationProtocolVersion: 1,
        timestamp,
        actor,
        learningCandidateId: id,
        confirmedBy: "user"
      },
      apply: async () => {
        await writeManagedMutationTarget(paths, current, specPath, nextSpec);
        await writeManagedMutationTarget(paths, current, paths.specIndex, nextIndex);
        await writeManagedMutationTarget(paths, current, join4(current.directory, "task.json"), taskContents);
      }
    };
  });
  return (await findTask(paths, taskId)).task;
}
async function archiveLearning(paths, taskId, input, now = () => /* @__PURE__ */ new Date()) {
  return withTaskLock(paths, taskId, () => archiveLearningLocked(paths, taskId, input, now));
}
async function archiveLearningLocked(paths, taskId, input, now) {
  await readConfig(paths);
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  const id = boundedNonempty2(input.id, "Learning candidate ID", MAX_ID_CHARACTERS);
  const reason = boundedNonempty2(input.reason, "Learning archive reason", MAX_REASON_CHARACTERS);
  const actor = boundedNonempty2(input.actor, "Learning actor", MAX_ACTOR_CHARACTERS);
  await executeTaskMutation(paths, location, {
    mutationKind: "learning_archived",
    actor,
    timestamp: timestampFrom(now),
    fingerprint: mutationFingerprint({
      schemaVersion: SCHEMA_VERSION,
      type: "learning_archived",
      actor,
      learningCandidateId: id,
      reason
    })
  }, async (timestamp) => {
    const current = await findTask(paths, taskId);
    assertTaskMutable(current);
    const candidates = taskLearningCandidates(current);
    const candidate = requireProposedCandidate(candidates, taskId, id);
    const archived = {
      ...candidate,
      status: "archived",
      archivedAt: timestamp,
      archiveReason: reason
    };
    const task = {
      ...current.task,
      learningCandidates: replaceCandidate(candidates, archived),
      updatedAt: timestamp
    };
    return {
      expected: mutationTargetSummary(paths, [{
        filename: join4(current.directory, "task.json"),
        contents: `${JSON.stringify(task, null, 2)}
`
      }], mutationValueIdentity({ learningCandidateId: id }, archived)),
      completion: {
        schemaVersion: SCHEMA_VERSION,
        type: "learning_archived",
        mutationKind: "learning_archived",
        mutationProtocolVersion: 1,
        timestamp,
        actor,
        learningCandidateId: id
      },
      apply: () => writeJsonAtomic(join4(current.directory, "task.json"), task, paths.repoRoot)
    };
  });
  return (await findTask(paths, taskId)).task;
}
function taskLearningCandidates(location) {
  const candidates = location.task.learningCandidates;
  if (candidates === void 0) return [];
  if (!Array.isArray(candidates)) {
    throw new ValidationError(`Learning candidate data is malformed for task ${location.task.id}.`);
  }
  const validated = candidates.map((candidate) => validateStoredCandidate(candidate, location.task.id));
  if (new Set(validated.map(({ id }) => id)).size !== validated.length) {
    throw new ValidationError(`Learning candidate IDs are duplicated in task ${location.task.id}.`);
  }
  return validated;
}
function requireProposedCandidate(candidates, taskId, id) {
  const candidate = candidates.find((item) => item.id === id);
  if (candidate === void 0) {
    throw new ValidationError(`Learning candidate not found in task ${taskId}: ${id}`);
  }
  if (candidate.status !== "proposed") {
    throw new ValidationError(
      `Learning candidate ${id} must be proposed before classification; found ${candidate.status}.`
    );
  }
  return candidate;
}
function replaceCandidate(candidates, replacement) {
  return candidates.map((candidate) => candidate.id === replacement.id ? replacement : candidate);
}
function validateDomain(value) {
  const domain = boundedNonempty2(value, "Learning domain", MAX_DOMAIN_CHARACTERS);
  if (!DOMAIN_PATTERN.test(domain) || domain === "index") {
    throw new ValidationError(
      `Invalid learning domain slug: ${domain}. Expected lowercase letters, digits, and single hyphens.`
    );
  }
  return domain;
}
function boundedNonempty2(value, label, maximum) {
  const normalized = value.trim();
  if (normalized === "") throw new ValidationError(`${label} must not be empty.`);
  if ([...normalized].length > maximum) {
    throw new ValidationError(`${label} exceeds the ${maximum}-character limit.`);
  }
  return normalized;
}
function timestampFrom(now) {
  const date = now();
  if (Number.isNaN(date.valueOf())) throw new ValidationError("Clock returned an invalid date.");
  return date.toISOString();
}
function normalizeWhitespace(value) {
  return value.trim().replace(/\s+/gu, " ");
}
function reconcileAcceptedCandidate(candidates, taskId, id, timestamp, recovering) {
  const candidate = candidates.find((item) => item.id === id);
  if (candidate === void 0) {
    throw new ValidationError(`Learning candidate not found in task ${taskId}: ${id}`);
  }
  if (candidate.status === "proposed") return candidate;
  if (recovering && candidate.status === "accepted" && candidate.confirmedBy === "user" && candidate.acceptedAt === timestamp) {
    return candidate;
  }
  throw new ValidationError(
    `Learning candidate ${id} must be proposed before classification; found ${candidate.status}.`
  );
}
function reconcilePromotionRule(previous, domain, date, normalizedRule, recovering) {
  const matchingRules = normalizedRuleLines(previous ?? "", normalizedRule);
  if (matchingRules.length === 0) return appendRule(previous, domain, date, normalizedRule);
  const expected = `${date}: ${normalizedRule}`;
  if (recovering && matchingRules.length === 1 && matchingRules[0] === expected) {
    return previous;
  }
  if (!recovering) {
    throw new ValidationError(`Learning rule already exists in ${domain} spec: ${normalizedRule}`);
  }
  throw new SchemaError(
    `Pending learning acceptance has an incompatible rule in ${domain} spec; inspect it before retrying.`
  );
}
function normalizedRuleLines(contents, normalizedRule) {
  return contents.split(/\r?\n/u).flatMap((line) => {
    const match = line.match(/^\s*-\s+(.*?)\s*$/u);
    if (match === null) return [];
    const rule = match[1];
    const withoutDate = rule.replace(/^\d{4}-\d{2}-\d{2}:\s*/u, "");
    return normalizeWhitespace(withoutDate) === normalizedRule ? [rule.trim()] : [];
  });
}
function countDomainIndexTargets(contents, domain) {
  return contents.split(/\r?\n/u).filter((line) => {
    const target = parseSpecIndexTarget(line);
    return target !== void 0 && normalizeSpecTarget(target) === `${domain}.md`;
  }).length;
}
function parseSpecIndexTarget(line) {
  const match = line.match(
    /^\s*-\s*\[[^\]]*\]\(\s*(<[^>\r\n]+>|[^\s)]+)(?:[ \t]+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\)))?\s*\)\s*$/u
  );
  return match?.[1];
}
function normalizeSpecTarget(value) {
  let target = value.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1).trim();
  }
  return target.replace(/\\/gu, "/").replace(/^(?:\.\/)+/u, "");
}
function appendRule(previous, domain, date, normalizedRule) {
  const base = previous === void 0 ? `# ${domain}

` : ensureTrailingNewline(previous);
  return `${base}- ${date}: ${normalizedRule}
`;
}
function appendLine(contents, line) {
  return `${ensureTrailingNewline(contents)}${line}
`;
}
function ensureTrailingNewline(contents) {
  if (contents === "") return "";
  return contents.endsWith("\n") ? contents : `${contents}
`;
}
function validateStoredCandidate(value, taskId) {
  if (!isRecord3(value) || value.schemaVersion !== SCHEMA_VERSION) {
    throw new ValidationError(`Learning candidate data is malformed for task ${taskId}.`);
  }
  if (typeof value.id !== "string" || typeof value.domain !== "string" || typeof value.text !== "string" || typeof value.rationale !== "string") {
    throw new ValidationError(`Learning candidate data is malformed for task ${taskId}.`);
  }
  boundedNonempty2(value.id, "Learning candidate ID", MAX_ID_CHARACTERS);
  validateDomain(value.domain);
  boundedNonempty2(value.text, "Learning text", MAX_RULE_CHARACTERS);
  boundedNonempty2(value.rationale, "Learning rationale", MAX_RATIONALE_CHARACTERS);
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
    boundedNonempty2(value.archiveReason, "Learning archive reason", MAX_REASON_CHARACTERS);
  } else if (value.status !== "proposed") {
    throw new ValidationError(`Learning candidate data is malformed for task ${taskId}.`);
  }
  return value;
}
async function readTextIfPresent(paths, filename) {
  await assertNoSymlink(paths.repoRoot, filename);
  try {
    return await readFile3(filename, "utf8");
  } catch (error) {
    if (isCode(error, "ENOENT")) return void 0;
    throw new SchemaError(`Unable to read managed learning file ${filename}`, error);
  }
}
async function withPromotionLock(paths, operation) {
  const lock = await acquirePromotionLock(paths);
  let result;
  let operationFailed = false;
  let operationError;
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
        { operationError, releaseError }
      );
    }
    throw releaseError;
  }
  if (operationFailed) throw operationError;
  return result;
}
async function acquirePromotionLock(paths) {
  const directory = join4(paths.runtime, PROMOTION_LOCK_DIRECTORY);
  const ownerPath = join4(directory, PROMOTION_LOCK_OWNER);
  const token = randomUUID3();
  const deadline = Date.now() + PROMOTION_LOCK_TIMEOUT_MILLISECONDS;
  await assertNoSymlink(paths.repoRoot, paths.runtime);
  for (; ; ) {
    await assertNoSymlink(paths.repoRoot, directory);
    try {
      await mkdir2(directory);
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
      acquiredAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      await writeFile3(ownerPath, `${JSON.stringify(owner)}
`, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      const cleanupFailures = await cleanupOwnedLock(directory, ownerPath);
      if (cleanupFailures.length > 0) {
        throw new SchemaError(
          `Unable to initialize learning promotion lock ${directory}; cleanup failed for ${cleanupFailures.join(", ")}`,
          error
        );
      }
      throw new SchemaError(`Unable to initialize learning promotion lock ${directory}`, error);
    }
    return { directory, ownerPath, token };
  }
}
async function releasePromotionLock(paths, lock) {
  await assertNoSymlink(paths.repoRoot, lock.ownerPath);
  let owner;
  try {
    owner = JSON.parse(await readFile3(lock.ownerPath, "utf8"));
  } catch (error) {
    throw new SchemaError(
      `Unable to verify ownership before releasing learning promotion lock ${lock.directory}; inspect it manually`,
      error
    );
  }
  if (!isRecord3(owner) || owner.token !== lock.token) {
    throw new SchemaError(
      `Learning promotion lock ownership changed at ${lock.directory}; refusing unsafe cleanup`
    );
  }
  try {
    await unlink(lock.ownerPath);
    await rmdir(lock.directory);
  } catch (error) {
    throw new SchemaError(
      `Unable to release learning promotion lock ${lock.directory}; inspect and remove it only after confirming no promotion is active`,
      error
    );
  }
}
async function describePromotionLock(paths, directory, ownerPath) {
  let ageMilliseconds;
  try {
    ageMilliseconds = Math.max(0, Date.now() - (await lstat5(directory)).mtimeMs);
  } catch (error) {
    if (!isCode(error, "ENOENT")) {
      return `Learning promotion lock is busy at ${directory}; retry after the active promotion completes.`;
    }
  }
  let ownerDescription = "owner metadata is unavailable";
  try {
    await assertNoSymlink(paths.repoRoot, ownerPath);
    const owner = JSON.parse(await readFile3(ownerPath, "utf8"));
    if (isRecord3(owner)) {
      const pid = typeof owner.pid === "number" ? `pid ${owner.pid}` : "unknown pid";
      const acquiredAt = typeof owner.acquiredAt === "string" ? ` since ${owner.acquiredAt}` : "";
      ownerDescription = `${pid}${acquiredAt}`;
    }
  } catch {
  }
  const stale = ageMilliseconds !== void 0 && ageMilliseconds >= PROMOTION_LOCK_STALE_MILLISECONDS;
  const guidance = stale ? "The lock appears stale; verify no Vinea promotion process is active, then remove this lock directory and retry." : "Wait for the active promotion to finish, then retry.";
  return `Learning promotion lock is busy at ${directory} (${ownerDescription}). ${guidance}`;
}
async function cleanupOwnedLock(directory, ownerPath) {
  const failures = [];
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
function delay(milliseconds) {
  return new Promise((resolve8) => {
    setTimeout(resolve8, milliseconds);
  });
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function isCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var DOMAIN_PATTERN, MAX_DOMAIN_CHARACTERS, MAX_ID_CHARACTERS, MAX_RULE_CHARACTERS, MAX_RATIONALE_CHARACTERS, MAX_REASON_CHARACTERS, MAX_ACTOR_CHARACTERS, PROMOTION_LOCK_DIRECTORY, PROMOTION_LOCK_OWNER, PROMOTION_LOCK_RETRY_MILLISECONDS, PROMOTION_LOCK_TIMEOUT_MILLISECONDS, PROMOTION_LOCK_STALE_MILLISECONDS;
var init_learning = __esm({
  "src/core/learning.ts"() {
    "use strict";
    init_config();
    init_errors();
    init_json();
    init_paths();
    init_task_store();
    init_types();
    DOMAIN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    MAX_DOMAIN_CHARACTERS = 100;
    MAX_ID_CHARACTERS = 200;
    MAX_RULE_CHARACTERS = 500;
    MAX_RATIONALE_CHARACTERS = 1e3;
    MAX_REASON_CHARACTERS = 1e3;
    MAX_ACTOR_CHARACTERS = 200;
    PROMOTION_LOCK_DIRECTORY = "learning-promotion.lock";
    PROMOTION_LOCK_OWNER = "owner.json";
    PROMOTION_LOCK_RETRY_MILLISECONDS = 25;
    PROMOTION_LOCK_TIMEOUT_MILLISECONDS = 5e3;
    PROMOTION_LOCK_STALE_MILLISECONDS = 5 * 60 * 1e3;
  }
});

// src/core/task-locks.ts
import { lstat as lstat6, readFile as readFile4, readdir } from "node:fs/promises";
import { basename as basename2, join as join5, relative as relative2 } from "node:path";
async function inspectTaskLocks(paths) {
  const locksDirectory = join5(paths.runtime, "task-locks");
  let entries;
  try {
    await assertNoSymlink(paths.repoRoot, locksDirectory);
    const locks = await lstat6(locksDirectory);
    if (!locks.isDirectory() || locks.isSymbolicLink()) {
      return [
        taskLockDiagnostic(paths, locksDirectory, null, null, "directory_invalid", { status: "unsafe" }),
        ...await inspectNamedRuntimeLock(paths, join5(paths.runtime, PROMOTION_LOCK_DIRECTORY2))
      ].sort((left, right) => left.path.localeCompare(right.path));
    }
    entries = await readdir(locksDirectory);
  } catch (error) {
    if (isMissing4(error)) {
      return inspectNamedRuntimeLock(paths, join5(paths.runtime, PROMOTION_LOCK_DIRECTORY2));
    }
    return [
      taskLockDiagnostic(paths, locksDirectory, null, null, "directory_invalid", { status: "unsafe" }),
      ...await inspectNamedRuntimeLock(paths, join5(paths.runtime, PROMOTION_LOCK_DIRECTORY2))
    ].sort((left, right) => left.path.localeCompare(right.path));
  }
  const diagnostics = await Promise.all(entries.map(async (entry) => inspectTaskLock(paths, join5(locksDirectory, entry))));
  const promotionLock = await inspectNamedRuntimeLock(paths, join5(paths.runtime, PROMOTION_LOCK_DIRECTORY2));
  return [...diagnostics, ...promotionLock].sort((left, right) => left.path.localeCompare(right.path));
}
async function inspectNamedRuntimeLock(paths, directory) {
  try {
    await assertNoSymlink(paths.repoRoot, directory);
    await lstat6(directory);
  } catch (error) {
    if (isMissing4(error)) return [];
    return [taskLockDiagnostic(paths, directory, null, null, "directory_invalid", { status: "unsafe" })];
  }
  return [await inspectTaskLock(paths, directory)];
}
async function inspectTaskLock(paths, directory) {
  const taskId = TASK_LOCK_FILENAME.exec(basename2(directory))?.[1] ?? null;
  let ageMilliseconds = null;
  try {
    await assertNoSymlink(paths.repoRoot, directory);
    const entry = await lstat6(directory);
    ageMilliseconds = Math.max(0, Date.now() - entry.mtimeMs);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      return taskLockDiagnostic(paths, directory, taskId, ageMilliseconds, "directory_invalid", { status: "unsafe" });
    }
  } catch {
    return taskLockDiagnostic(paths, directory, taskId, ageMilliseconds, "directory_invalid", { status: "unsafe" });
  }
  const owner = await inspectTaskLockOwner(paths, join5(directory, "owner.json"));
  const status = owner.status === "valid" ? "retained" : `owner_${owner.status}`;
  return taskLockDiagnostic(paths, directory, taskId, ageMilliseconds, status, owner);
}
async function inspectTaskLockOwner(paths, ownerPath) {
  try {
    await assertNoSymlink(paths.repoRoot, ownerPath);
  } catch (error) {
    return isMissing4(error) ? { status: "missing" } : { status: "unsafe" };
  }
  let contents;
  try {
    contents = await readFile4(ownerPath, "utf8");
  } catch (error) {
    return isMissing4(error) ? { status: "missing" } : { status: "unreadable" };
  }
  try {
    const owner = JSON.parse(contents);
    if (!isRecord4(owner) || typeof owner.token !== "string" || owner.token.trim() === "") {
      return { status: "malformed" };
    }
    return { status: "valid", token: owner.token };
  } catch {
    return { status: "malformed" };
  }
}
function taskLockDiagnostic(paths, directory, taskId, ageMilliseconds, status, owner) {
  const path = relative2(paths.repoRoot, directory).split("\\").join("/");
  return {
    path,
    taskId,
    ageMilliseconds,
    status,
    owner,
    recoveryInstruction: `Confirm no active process, then remove exact lock directory ${path}.`
  };
}
function isMissing4(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var TASK_LOCK_FILENAME, PROMOTION_LOCK_DIRECTORY2;
var init_task_locks = __esm({
  "src/core/task-locks.ts"() {
    "use strict";
    init_paths();
    TASK_LOCK_FILENAME = /^(t-\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*)\.lock$/;
    PROMOTION_LOCK_DIRECTORY2 = "learning-promotion.lock";
  }
});

// src/core/validate.ts
var validate_exports = {};
__export(validate_exports, {
  validateTaskStructure: () => validateTaskStructure,
  validateWorkspace: () => validateWorkspace
});
import { createHash } from "node:crypto";
import { lstat as lstat7, readFile as readFile5, readdir as readdir2 } from "node:fs/promises";
import { basename as basename3, isAbsolute as isAbsolute2, join as join6, relative as relative3, resolve as resolve2 } from "node:path";
async function validateWorkspace(paths) {
  const issues = [];
  const add = (code, filename, message) => {
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
    ["tasks/archive", paths.archivedTasks]
  ]) {
    const kind = await entryKind(directory);
    if (kind === "missing") {
      add("DIRECTORY_MISSING", directory, `Required Vinea directory ${label} is missing.`);
    } else if (kind !== "directory") {
      add("DIRECTORY_INVALID", directory, `Required Vinea path ${label} must be a regular directory.`);
    }
  }
  const taskScan = {
    activeTaskIds: /* @__PURE__ */ new Set(),
    taskIdsByScope: /* @__PURE__ */ new Map()
  };
  await scanTaskScope(paths, paths.activeTasks, "active", limits, taskScan, add);
  await scanTaskScope(paths, paths.archivedTasks, "archive", limits, taskScan, add);
  for (const [taskId, scopes] of taskScan.taskIdsByScope) {
    if (scopes.size > 1) {
      add(
        "TASK_LOCATION_DUPLICATE",
        join6(paths.tasks, taskId),
        `Task ${taskId} is present in both active and archive storage.`
      );
    }
  }
  await validateSessionBindings(paths, taskScan.activeTaskIds, add);
  await validateTaskLocks(paths, add);
  return { issues: sortIssues(issues) };
}
async function validateTaskStructure(paths, location) {
  const issues = [];
  const add = (code, filename, message) => {
    issues.push({ code, path: displayPath(paths, filename), message });
  };
  await validateTaskDirectory(
    paths,
    location.directory,
    basename3(location.directory),
    location.scope,
    null,
    /* @__PURE__ */ new Set(),
    add
  );
  return { issues: sortIssues(issues) };
}
async function validateTaskLocks(paths, add) {
  const locks = await inspectTaskLocks(paths);
  for (const lock of locks) {
    const promotionLock = lock.path === ".vinea/.runtime/learning-promotion.lock";
    const label = promotionLock ? "learning promotion lock" : "task lock";
    const prefix = promotionLock ? "LEARNING_PROMOTION_LOCK" : "TASK_LOCK";
    const association = promotionLock ? label : lock.taskId === null ? "unknown task" : `task ${lock.taskId}`;
    const age = lock.ageMilliseconds === null ? "unknown age" : `age ${lock.ageMilliseconds}ms`;
    const message = `${association}; ${age}. ${lock.recoveryInstruction}`;
    if (lock.status === "directory_invalid") {
      add(`${prefix}_DIRECTORY_INVALID`, join6(paths.repoRoot, lock.path), message);
    } else if (lock.status === "retained") {
      add(`${prefix}_RETAINED`, join6(paths.repoRoot, lock.path), message);
    } else if (lock.status === "owner_missing") {
      add(`${prefix}_OWNER_MISSING`, join6(paths.repoRoot, lock.path), message);
    } else if (lock.status === "owner_malformed") {
      add(`${prefix}_OWNER_MALFORMED`, join6(paths.repoRoot, lock.path), message);
    } else if (lock.status === "owner_unreadable") {
      add(`${prefix}_OWNER_UNREADABLE`, join6(paths.repoRoot, lock.path), message);
    } else {
      add(`${prefix}_OWNER_UNSAFE`, join6(paths.repoRoot, lock.path), message);
    }
  }
}
async function validateManagedSpecs(paths, add) {
  const gitignore = await readRequiredRegularFile(paths.gitignore, "VINEA_GITIGNORE", add);
  if (gitignore !== null && gitignore !== RUNTIME_IGNORE2) {
    add(
      "VINEA_GITIGNORE_INVALID",
      paths.gitignore,
      "Managed .vinea/.gitignore must contain exactly .runtime/."
    );
  }
  if (await entryKind(paths.specs) !== "directory") return;
  const index = await readRequiredRegularFile(paths.specIndex, "SPEC_INDEX", add);
  if (index === null) return;
  const seenTargets = /* @__PURE__ */ new Set();
  for (const [index_, line] of index.split(/\r?\n/u).entries()) {
    if (!/^\s*-\s*\[/u.test(line)) continue;
    const target = parseSpecIndexTarget(line);
    if (target === void 0) {
      add("SPEC_INDEX_ENTRY_INVALID", paths.specIndex, `Line ${index_ + 1} is not a valid indexed spec link.`);
      continue;
    }
    const normalized = normalizeSpecTarget(target);
    if (!MANAGED_SPEC_TARGET.test(normalized)) {
      add(
        "SPEC_INDEX_TARGET_INVALID",
        paths.specIndex,
        `Line ${index_ + 1} must target a managed relative <domain>.md spec file.`
      );
      continue;
    }
    if (seenTargets.has(normalized)) {
      add("SPEC_INDEX_TARGET_DUPLICATE", paths.specIndex, `Line ${index_ + 1} duplicates spec target ${normalized}.`);
      continue;
    }
    seenTargets.add(normalized);
    const targetPath = join6(paths.specs, normalized);
    const kind = await entryKind(targetPath);
    if (kind === "missing") {
      add("SPEC_INDEX_TARGET_MISSING", targetPath, `Indexed spec target ${normalized} is missing.`);
    } else if (kind !== "file") {
      add("SPEC_INDEX_TARGET_INVALID", targetPath, `Indexed spec target ${normalized} must be a regular file.`);
    }
  }
}
async function validateConfig(paths, add) {
  const value = await readJsonObject(paths.config, "CONFIG", add);
  if (value === null) return null;
  if (value.schemaVersion !== SCHEMA_VERSION) {
    add(
      "CONFIG_SCHEMA_UNSUPPORTED",
      paths.config,
      `Config schema ${String(value.schemaVersion)} is unsupported; this CLI supports ${SCHEMA_VERSION}.`
    );
  }
  const riskRules = value.riskRules;
  const context = value.context;
  const validRiskRules = isRecord5(riskRules) && isStringArray(riskRules.medium) && isStringArray(riskRules.high);
  const validContext = isRecord5(context) && isNonNegativeSafeInteger(context.maxFiles) && isNonNegativeSafeInteger(context.maxEstimatedBytes);
  if (!validRiskRules || !validContext) {
    add(
      "CONFIG_INVALID",
      paths.config,
      "Config must define string risk-rule arrays and non-negative integer context budgets."
    );
  }
  return validContext ? {
    maxFiles: context.maxFiles,
    maxEstimatedBytes: context.maxEstimatedBytes
  } : null;
}
async function validateInlineAudit(paths, add) {
  const filename = join6(paths.vineaRoot, "inline-audit.jsonl");
  const contents = await readOptionalRegularFile(filename, "INLINE_AUDIT", add);
  if (contents === null) return;
  for (const { line, lineNumber } of jsonlLines(contents)) {
    const value = parseJsonl(line, lineNumber, filename, "INLINE_AUDIT_JSONL_INVALID", add);
    if (value === null) continue;
    if (!isRecord5(value)) {
      add("INLINE_AUDIT_RECORD_INVALID", filename, `Line ${lineNumber} must contain an object.`);
      continue;
    }
    if (value.schemaVersion !== SCHEMA_VERSION) {
      add(
        "INLINE_AUDIT_SCHEMA_UNSUPPORTED",
        filename,
        `Line ${lineNumber} uses unsupported schema ${String(value.schemaVersion)}.`
      );
    }
    if (!isIsoTimestamp2(value.timestamp) || typeof value.requestSummary !== "string" || value.requestSummary.trim() === "" || typeof value.reason !== "string" || value.reason.trim() === "" || !isRecord5(value.proposedRisk) || !["low", "medium", "high"].includes(String(value.proposedRisk.level)) || !isStringArray(value.proposedRisk.reasons)) {
      add("INLINE_AUDIT_RECORD_INVALID", filename, `Line ${lineNumber} is not a valid inline-audit record.`);
    }
  }
}
async function scanTaskScope(paths, directory, scope, limits, scan, add) {
  if (await entryKind(directory) !== "directory") return;
  let entries;
  try {
    entries = await readdir2(directory, { withFileTypes: true });
  } catch (error) {
    add("DIRECTORY_UNREADABLE", directory, describeError("Unable to list task storage", error));
    return;
  }
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const taskDirectory = join6(directory, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      add("TASK_ENTRY_INVALID", taskDirectory, "Task storage entries must be regular directories.");
      continue;
    }
    const scopes = scan.taskIdsByScope.get(entry.name) ?? /* @__PURE__ */ new Set();
    scopes.add(scope);
    scan.taskIdsByScope.set(entry.name, scopes);
    await validateTaskDirectory(paths, taskDirectory, entry.name, scope, limits, scan.activeTaskIds, add);
  }
}
async function validateTaskDirectory(paths, directory, directoryName, scope, limits, activeTaskIds, add) {
  const taskFilename = join6(directory, "task.json");
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
        `Task schema ${String(task.schemaVersion)} is unsupported; this CLI supports ${SCHEMA_VERSION}.`
      );
    }
    const status = typeof task.status === "string" ? task.status : "";
    if (!ALL_STATUSES.has(status)) {
      add("TASK_STATUS_INVALID", taskFilename, `Unknown task status: ${String(task.status)}.`);
    } else if (scope === "active" && status === "archived" || scope === "archive" && status !== "archived") {
      add(
        "TASK_STATE_SCOPE_INVALID",
        taskFilename,
        `Status ${status} is invalid in ${scope} task storage.`
      );
    }
    if (!isTaskRecordShape(task)) {
      add("TASK_RECORD_INVALID", taskFilename, "Task record does not match the supported task structure.");
    }
    validateTaskRequirementIds(task, taskFilename, add);
    if (scope === "active" && taskId === directoryName && TASK_ID_PATTERN.test(taskId) && task.schemaVersion === SCHEMA_VERSION && ACTIVE_STATUSES.has(status) && isTaskRecordShape(task)) {
      activeTaskIds.add(taskId);
    }
  }
  for (const artifact of REQUIRED_TASK_ARTIFACTS) {
    const filename = join6(directory, artifact);
    const kind = await entryKind(filename);
    if (kind === "missing") {
      add("TASK_ARTIFACT_MISSING", filename, `Required task artifact ${artifact} is missing.`);
    } else if (kind !== "file") {
      add("TASK_ARTIFACT_INVALID", filename, `Required task artifact ${artifact} must be a regular file.`);
    }
  }
  await validateContextManifest(paths, join6(directory, "context.jsonl"), limits, add);
  const evidence = await validateEvidenceArtifact(join6(directory, "evidence.jsonl"), add);
  await validateJournalArtifact(paths, join6(directory, "journal.md"), task, directory, scope, add);
  await validateCheckArtifact(paths, join6(directory, "check.md"), task, evidence, add);
}
async function validateContextManifest(paths, filename, limits, add) {
  const contents = await readOptionalRegularFile(filename, "CONTEXT", add);
  if (contents === null) return;
  let files = 0;
  let estimatedBytes = 0;
  const pathsSeen = /* @__PURE__ */ new Set();
  for (const { line, lineNumber } of jsonlLines(contents)) {
    const value = parseJsonl(line, lineNumber, filename, "CONTEXT_JSONL_INVALID", add);
    if (value === null) continue;
    if (!isRecord5(value)) {
      add("CONTEXT_RECORD_INVALID", filename, `Line ${lineNumber} must contain an object.`);
      continue;
    }
    if (value.schemaVersion !== SCHEMA_VERSION) {
      add(
        "CONTEXT_SCHEMA_UNSUPPORTED",
        filename,
        `Line ${lineNumber} uses unsupported schema ${String(value.schemaVersion)}.`
      );
    }
    const validBytes = isNonNegativeSafeInteger(value.estimatedBytes);
    const normalizedPath = typeof value.path === "string" ? normalizeRepositoryPath(value.path) : null;
    if (typeof value.path !== "string" || normalizedPath === null || normalizedPath !== value.path || typeof value.purpose !== "string" || value.purpose.trim() === "" || !validBytes || !isIsoTimestamp2(value.addedAt)) {
      add("CONTEXT_RECORD_INVALID", filename, `Line ${lineNumber} is not a valid context reference.`);
    }
    files += 1;
    if (validBytes) estimatedBytes += value.estimatedBytes;
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
      `Context manifest has ${files} files; configured maximum is ${limits.maxFiles}.`
    );
  }
  if (limits !== null && estimatedBytes > limits.maxEstimatedBytes) {
    add(
      "CONTEXT_BYTE_BUDGET_EXCEEDED",
      filename,
      `Context manifest estimates ${estimatedBytes} bytes; configured maximum is ${limits.maxEstimatedBytes}.`
    );
  }
}
async function validateContextPath(paths, manifest, repositoryPath, lineNumber, add) {
  const normalized = normalizeRepositoryPath(repositoryPath);
  if (normalized === null) {
    add("CONTEXT_PATH_INVALID", manifest, `Line ${lineNumber} has an unsafe context path: ${repositoryPath}.`);
    return;
  }
  let current = paths.repoRoot;
  for (const segment of normalized.split("/")) {
    current = join6(current, segment);
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
  if (await entryKind(resolve2(paths.repoRoot, normalized)) !== "file") {
    add("CONTEXT_PATH_INVALID", manifest, `Line ${lineNumber} must reference a regular file: ${normalized}.`);
  }
}
async function validateEvidenceArtifact(filename, add) {
  const contents = await readOptionalRegularFile(filename, "EVIDENCE", add);
  if (contents === null) return [];
  const records = [];
  const seenIds = /* @__PURE__ */ new Set();
  for (const { line, lineNumber } of jsonlLines(contents)) {
    const value = parseJsonl(line, lineNumber, filename, "EVIDENCE_JSONL_INVALID", add);
    if (value === null) continue;
    if (isRecord5(value) && value.schemaVersion !== SCHEMA_VERSION) {
      add(
        "EVIDENCE_SCHEMA_UNSUPPORTED",
        filename,
        `Line ${lineNumber} uses unsupported schema ${String(value.schemaVersion)}.`
      );
    }
    let record;
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
async function validateJournalArtifact(paths, filename, task, taskDirectory, scope, add) {
  const contents = await readOptionalRegularFile(filename, "JOURNAL", add);
  if (contents === null) return;
  if (contents.trim() === "") {
    add("JOURNAL_EMPTY", filename, "Task journal must contain its creation event.");
    return;
  }
  const operationIds = /* @__PURE__ */ new Set();
  let creationCount = 0;
  let firstEvent = true;
  let currentStatus = null;
  let replayIsValid = true;
  let lastTransition = null;
  let lastValidEventType = null;
  const pendingMutationIntents = /* @__PURE__ */ new Map();
  const committedMutationIntents = [];
  const latestLearningMutationOperation = /* @__PURE__ */ new Map();
  for (const { line, lineNumber } of jsonlLines(contents)) {
    const value = parseJsonl(line, lineNumber, filename, "JOURNAL_JSONL_INVALID", add);
    if (value === null) continue;
    if (isRecord5(value) && value.schemaVersion !== SCHEMA_VERSION) {
      add(
        "JOURNAL_SCHEMA_UNSUPPORTED",
        filename,
        `Line ${lineNumber} uses unsupported schema ${String(value.schemaVersion)}.`
      );
    }
    if (!isJournalEvent(value)) {
      add("JOURNAL_EVENT_INVALID", filename, `Line ${lineNumber} is not a valid journal event.`);
      replayIsValid = false;
      continue;
    }
    lastValidEventType = value.type;
    if (value.type === "mutation_intent") {
      const operationId = value.operationId;
      if (pendingMutationIntents.has(operationId)) {
        add("MUTATION_INTENT_DUPLICATE", filename, `Line ${lineNumber} duplicates pending mutation intent ${operationId}.`);
      } else {
        pendingMutationIntents.set(operationId, value);
      }
    } else if (isMutationCompletionEvent(value)) {
      const operationId = value.operationId;
      const intent = pendingMutationIntents.get(operationId);
      if (intent === void 0) {
        if (!isLegacyMutationCompletion(value)) {
          add(
            "MUTATION_COMPLETION_ORPHAN",
            filename,
            `Line ${lineNumber} completion ${value.type} with operation ID ${operationId} has no matching mutation intent.`
          );
        }
      } else if (!matchesMutationCompletion(intent, value)) {
        add("MUTATION_COMPLETION_MISMATCH", filename, `Line ${lineNumber} does not match mutation intent ${operationId}.`);
      } else {
        pendingMutationIntents.delete(operationId);
        committedMutationIntents.push(intent);
        if (String(value.type).startsWith("learning_") && typeof value.learningCandidateId === "string") {
          latestLearningMutationOperation.set(value.learningCandidateId, operationId);
        }
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
      const oldStatus = value.oldStatus;
      const newStatus = value.newStatus;
      if (currentStatus === null || oldStatus !== currentStatus) {
        add(
          "JOURNAL_STATUS_DISCONTINUITY",
          filename,
          `Line ${lineNumber} transition starts at ${oldStatus}, but the prior journal status is ${String(currentStatus)}.`
        );
        replayIsValid = false;
      } else if (!isLegalJournalTransition(oldStatus, newStatus)) {
        add(
          "JOURNAL_TRANSITION_INVALID",
          filename,
          `Line ${lineNumber} transition from ${oldStatus} to ${newStatus} is not allowed.`
        );
        replayIsValid = false;
      } else {
        currentStatus = newStatus;
        lastTransition = { oldStatus, newStatus };
      }
    } else if (value.type === "continued") {
      const status = value.status;
      if (currentStatus === null || status !== currentStatus) {
        add(
          "JOURNAL_STATUS_DISCONTINUITY",
          filename,
          `Line ${lineNumber} continuation records ${status}, but the prior journal status is ${String(currentStatus)}.`
        );
        replayIsValid = false;
      }
    }
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
  if (replayIsValid && creationCount === 1 && currentStatus !== null && task !== null && isTaskStatus(task.status) && task.status !== currentStatus && (lastValidEventType !== "transition_intent" || lastTransition === null || task.status !== lastTransition.oldStatus)) {
    add(
      "JOURNAL_TASK_STATUS_MISMATCH",
      filename,
      `Journal resolves to ${currentStatus}, but task.json records ${task.status}.`
    );
  }
  const mutationOwner = mutationTargetOwnerForValidation(taskDirectory, scope, task);
  for (const intent of pendingMutationIntents.values()) {
    add(
      "MUTATION_INTENT_UNCOMMITTED",
      filename,
      `Mutation intent ${String(intent.operationId)} for ${String(intent.mutationKind)} has no matching completion event.`
    );
    const expected = intent.expected;
    if (!isMutationTargetSummary(expected) || !mutationTargetsAreOwned(
      paths,
      mutationOwner,
      String(intent.mutationKind),
      expected
    )) {
      add(
        "MUTATION_TARGET_MISMATCH",
        filename,
        `Pending mutation ${String(intent.operationId)} for ${String(intent.mutationKind)} has targets outside its exact managed ownership.`
      );
    }
  }
  const pendingTargetFiles = /* @__PURE__ */ new Set();
  for (const intent of pendingMutationIntents.values()) {
    const expected = intent.expected;
    if (!isMutationTargetSummary(expected)) continue;
    const identity = expected.identity;
    if (String(intent.mutationKind).startsWith("learning_") && typeof identity.learningCandidateId === "string") {
      latestLearningMutationOperation.set(identity.learningCandidateId, intent.operationId);
    }
    for (const target of expected.files) {
      pendingTargetFiles.add(target.path);
    }
  }
  const latestIntentByFile = /* @__PURE__ */ new Map();
  const latestIntentBySemanticIdentity = /* @__PURE__ */ new Map();
  for (const intent of committedMutationIntents) {
    latestIntentBySemanticIdentity.set(mutationSemanticIdentityKey(intent), intent);
    const expected = intent.expected;
    if (!isMutationTargetSummary(expected)) continue;
    for (const target of expected.files) {
      const path = target.path;
      if (!path.endsWith("/task.json") && intent.mutationKind !== "learning_accepted") {
        latestIntentByFile.set(path, intent);
      }
    }
  }
  for (const intent of latestIntentBySemanticIdentity.values()) {
    if (isSupersededLearningMutation(intent, latestLearningMutationOperation)) continue;
    if (!semanticMutationTargetMatches(task, intent)) {
      add(
        "MUTATION_TARGET_MISMATCH",
        filename,
        `Completed mutation ${String(intent.operationId)} for ${String(intent.mutationKind)} does not match its expected managed target identity.`
      );
    } else if (intent.mutationKind === "learning_accepted" && !await acceptedLearningTargetsMatch(paths, task, mutationOwner, intent)) {
      add(
        "MUTATION_TARGET_MISMATCH",
        filename,
        `Completed learning acceptance ${String(intent.operationId)} no longer matches its candidate-domain spec or index target.`
      );
    }
  }
  for (const [path, intent] of latestIntentByFile) {
    if (pendingTargetFiles.has(path)) continue;
    if (!await mutationFilesMatch(
      paths,
      mutationOwner,
      String(intent.mutationKind),
      intent.expected
    )) {
      add(
        "MUTATION_TARGET_MISMATCH",
        filename,
        `Completed mutation ${String(intent.operationId)} for ${String(intent.mutationKind)} does not match its latest expected managed files.`
      );
    }
  }
}
function isSupersededLearningMutation(intent, latestLearningMutationOperation) {
  const expected = intent.expected;
  if (!isMutationTargetSummary(expected) || !String(intent.mutationKind).startsWith("learning_")) return false;
  const id = expected.identity.learningCandidateId;
  return typeof id === "string" && latestLearningMutationOperation.get(id) !== intent.operationId;
}
function mutationSemanticIdentityKey(intent) {
  const expected = intent.expected;
  if (!isMutationTargetSummary(expected)) return `operation:${String(intent.operationId)}`;
  const identity = expected.identity;
  const mutationKind = String(intent.mutationKind);
  if (mutationKind.startsWith("learning_") && typeof identity.learningCandidateId === "string") {
    return `learning:${identity.learningCandidateId}`;
  }
  if (typeof identity.requirementId === "string") {
    return `${mutationKind}:${identity.requirementId}`;
  }
  return `operation:${String(intent.operationId)}`;
}
async function mutationFilesMatch(paths, owner, mutationKind, expected) {
  if (!isMutationTargetSummary(expected)) return false;
  if (!mutationTargetsAreOwned(paths, owner, mutationKind, expected)) {
    return false;
  }
  for (const target of expected.files) {
    const path = target.path;
    const filename = resolveMutationTargetFilename(paths, owner, path);
    if (path.endsWith("/task.json")) continue;
    if (await entryKind(filename) !== "file") return false;
    try {
      const contents = await readFile5(filename);
      if (createHash("sha256").update(contents).digest("hex") !== target.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}
function resolveMutationTargetFilename(paths, owner, target) {
  const taskPrefix = relative3(paths.repoRoot, owner.directory).split("\\").join("/");
  if (target.startsWith(`${taskPrefix}/`)) return join6(owner.directory, target.slice(taskPrefix.length + 1));
  const historicPrefix = `.vinea/tasks/active/${owner.taskId}`;
  if (owner.scope === "archive" && target.startsWith(`${historicPrefix}/`)) {
    return join6(owner.directory, target.slice(historicPrefix.length + 1));
  }
  return resolve2(paths.repoRoot, target);
}
function mutationTargetOwnerForValidation(directory, scope, task) {
  const learningCandidateDomains = {};
  if (Array.isArray(task?.learningCandidates)) {
    for (const candidate of task.learningCandidates) {
      if (isRecord5(candidate) && typeof candidate.id === "string" && typeof candidate.domain === "string") {
        learningCandidateDomains[candidate.id] = candidate.domain;
      }
    }
  }
  return {
    directory,
    scope,
    taskId: typeof task?.id === "string" ? task.id : "",
    learningCandidateDomains
  };
}
function semanticMutationTargetMatches(task, intent) {
  const expected = intent.expected;
  if (task === null || !isMutationTargetSummary(expected)) return false;
  const identity = expected.identity;
  const mutationKind = intent.mutationKind;
  if (mutationKind === "requirement_added" || mutationKind === "acceptance_criterion_added") {
    const collection = mutationKind === "requirement_added" ? task.requirements : task.acceptanceCriteria;
    const requirement = Array.isArray(collection) ? collection.find((item) => isRecord5(item) && item.id === identity.requirementId) : void 0;
    return requirement !== void 0 && mutationIdentityValueMatches(requirement, identity);
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
function hasLearningCandidate(task, identity, status) {
  if (typeof identity.learningCandidateId !== "string" || !Array.isArray(task.learningCandidates)) return false;
  const candidate = task.learningCandidates.find((item) => isRecord5(item) && item.id === identity.learningCandidateId && item.status === status);
  return candidate !== void 0 && mutationIdentityValueMatches(candidate, identity);
}
async function acceptedLearningTargetsMatch(paths, task, owner, intent) {
  const expected = intent.expected;
  if (task === null || !isMutationTargetSummary(expected) || !mutationTargetsAreOwned(
    paths,
    owner,
    "learning_accepted",
    expected
  )) {
    return false;
  }
  const identity = expected.identity;
  const candidate = acceptedLearningCandidate(task, identity);
  if (candidate === null) return false;
  const normalizedRule = candidate.text.trim().replace(/\s+/gu, " ");
  const rule = `- ${candidate.acceptedAt.slice(0, 10)}: ${normalizedRule}`;
  const specPath = join6(paths.specs, `${candidate.domain}.md`);
  if (await entryKind(specPath) !== "file" || await entryKind(paths.specIndex) !== "file") return false;
  let spec;
  let index;
  try {
    [spec, index] = await Promise.all([
      readFile5(specPath, "utf8"),
      readFile5(paths.specIndex, "utf8")
    ]);
  } catch {
    return false;
  }
  if (!spec.split(/\r?\n/u).some((line) => line === rule)) return false;
  return index.split(/\r?\n/u).some((line) => {
    const target = parseSpecIndexTarget(line);
    return target !== void 0 && normalizeSpecTarget(target) === `${candidate.domain}.md`;
  });
}
function acceptedLearningCandidate(task, identity) {
  if (typeof identity.learningCandidateId !== "string" || !Array.isArray(task.learningCandidates)) return null;
  const candidate = task.learningCandidates.find((item) => isRecord5(item) && item.id === identity.learningCandidateId && item.status === "accepted" && item.confirmedBy === "user" && typeof item.domain === "string" && typeof item.text === "string" && isIsoTimestamp2(item.acceptedAt));
  if (candidate === void 0 || !mutationIdentityValueMatches(candidate, identity)) return null;
  const domain = candidate.domain;
  const text = candidate.text;
  const acceptedAt = candidate.acceptedAt;
  if (text.trim() === "" || !MANAGED_SPEC_TARGET.test(`${domain}.md`)) return null;
  return { domain, text, acceptedAt };
}
function mutationIdentityValueMatches(value, identity) {
  if (identity.valueSha256 === void 0) return true;
  return typeof identity.valueSha256 === "string" && /^[a-f0-9]{64}$/u.test(identity.valueSha256) && createHash("sha256").update(stableJson(value)).digest("hex") === identity.valueSha256;
}
async function validateCheckArtifact(paths, filename, task, evidence, add) {
  const contents = await readOptionalRegularFile(filename, "CHECK", add);
  if (contents === null || contents === "") return;
  const declaredIds = task === null ? [] : taskRequirementIds(task);
  try {
    parseCheckDocument(contents, paths.repoRoot, declaredIds, evidence, filename);
  } catch {
    add(
      "CHECK_PAYLOAD_INVALID",
      filename,
      "Check document must match a valid authoritative payload, declared requirements, evidence, and rendered table."
    );
  }
}
async function validateSessionBindings(paths, activeTaskIds, add) {
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
    entries = await readdir2(paths.sessions, { withFileTypes: true });
  } catch (error) {
    add("RUNTIME_UNREADABLE", paths.sessions, describeError("Unable to list session bindings", error));
    return;
  }
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const filename = join6(paths.sessions, entry.name);
    const validFilename = isValidSessionBindingFilename(entry.name);
    if (!validFilename) {
      add(
        "SESSION_FILENAME_INVALID",
        filename,
        "Session bindings must use <codex|claude>-sid-<lowercase UTF-8 hex>.json filenames."
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
        `Session binding schema ${String(value.schemaVersion)} is unsupported.`
      );
    }
    if (!isSessionBindingShape(value)) {
      add("SESSION_BINDING_INVALID", filename, "Session binding record is malformed.");
      continue;
    }
    if (!activeTaskIds.has(value.taskId)) {
      add(
        "SESSION_BINDING_STALE",
        filename,
        `Session binding points to non-active task ${String(value.taskId)}.`
      );
    }
  }
}
async function readJsonObject(filename, prefix, add) {
  const contents = await readRequiredRegularFile(filename, prefix, add);
  if (contents === null) return null;
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    add(`${prefix}_JSON_INVALID`, filename, "File does not contain valid JSON.");
    return null;
  }
  if (!isRecord5(value)) {
    add(`${prefix}_INVALID`, filename, "File must contain a JSON object.");
    return null;
  }
  return value;
}
async function readRequiredRegularFile(filename, prefix, add) {
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
    return await readFile5(filename, "utf8");
  } catch (error) {
    add(`${prefix}_UNREADABLE`, filename, describeError("Unable to read file", error));
    return null;
  }
}
async function readOptionalRegularFile(filename, prefix, add) {
  if (await entryKind(filename) === "missing") return null;
  return readRequiredRegularFile(filename, prefix, add);
}
function parseJsonl(line, lineNumber, filename, code, add) {
  try {
    return JSON.parse(line);
  } catch {
    add(code, filename, `Line ${lineNumber} is not valid JSON.`);
    return null;
  }
}
function jsonlLines(contents) {
  return contents.split("\n").map((line, index) => ({ line, lineNumber: index + 1 })).filter(({ line }) => line.trim() !== "");
}
function isTaskRecordShape(value) {
  return value.schemaVersion === SCHEMA_VERSION && typeof value.id === "string" && TASK_ID_PATTERN.test(value.id) && typeof value.title === "string" && value.title.trim() !== "" && ALL_STATUSES.has(String(value.status)) && isRecord5(value.risk) && ["low", "medium", "high"].includes(String(value.risk.level)) && isStringArray(value.risk.reasons) && ["standard", "tdd"].includes(String(value.qualityMode)) && ["single-agent", "delegated"].includes(String(value.executionMode)) && Array.isArray(value.requirements) && value.requirements.every(isRequirement) && Array.isArray(value.acceptanceCriteria) && value.acceptanceCriteria.every(isRequirement) && isLearningCandidates(value.learningCandidates) && isCommitMetadata(value.commit) && isIsoTimestamp2(value.createdAt) && isIsoTimestamp2(value.updatedAt);
}
function validateTaskRequirementIds(task, filename, add) {
  const seen = /* @__PURE__ */ new Set();
  for (const id of taskRequirementIds(task)) {
    if (seen.has(id)) {
      add("TASK_REQUIREMENT_ID_DUPLICATE", filename, `Task declares duplicate requirement or acceptance ID ${id}.`);
    } else {
      seen.add(id);
    }
  }
}
function taskRequirementIds(task) {
  return [task.requirements, task.acceptanceCriteria].flatMap((collection) => Array.isArray(collection) ? collection : []).flatMap((requirement) => isRecord5(requirement) && typeof requirement.id === "string" ? [requirement.id] : []);
}
function isLegalJournalTransition(oldStatus, newStatus) {
  if (oldStatus === newStatus) return false;
  if (oldStatus === "blocked") return UNBLOCK_TARGETS.has(newStatus);
  return BLOCKABLE_STATUSES.has(oldStatus) && newStatus === "blocked" || FORWARD_TRANSITIONS[oldStatus] === newStatus;
}
function isTaskStatus(value) {
  return typeof value === "string" && ALL_STATUSES.has(value);
}
function isJournalEvent(value) {
  if (!isRecord5(value) || value.schemaVersion !== SCHEMA_VERSION || !isIsoTimestamp2(value.timestamp) || !isNonemptyString(value.actor) || typeof value.type !== "string") {
    return false;
  }
  if (value.type === "created") {
    return hasOnlyKeys(value, ["schemaVersion", "type", "timestamp", "actor", "confirmation", "status"]) && value.confirmation === "user" && value.status === "planning";
  }
  if (value.type === "transition_intent") {
    return hasOnlyKeys(value, [
      "schemaVersion",
      "type",
      "operationId",
      "timestamp",
      "actor",
      "reason",
      "oldStatus",
      "newStatus"
    ]) && isNonemptyString(value.operationId) && isNonemptyString(value.reason) && ALL_STATUSES.has(String(value.oldStatus)) && ALL_STATUSES.has(String(value.newStatus));
  }
  if (value.type === "mutation_intent") {
    return hasOnlyKeys(value, [
      "schemaVersion",
      "type",
      "operationId",
      "timestamp",
      "actor",
      "mutationKind",
      "fingerprint",
      "expected",
      "completion"
    ]) && isNonemptyString(value.operationId) && isMutationKind(value.mutationKind) && /^[a-f0-9]{64}$/u.test(String(value.fingerprint)) && isMutationTargetSummary(value.expected) && isMutationCompletion(value.completion, value.operationId, value.mutationKind);
  }
  if (value.type === "continued") {
    return hasOnlyKeys(value, [
      "schemaVersion",
      "type",
      "timestamp",
      "actor",
      "confirmation",
      "host",
      "sessionBound",
      "started",
      "status"
    ]) && value.confirmation === "user" && (value.host === "codex" || value.host === "claude") && typeof value.sessionBound === "boolean" && typeof value.started === "boolean" && ALL_STATUSES.has(String(value.status));
  }
  if (value.type === "check_recorded" || value.type === "check_updated") {
    return hasOnlyKeys(value, [
      "schemaVersion",
      "type",
      "mutationKind",
      "mutationProtocolVersion",
      "operationId",
      "timestamp",
      "actor",
      "requirementId",
      "result"
    ]) && isNonemptyString(value.operationId) && (value.mutationKind === void 0 || value.mutationKind === value.type) && (value.mutationProtocolVersion === void 0 || value.mutationProtocolVersion === 1) && isNonemptyString(value.requirementId) && ["pass", "fail", "uncovered"].includes(String(value.result));
  }
  if (!TASK_MUTATION_KINDS.has(value.type)) return false;
  if (value.mutationKind !== void 0 && value.mutationKind !== value.type || value.mutationProtocolVersion !== void 0 && value.mutationProtocolVersion !== 1 || !isNonemptyString(value.operationId)) {
    return false;
  }
  if (value.type === "requirement_added" || value.type === "acceptance_criterion_added") {
    return hasOnlyKeys(value, [
      "schemaVersion",
      "type",
      "mutationKind",
      "mutationProtocolVersion",
      "operationId",
      "timestamp",
      "actor",
      "requirementId"
    ]) && isNonemptyString(value.requirementId);
  }
  if (value.type === "brief_set") {
    return hasOnlyKeys(value, [
      "schemaVersion",
      "type",
      "mutationKind",
      "mutationProtocolVersion",
      "operationId",
      "timestamp",
      "actor",
      "artifact"
    ]) && value.artifact === "brief.md";
  }
  if (value.type === "plan_set") {
    return hasOnlyKeys(value, [
      "schemaVersion",
      "type",
      "mutationKind",
      "mutationProtocolVersion",
      "operationId",
      "timestamp",
      "actor",
      "artifact"
    ]) && value.artifact === "plan.md";
  }
  if (value.type === "context_added") {
    return hasOnlyKeys(value, [
      "schemaVersion",
      "type",
      "mutationKind",
      "mutationProtocolVersion",
      "operationId",
      "timestamp",
      "actor",
      "path"
    ]) && isNonemptyString(value.path);
  }
  if (value.type === "evidence_recorded") {
    return hasOnlyKeys(value, [
      "schemaVersion",
      "type",
      "mutationKind",
      "mutationProtocolVersion",
      "operationId",
      "timestamp",
      "actor",
      "evidenceId",
      "evidenceKind"
    ]) && isNonemptyString(value.evidenceId) && ["command", "manual", "tdd-red", "tdd-green"].includes(String(value.evidenceKind));
  }
  if (value.type === "learning_accepted") {
    return hasOnlyKeys(value, [
      "schemaVersion",
      "type",
      "mutationKind",
      "mutationProtocolVersion",
      "operationId",
      "timestamp",
      "actor",
      "learningCandidateId",
      "confirmedBy"
    ]) && isNonemptyString(value.learningCandidateId) && value.confirmedBy === "user";
  }
  return hasOnlyKeys(value, [
    "schemaVersion",
    "type",
    "mutationKind",
    "mutationProtocolVersion",
    "operationId",
    "timestamp",
    "actor",
    "learningCandidateId"
  ]) && isNonemptyString(value.learningCandidateId);
}
function isMutationCompletionEvent(value) {
  return typeof value.type === "string" && (value.type === "check_recorded" || value.type === "check_updated" || TASK_MUTATION_KINDS.has(value.type));
}
function isLegacyMutationCompletion(value) {
  return isMutationCompletionEvent(value) && value.mutationProtocolVersion === void 0;
}
function isMutationKind(value) {
  return typeof value === "string" && (TASK_MUTATION_KINDS.has(value) || value === "check_upsert");
}
function isMutationTargetSummary(value) {
  if (!isRecord5(value) || !hasOnlyKeys(value, ["identity", "files"]) || !isRecord5(value.identity) || !Array.isArray(value.files)) {
    return false;
  }
  if (Object.values(value.identity).some((item) => typeof item !== "string" || item.trim() === "")) return false;
  const paths = /* @__PURE__ */ new Set();
  return value.files.length > 0 && value.files.every((target) => {
    if (!isRecord5(target) || !hasOnlyKeys(target, ["path", "sha256"]) || !isNonemptyString(target.path) || !/^[a-f0-9]{64}$/u.test(String(target.sha256)) || paths.has(target.path)) {
      return false;
    }
    paths.add(target.path);
    return true;
  });
}
function isMutationCompletion(value, operationId, _mutationKind) {
  if (!isRecord5(value)) return false;
  return isJournalEvent({ ...value, operationId }) && value.operationId === void 0;
}
function matchesMutationCompletion(intent, completion) {
  const expected = intent.completion;
  if (!isRecord5(expected)) return false;
  const actual = { ...completion };
  delete actual.operationId;
  return stableJson(expected) === stableJson(actual);
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord5(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function isNonemptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}
function isSessionBindingShape(value) {
  return Object.keys(value).every((key) => ["schemaVersion", "taskId", "boundAt"].includes(key)) && value.schemaVersion === SCHEMA_VERSION && typeof value.taskId === "string" && TASK_ID_PATTERN.test(value.taskId) && isIsoTimestamp2(value.boundAt);
}
function isRequirement(value) {
  return isRecord5(value) && Object.keys(value).every((key) => ["schemaVersion", "id", "text", "createdAt"].includes(key)) && value.schemaVersion === SCHEMA_VERSION && typeof value.id === "string" && value.id.trim() !== "" && typeof value.text === "string" && value.text.trim() !== "" && isIsoTimestamp2(value.createdAt);
}
function isLearningCandidates(value) {
  if (value === void 0) return true;
  if (!Array.isArray(value)) return false;
  const ids = /* @__PURE__ */ new Set();
  for (const candidate of value) {
    if (!isRecord5(candidate) || candidate.schemaVersion !== SCHEMA_VERSION || typeof candidate.id !== "string" || candidate.id.trim() === "" || ids.has(candidate.id) || typeof candidate.domain !== "string" || candidate.domain.trim() === "" || typeof candidate.text !== "string" || candidate.text.trim() === "" || typeof candidate.rationale !== "string" || candidate.rationale.trim() === "" || !isIsoTimestamp2(candidate.proposedAt)) {
      return false;
    }
    ids.add(candidate.id);
    if (candidate.status === "proposed") continue;
    if (candidate.status === "accepted" && candidate.confirmedBy === "user" && isIsoTimestamp2(candidate.acceptedAt)) {
      continue;
    }
    if (candidate.status === "archived" && typeof candidate.archiveReason === "string" && candidate.archiveReason.trim() !== "" && isIsoTimestamp2(candidate.archivedAt)) {
      continue;
    }
    return false;
  }
  return true;
}
function isCommitMetadata(value) {
  if (value === null) return true;
  return isRecord5(value) && Object.keys(value).every((key) => ["sha", "message"].includes(key)) && typeof value.sha === "string" && value.sha.trim() !== "" && (value.message === void 0 || typeof value.message === "string");
}
function isValidSessionBindingFilename(filename) {
  const match = /^(?:codex|claude)-sid-([0-9a-f]+)\.json$/.exec(filename);
  if (match === null) return false;
  const hex = match[1];
  if (hex.length === 0 || hex.length % 2 !== 0 || hex.length > 238) return false;
  const bytes = Buffer.from(hex, "hex");
  let sessionId;
  try {
    sessionId = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  return sessionId !== "" && sessionId !== "." && sessionId !== ".." && !sessionId.includes("/") && !sessionId.includes("\\") && !sessionId.includes("\0") && Buffer.from(sessionId, "utf8").toString("hex") === hex;
}
function normalizeRepositoryPath(input) {
  const value = input.trim();
  if (value === "" || isAbsolute2(value) || /^[a-zA-Z]:[/\\]/.test(value) || value.startsWith("\\")) {
    return null;
  }
  const segments = value.split(/[/\\]/);
  if (segments.includes("..")) return null;
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (normalized === "" || normalized === ".vinea/.runtime" || normalized.startsWith(".vinea/.runtime/")) {
    return null;
  }
  return normalized;
}
async function entryKind(path) {
  try {
    const entry = await lstat7(path);
    if (entry.isSymbolicLink()) return "symlink";
    if (entry.isFile()) return "file";
    if (entry.isDirectory()) return "directory";
    return "other";
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return "missing";
    return "other";
  }
}
function displayPath(paths, filename) {
  const value = relative3(paths.repoRoot, filename).split("\\").join("/");
  return value === "" ? "." : value;
}
function sortIssues(issues) {
  return issues.sort(
    (left, right) => compareText(left.path, right.path) || compareText(left.code, right.code) || compareText(left.message, right.message)
  );
}
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isNonNegativeSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function isIsoTimestamp2(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}
function isErrorCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function describeError(prefix, error) {
  return `${prefix}: ${error instanceof Error ? error.message : "unknown error"}.`;
}
var REQUIRED_TASK_ARTIFACTS, TASK_ID_PATTERN, ACTIVE_STATUSES, ALL_STATUSES, FORWARD_TRANSITIONS, BLOCKABLE_STATUSES, UNBLOCK_TARGETS, TASK_MUTATION_KINDS, RUNTIME_IGNORE2, MANAGED_SPEC_TARGET;
var init_validate = __esm({
  "src/core/validate.ts"() {
    "use strict";
    init_check();
    init_evidence();
    init_learning();
    init_task_store();
    init_task_locks();
    init_types();
    REQUIRED_TASK_ARTIFACTS = [
      "brief.md",
      "plan.md",
      "context.jsonl",
      "evidence.jsonl",
      "check.md",
      "journal.md"
    ];
    TASK_ID_PATTERN = /^t-\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
    ACTIVE_STATUSES = /* @__PURE__ */ new Set(["planning", "ready", "in_progress", "checking", "finished", "blocked"]);
    ALL_STATUSES = /* @__PURE__ */ new Set([...ACTIVE_STATUSES, "archived"]);
    FORWARD_TRANSITIONS = {
      planning: "ready",
      ready: "in_progress",
      in_progress: "checking",
      checking: "finished",
      finished: "archived"
    };
    BLOCKABLE_STATUSES = /* @__PURE__ */ new Set(["planning", "ready", "in_progress", "checking"]);
    UNBLOCK_TARGETS = /* @__PURE__ */ new Set(["ready", "in_progress", "checking"]);
    TASK_MUTATION_KINDS = /* @__PURE__ */ new Set([
      "requirement_added",
      "acceptance_criterion_added",
      "brief_set",
      "plan_set",
      "context_added",
      "evidence_recorded",
      "learning_proposed",
      "learning_accepted",
      "learning_archived"
    ]);
    RUNTIME_IGNORE2 = ".runtime/\n";
    MANAGED_SPEC_TARGET = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
  }
});

// src/core/task-store.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash as createHash2, randomUUID as randomUUID4 } from "node:crypto";
import { lstat as lstat8, mkdir as mkdir3, readFile as readFile6, readdir as readdir3, rename as rename2, rmdir as rmdir2, rm, unlink as unlink2, writeFile as writeFile4 } from "node:fs/promises";
import { basename as basename4, dirname as dirname2, join as join7, relative as relative4, resolve as resolve3 } from "node:path";
function assertTaskMutable(location) {
  if (location.scope === "archive" || location.task.status === "finished" || location.task.status === "archived") {
    throw new ValidationError(`Task is terminal and cannot be mutated: ${location.task.id}`);
  }
}
async function createTaskArtifacts(paths, task, creationEvent) {
  const directory = join7(paths.activeTasks, task.id);
  const archivedDirectory = join7(paths.archivedTasks, task.id);
  await Promise.all([
    assertNoSymlink(paths.repoRoot, directory),
    assertNoSymlink(paths.repoRoot, archivedDirectory)
  ]);
  if (await pathExists(archivedDirectory)) {
    throw new ValidationError(`Task path already exists for generated ID ${task.id}.`);
  }
  try {
    await mkdir3(directory);
  } catch (error) {
    if (isCode2(error, "EEXIST")) {
      throw new ValidationError(`Task path already exists for generated ID ${task.id}.`);
    }
    throw new SchemaError(`Unable to create task directory ${directory}`, error);
  }
  let archivedCollisionAfterCreate;
  try {
    archivedCollisionAfterCreate = await pathExists(archivedDirectory);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw new SchemaError(`Unable to verify archived task collision for ${task.id}`, error);
  }
  if (archivedCollisionAfterCreate) {
    await rm(directory, { recursive: true, force: true });
    throw new ValidationError(`Task path already exists for generated ID ${task.id}.`);
  }
  const writes = await Promise.allSettled([
    writeFile4(join7(directory, "task.json"), `${JSON.stringify(task, null, 2)}
`, { encoding: "utf8", flag: "wx" }),
    ...ARTIFACTS.filter((artifact) => artifact !== "journal.md").map(
      (artifact) => writeFile4(join7(directory, artifact), "", { encoding: "utf8", flag: "wx" })
    ),
    writeFile4(join7(directory, "journal.md"), `${JSON.stringify(creationEvent)}
`, { encoding: "utf8", flag: "wx" })
  ]);
  const failed = writes.find((result) => result.status === "rejected");
  if (failed) {
    await rm(directory, { recursive: true, force: true });
    throw new SchemaError(`Unable to create task artifacts for ${task.id}`, failed.reason);
  }
  return { task, directory, scope: "active" };
}
async function findTask(paths, taskId) {
  if (!TASK_ID_PATTERN2.test(taskId)) throw new ValidationError(`Invalid task ID: ${taskId}`);
  const matches = (await Promise.all([
    findInScope(paths, paths.activeTasks, "active", taskId),
    findInScope(paths, paths.archivedTasks, "archive", taskId)
  ])).flat();
  if (matches.length === 0) throw new ValidationError(`Task not found: ${taskId}`);
  if (matches.length > 1) throw new AmbiguousTaskError(`Task ID is present in multiple locations: ${taskId}`);
  return matches[0];
}
async function listStoredTasks(paths, status) {
  const scopes = [[paths.activeTasks, "active"]];
  if (status === "all") scopes.push([paths.archivedTasks, "archive"]);
  const tasks = (await Promise.all(scopes.map(([directory, scope]) => listScope(paths, directory, scope)))).flat();
  return tasks.sort((left, right) => left.task.id.localeCompare(right.task.id));
}
async function persistTaskTransition(paths, location, task, transition, operationOverrides = {}) {
  return withTaskLock(paths, task.id, () => persistTaskTransitionLocked(paths, location, task, transition, operationOverrides));
}
async function persistTaskTransitionLocked(paths, location, task, transition, operationOverrides) {
  const operations = { ...DEFAULT_TRANSITION_OPERATIONS, ...operationOverrides };
  const journalPath = join7(location.directory, "journal.md");
  const shouldMoveToArchive = task.status === "archived" && location.scope === "active";
  const destination = shouldMoveToArchive ? join7(paths.archivedTasks, task.id) : void 0;
  await assertNoSymlink(paths.repoRoot, journalPath);
  if (destination !== void 0) await assertNoSymlink(paths.repoRoot, destination);
  await assertNoPendingTaskMutation(paths, location);
  const pending = await readPendingTransitionIntent(paths, journalPath, location.task.status);
  let intent;
  if (pending !== null) {
    if (pending.oldStatus !== transition.oldStatus || pending.newStatus !== transition.newStatus) {
      throw new SchemaError(
        `Task ${task.id} has a pending ${pending.oldStatus} -> ${pending.newStatus} transition; retry that transition before starting another.`
      );
    }
    intent = pending;
  } else {
    intent = {
      ...transition,
      type: "transition_intent",
      operationId: operations.createOperationId()
    };
    await operations.appendJournal(journalPath, intent, paths.repoRoot);
  }
  let targetDirectory = location.directory;
  let targetScope = location.scope;
  if (destination !== void 0) {
    try {
      await operations.moveDirectory(location.directory, destination);
    } catch (error) {
      throw new SchemaError(`Unable to archive task ${task.id}; transition intent remains pending for retry`, error);
    }
    targetDirectory = destination;
    targetScope = "archive";
  }
  const committedTask = pending === null ? task : { ...task, updatedAt: intent.timestamp };
  try {
    await operations.writeTask(join7(targetDirectory, "task.json"), committedTask, paths.repoRoot);
  } catch (error) {
    throw new SchemaError(`Unable to commit task transition for ${task.id}; transition intent remains pending for retry`, error);
  }
  return { task: committedTask, directory: targetDirectory, scope: targetScope };
}
async function executeTaskMutation(paths, location, request, prepare, operationOverrides = {}) {
  return withTaskLock(paths, location.task.id, () => executeTaskMutationLocked(
    paths,
    location,
    request,
    prepare,
    { ...DEFAULT_TRANSITION_OPERATIONS, ...operationOverrides }
  ));
}
async function executeTaskMutationLocked(paths, location, request, prepare, operations) {
  await assertNoPendingTaskTransition(paths, location);
  const journalPath = join7(location.directory, "journal.md");
  const pending = await readPendingTaskMutationIntent(paths, journalPath);
  if (pending !== null) {
    if (pending.mutationKind !== request.mutationKind || pending.fingerprint !== request.fingerprint) {
      throw new TransitionError(
        `Task ${location.task.id} has a pending ${pending.mutationKind} mutation; retry that exact mutation before recording another task change.`
      );
    }
    if (!mutationTargetsAreOwned(paths, mutationTargetOwner(location), pending.mutationKind, pending.expected)) {
      throw new SchemaError(`Pending mutation ${pending.operationId} has targets outside its exact managed ownership.`);
    }
    if (await mutationTargetsMatch(paths, location, pending.mutationKind, pending.expected)) {
      await appendMutationCompletion(paths, journalPath, pending, operations);
      return pending;
    }
    const prepared2 = await prepare(pending.timestamp, true, pending);
    if (stableJson2(prepared2.expected) !== stableJson2(pending.expected) || !matchesCompletionForRetry(prepared2.completion, pending.completion)) {
      throw new SchemaError(`Pending mutation ${pending.operationId} no longer matches the requested target; inspect it before retrying.`);
    }
    await prepared2.apply();
    if (!await mutationTargetsMatch(paths, location, pending.mutationKind, pending.expected)) {
      throw new SchemaError(`Mutation ${pending.operationId} did not produce its expected managed targets; journal intent remains pending.`);
    }
    await appendMutationCompletion(paths, journalPath, pending, operations);
    return pending;
  }
  await assertTaskMutationStructure(paths, location);
  const prepared = await prepare(request.timestamp, false, null);
  if (!mutationTargetsAreOwned(paths, mutationTargetOwner(location), request.mutationKind, prepared.expected)) {
    throw new SchemaError(`Prepared ${request.mutationKind} mutation has targets outside its exact managed ownership.`);
  }
  const intent = {
    schemaVersion: SCHEMA_VERSION,
    type: "mutation_intent",
    operationId: operations.createOperationId(),
    timestamp: request.timestamp,
    actor: request.actor,
    mutationKind: request.mutationKind,
    fingerprint: request.fingerprint,
    expected: prepared.expected,
    completion: prepared.completion
  };
  await operations.appendJournal(journalPath, intent, paths.repoRoot);
  await prepared.apply();
  if (!await mutationTargetsMatch(paths, location, intent.mutationKind, intent.expected)) {
    throw new SchemaError(`Mutation ${intent.operationId} did not produce its expected managed targets; journal intent remains pending.`);
  }
  await appendMutationCompletion(paths, journalPath, intent, operations);
  return intent;
}
function mutationFingerprint(value) {
  return createHash2("sha256").update(stableJson2(value)).digest("hex");
}
function mutationTargetSummary(paths, targets, identity) {
  return {
    identity,
    files: targets.map(({ filename, contents }) => ({
      path: relative4(paths.repoRoot, filename).split("\\").join("/"),
      sha256: createHash2("sha256").update(contents).digest("hex")
    })).sort((left, right) => left.path.localeCompare(right.path))
  };
}
async function readPendingTaskMutationIntent(paths, journalPath) {
  const records = await readJsonlRecords(paths.repoRoot, journalPath);
  let pending = null;
  for (const record of records) {
    if (!isRecord6(record) || typeof record.type !== "string") continue;
    if (record.type === "mutation_intent") {
      if (!isMutationIntent(record)) throw new SchemaError(`Invalid mutation intent in ${journalPath}`);
      if (pending !== null) {
        throw new SchemaError(`Task journal ${journalPath} has more than one uncommitted mutation intent.`);
      }
      pending = record;
      continue;
    }
    if (pending !== null && record.operationId === pending.operationId) {
      if (!matchesCompletion(recordWithoutOperationId(record), pending.completion)) {
        throw new SchemaError(`Mutation completion ${pending.operationId} does not match its journal intent.`);
      }
      pending = null;
    }
  }
  return pending;
}
async function mutationTargetsMatch(paths, location, mutationKind, expected) {
  if (!mutationTargetsAreOwned(paths, mutationTargetOwner(location), mutationKind, expected)) return false;
  for (const target of expected.files) {
    const filename = assertInside(paths.repoRoot, resolve3(paths.repoRoot, target.path));
    try {
      await assertNoSymlink(paths.repoRoot, filename);
      const contents = await readFile6(filename);
      if (createHash2("sha256").update(contents).digest("hex") !== target.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}
function mutationTargetsAreOwned(paths, owner, mutationKind, expected) {
  const taskDirectory = relative4(paths.repoRoot, owner.directory).split("\\").join("/");
  const expectedDirectory = `.vinea/tasks/${owner.scope}/${owner.taskId}`;
  if (taskDirectory !== expectedDirectory || !TASK_ID_PATTERN2.test(owner.taskId)) return false;
  const currentTargets = mutationTargetPaths(taskDirectory, owner, mutationKind, expected.identity);
  if (currentTargets === null) return false;
  if (sameMutationTargetSet(expected.files.map(({ path }) => path), currentTargets)) return true;
  if (owner.scope !== "archive") return false;
  const historicDirectory = `.vinea/tasks/active/${owner.taskId}`;
  return sameMutationTargetSet(
    expected.files.map(({ path }) => path),
    mutationTargetPaths(historicDirectory, owner, mutationKind, expected.identity)
  );
}
function mutationTargetOwner(location) {
  const domains = {};
  for (const candidate of location.task.learningCandidates ?? []) {
    if (typeof candidate.id === "string" && typeof candidate.domain === "string") {
      domains[candidate.id] = candidate.domain;
    }
  }
  return {
    directory: location.directory,
    scope: location.scope,
    taskId: location.task.id,
    learningCandidateDomains: domains
  };
}
function mutationTargetPaths(taskDirectory, owner, mutationKind, identity) {
  const taskArtifact = (artifact) => [`${taskDirectory}/${artifact}`];
  if (mutationKind === "brief_set") return taskArtifact("brief.md");
  if (mutationKind === "plan_set") return taskArtifact("plan.md");
  if (mutationKind === "context_added") return taskArtifact("context.jsonl");
  if (mutationKind === "evidence_recorded") return taskArtifact("evidence.jsonl");
  if (mutationKind === "check_upsert") return taskArtifact("check.md");
  if (mutationKind === "requirement_added" || mutationKind === "acceptance_criterion_added" || mutationKind === "learning_proposed" || mutationKind === "learning_archived") {
    return taskArtifact("task.json");
  }
  if (mutationKind !== "learning_accepted") return null;
  const candidateId = identity.learningCandidateId;
  if (candidateId === void 0) return null;
  const domain = owner.learningCandidateDomains[candidateId];
  if (domain === void 0 || !LEARNING_DOMAIN_PATTERN.test(domain) || domain === "index") return null;
  return [
    `${taskDirectory}/task.json`,
    ".vinea/specs/index.md",
    `.vinea/specs/${domain}.md`
  ];
}
function sameMutationTargetSet(actual, expected) {
  return actual.length === expected.length && new Set(actual).size === actual.length && new Set(expected).size === expected.length && actual.every((path) => expected.includes(path));
}
function isPotentialMutationTarget(paths, location, target) {
  const taskDirectory = relative4(paths.repoRoot, location.directory).split("\\").join("/");
  const artifact = target.startsWith(`${taskDirectory}/`) ? target.slice(taskDirectory.length + 1) : "";
  return ["task.json", "brief.md", "plan.md", "context.jsonl", "evidence.jsonl", "check.md"].includes(artifact) || target === ".vinea/specs/index.md" || /^\.vinea\/specs\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.test(target);
}
async function writeManagedMutationTarget(paths, location, filename, contents) {
  const target = relative4(paths.repoRoot, filename).split("\\").join("/");
  if (!isPotentialMutationTarget(paths, location, target)) {
    throw new ValidationError(`Mutation target is not managed for task ${location.task.id}: ${target}`);
  }
  await assertNoSymlink(paths.repoRoot, filename);
  const temporary = join7(dirname2(filename), `.${basename4(filename)}.${randomUUID4()}.tmp`);
  try {
    await writeFile4(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename2(temporary, filename);
  } catch (error) {
    try {
      await unlink2(temporary);
    } catch (cleanupError) {
      if (!isCode2(cleanupError, "ENOENT")) {
        throw new SchemaError(`Unable to clean temporary mutation target ${temporary}`, cleanupError);
      }
    }
    throw new SchemaError(`Unable to write managed mutation target ${filename}`, error);
  }
}
async function appendMutationCompletion(paths, journalPath, intent, operations) {
  await operations.appendJournal(journalPath, { ...intent.completion, operationId: intent.operationId }, paths.repoRoot);
}
function mutationValueIdentity(identity, value) {
  if (value === void 0) return identity;
  return {
    ...identity,
    valueSha256: createHash2("sha256").update(stableJson2(value)).digest("hex")
  };
}
function isMutationIntent(value) {
  return value.schemaVersion === SCHEMA_VERSION && value.type === "mutation_intent" && typeof value.operationId === "string" && value.operationId !== "" && typeof value.timestamp === "string" && typeof value.actor === "string" && typeof value.mutationKind === "string" && typeof value.fingerprint === "string" && /^[a-f0-9]{64}$/u.test(value.fingerprint) && isMutationTargetSummary2(value.expected) && isRecord6(value.completion);
}
function isMutationTargetSummary2(value) {
  return isRecord6(value) && isRecord6(value.identity) && Object.values(value.identity).every((entry) => typeof entry === "string" && entry !== "") && Array.isArray(value.files) && value.files.length > 0 && value.files.every((entry) => isRecord6(entry) && typeof entry.path === "string" && typeof entry.sha256 === "string" && /^[a-f0-9]{64}$/u.test(entry.sha256));
}
function matchesCompletion(left, right) {
  return stableJson2(left) === stableJson2(right);
}
function matchesCompletionForRetry(prepared, pending) {
  if (matchesCompletion(prepared, pending)) return true;
  if ("mutationProtocolVersion" in pending && pending.mutationProtocolVersion !== void 0) return false;
  const current = { ...prepared };
  delete current.mutationProtocolVersion;
  return matchesCompletion(current, pending);
}
async function assertTaskMutationStructure(paths, location) {
  const { validateTaskStructure: validateTaskStructure2 } = await Promise.resolve().then(() => (init_validate(), validate_exports));
  const report = await validateTaskStructure2(paths, location);
  if (report.issues.length === 0) return;
  const issue = report.issues[0];
  throw new SchemaError(
    `Task ${location.task.id} mutation is blocked by ${issue.code} at ${issue.path}: ${issue.message}. Run \`vinea validate\` to inspect all task-structure issues.`
  );
}
function recordWithoutOperationId(value) {
  const result = { ...value };
  delete result.operationId;
  return result;
}
function stableJson2(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson2).join(",")}]`;
  if (isRecord6(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson2(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
async function assertNoPendingTaskTransition(paths, location) {
  const pending = await readPendingTransitionIntent(
    paths,
    join7(location.directory, "journal.md"),
    location.task.status
  );
  if (pending !== null) {
    throw new TransitionError(
      `Task ${location.task.id} has a pending ${pending.oldStatus} -> ${pending.newStatus} transition; retry that transition before recording task changes.`
    );
  }
}
async function hasMatchingPendingTaskTransition(paths, location, oldStatus, newStatus) {
  const pending = await readPendingTransitionIntent(
    paths,
    join7(location.directory, "journal.md"),
    location.task.status
  );
  return pending?.oldStatus === oldStatus && pending.newStatus === newStatus;
}
async function assertNoPendingTaskMutation(paths, location) {
  const pending = await readPendingTaskMutationIntent(paths, join7(location.directory, "journal.md"));
  if (pending !== null) {
    throw new TransitionError(
      `Task ${location.task.id} has a pending ${pending.mutationKind} mutation; retry that exact mutation before recording another task change.`
    );
  }
}
async function appendTaskContinuation(paths, location, event) {
  return withTaskLock(paths, location.task.id, () => appendTaskContinuationLocked(paths, location, event));
}
async function appendTaskContinuationLocked(paths, location, event) {
  await assertNoPendingTaskTransition(paths, location);
  await assertNoPendingTaskMutation(paths, location);
  const journalPath = join7(location.directory, "journal.md");
  await assertNoSymlink(paths.repoRoot, journalPath);
  await appendJsonl(journalPath, event, paths.repoRoot);
}
function sessionBindingPath(paths, host, sessionId) {
  const safeSessionId = safeSessionFilenamePart(sessionId);
  return join7(paths.sessions, `${host}-${safeSessionId}.json`);
}
async function readSessionBinding(paths, host, sessionId) {
  const filename = sessionBindingPath(paths, host, sessionId);
  try {
    await assertNoSymlink(paths.repoRoot, filename);
    const contents = await readFile6(filename, "utf8");
    let value;
    try {
      value = JSON.parse(contents);
    } catch {
      return { status: "malformed", message: `Invalid JSON in session binding ${filename}` };
    }
    if (!isSessionBinding(value)) {
      return { status: "malformed", message: `Invalid session binding in ${filename}` };
    }
    return { status: "valid", binding: value };
  } catch (error) {
    if (isCode2(error, "ENOENT")) return { status: "missing" };
    if (error instanceof ValidationError) throw error;
    if (error instanceof SchemaError) {
      return { status: "malformed", message: error.message };
    }
    return {
      status: "malformed",
      message: `Unable to read session binding ${filename}`
    };
  }
}
async function writeSessionBinding(paths, host, sessionId, binding) {
  const filename = sessionBindingPath(paths, host, sessionId);
  await ensureDirectory(paths.repoRoot, paths.sessions);
  await writeJsonAtomic(filename, binding, paths.repoRoot);
}
async function readLatestEvidence(paths, location) {
  const filename = join7(location.directory, "evidence.jsonl");
  const records = await readJsonlRecords(paths.repoRoot, filename);
  if (records.length === 0) return null;
  const evidence = records.map((record, index) => {
    if (!isEvidenceRecord(record)) {
      throw new SchemaError(`Invalid evidence record in ${filename} at line ${index + 1}`);
    }
    return record;
  });
  return evidence.at(-1);
}
async function readLatestCheckEvent(paths, location) {
  const filename = join7(location.directory, "journal.md");
  const events = await readJsonlRecords(paths.repoRoot, filename);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!isRecord6(event) || typeof event.type !== "string") continue;
    if (event.type === "check_recorded" || event.type === "check_updated") return event;
  }
  return null;
}
async function removeTaskSessionBindings(paths, taskId) {
  await assertNoSymlink(paths.repoRoot, paths.sessions);
  let entries;
  try {
    entries = await readdir3(paths.sessions, { withFileTypes: true });
  } catch (error) {
    if (isCode2(error, "ENOENT")) return [];
    throw new SchemaError(`Unable to list session bindings in ${paths.sessions}`, error);
  }
  const removed = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const filename = join7(paths.sessions, entry.name);
    await assertNoSymlink(paths.repoRoot, filename);
    let value;
    try {
      value = JSON.parse(await readFile6(filename, "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw new SchemaError(`Unable to inspect session binding ${filename}`, error);
    }
    if (!isSessionBinding(value) || value.taskId !== taskId) continue;
    try {
      await unlink2(filename);
      removed.push(filename);
    } catch (error) {
      if (!isCode2(error, "ENOENT")) {
        throw new SchemaError(`Unable to remove session binding ${filename}`, error);
      }
    }
  }
  return removed;
}
async function findInScope(paths, root, scope, taskId) {
  const direct = join7(root, taskId);
  if (!await isDirectory2(direct)) return [];
  return [await loadLocation(paths, direct, scope, false)];
}
async function listScope(paths, root, scope) {
  await assertNoSymlink(paths.repoRoot, root);
  let entries;
  try {
    entries = await readdir3(root, { withFileTypes: true });
  } catch (error) {
    throw new SchemaError(`Unable to list task directory ${root}`, error);
  }
  return Promise.all(
    entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => loadLocation(paths, join7(root, entry.name), scope, true))
  );
}
async function loadLocation(paths, directory, scope, strict) {
  const task = await readJson(join7(directory, "task.json"), paths.repoRoot);
  if (!isTaskRecordBaseShape(task) || strict && !isTaskRecordShape2(task) || task.id !== basename4(directory)) {
    throw new SchemaError(`Invalid task record in ${directory}`);
  }
  return { task, directory, scope };
}
async function isDirectory2(path) {
  try {
    const entry = await lstat8(path);
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch (error) {
    if (isCode2(error, "ENOENT")) return false;
    throw error;
  }
}
async function pathExists(path) {
  try {
    await lstat8(path);
    return true;
  } catch (error) {
    if (isCode2(error, "ENOENT")) return false;
    throw error;
  }
}
async function withTaskLock(paths, taskId, operation) {
  if (!TASK_ID_PATTERN2.test(taskId)) throw new ValidationError(`Invalid task ID: ${taskId}`);
  const key = `${paths.repoRoot}\0${taskId}`;
  const inherited = taskLockContext.getStore();
  if (inherited?.has(key)) return operation();
  const lock = await acquireTaskLock(paths, taskId);
  const context = new Set(inherited ?? []);
  context.add(key);
  try {
    return await taskLockContext.run(context, operation);
  } finally {
    await releaseTaskLock(paths, lock);
  }
}
async function acquireTaskLock(paths, taskId) {
  const locks = join7(paths.runtime, "task-locks");
  const directory = join7(locks, `${taskId}.lock`);
  const ownerPath = join7(directory, "owner.json");
  const token = randomUUID4();
  const deadline = Date.now() + TASK_LOCK_TIMEOUT_MILLISECONDS;
  await ensureDirectory(paths.repoRoot, locks);
  for (; ; ) {
    await assertNoSymlink(paths.repoRoot, directory);
    try {
      await mkdir3(directory);
    } catch (error) {
      if (!isCode2(error, "EEXIST")) {
        throw new SchemaError(`Unable to acquire task lock for ${taskId}`, error);
      }
      if (Date.now() >= deadline) {
        throw new ValidationError(
          `Task ${taskId} is busy in another Vinea process; wait for it to finish and retry. Vinea will not remove a lock it does not own.`
        );
      }
      await delay2(TASK_LOCK_RETRY_MILLISECONDS);
      continue;
    }
    try {
      await writeFile4(ownerPath, `${JSON.stringify({ token, pid: process.pid, acquiredAt: (/* @__PURE__ */ new Date()).toISOString() })}
`, {
        encoding: "utf8",
        flag: "wx"
      });
    } catch (error) {
      try {
        await rmdir2(directory);
      } catch (cleanupError) {
        if (!isCode2(cleanupError, "ENOENT")) {
          throw new SchemaError(`Unable to initialize task lock for ${taskId}; empty lock cleanup failed`, {
            error,
            cleanupError
          });
        }
      }
      throw new SchemaError(`Unable to initialize task lock for ${taskId}`, error);
    }
    return { directory, ownerPath, token };
  }
}
async function releaseTaskLock(paths, lock) {
  await assertNoSymlink(paths.repoRoot, lock.ownerPath);
  let owner;
  try {
    owner = JSON.parse(await readFile6(lock.ownerPath, "utf8"));
  } catch (error) {
    throw new SchemaError(`Unable to verify task lock ownership at ${lock.directory}`, error);
  }
  if (!isRecord6(owner) || owner.token !== lock.token) {
    throw new SchemaError(`Task lock ownership changed at ${lock.directory}; refusing unsafe cleanup.`);
  }
  await removeOwnedTaskLock(lock.directory, lock.ownerPath, lock.token);
}
async function removeOwnedTaskLock(directory, ownerPath, token) {
  try {
    const owner = JSON.parse(await readFile6(ownerPath, "utf8"));
    if (!isRecord6(owner) || owner.token !== token) return;
    await unlink2(ownerPath);
    await rmdir2(directory);
  } catch (error) {
    if (isCode2(error, "ENOENT")) return;
    throw new SchemaError(`Unable to release owned task lock ${directory}`, error);
  }
}
async function delay2(milliseconds) {
  await new Promise((resolve8) => setTimeout(resolve8, milliseconds));
}
function isCode2(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function safeSessionFilenamePart(sessionId) {
  if (sessionId.trim() === "") {
    throw new ValidationError("Session ID must not be empty.");
  }
  if (sessionId.includes("/") || sessionId.includes("\\") || sessionId.includes("\0")) {
    throw new ValidationError("Session ID must not contain path separators or NUL bytes.");
  }
  if (sessionId === "." || sessionId === "..") {
    throw new ValidationError("Session ID must not contain path traversal.");
  }
  if (!isWellFormedUnicode(sessionId)) {
    throw new ValidationError("Session ID must contain well-formed Unicode.");
  }
  if (Buffer.byteLength(sessionId, "utf8") > 119) {
    throw new ValidationError("Session ID exceeds the 119-byte local binding limit.");
  }
  return `sid-${Buffer.from(sessionId, "utf8").toString("hex")}`;
}
function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 55296 && codeUnit <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 56320 && next <= 57343)) return false;
      index += 1;
    } else if (codeUnit >= 56320 && codeUnit <= 57343) {
      return false;
    }
  }
  return true;
}
function isSessionBinding(value) {
  if (!isRecord6(value)) return false;
  if (Object.keys(value).some((key) => !["schemaVersion", "taskId", "boundAt"].includes(key))) return false;
  return value.schemaVersion === SCHEMA_VERSION && typeof value.taskId === "string" && TASK_ID_PATTERN2.test(value.taskId) && isIsoTimestamp3(value.boundAt);
}
function isEvidenceRecord(value) {
  if (!isRecord6(value)) return false;
  return value.schemaVersion === SCHEMA_VERSION && typeof value.id === "string" && value.id.trim() !== "" && ["command", "manual", "tdd-red", "tdd-green"].includes(String(value.kind)) && typeof value.summary === "string" && value.summary.trim() !== "" && ["pass", "fail"].includes(String(value.result)) && isIsoTimestamp3(value.recordedAt) && typeof value.actor === "string" && value.actor.trim() !== "";
}
function isTaskRecordShape2(value) {
  if (!isTaskRecordBaseShape(value)) return false;
  return value.requirements.every(isRequirement2) && value.acceptanceCriteria.every(isRequirement2) && isLearningCandidateCollection(value.learningCandidates) && isCommitMetadata2(value.commit);
}
function isTaskRecordBaseShape(value) {
  if (!isRecord6(value)) return false;
  const risk = value.risk;
  return value.schemaVersion === SCHEMA_VERSION && typeof value.id === "string" && TASK_ID_PATTERN2.test(value.id) && typeof value.title === "string" && value.title.trim() !== "" && ["planning", "ready", "in_progress", "checking", "finished", "archived", "blocked"].includes(
    String(value.status)
  ) && isRecord6(risk) && ["low", "medium", "high"].includes(String(risk.level)) && Array.isArray(risk.reasons) && risk.reasons.every((reason) => typeof reason === "string") && ["standard", "tdd"].includes(String(value.qualityMode)) && ["single-agent", "delegated"].includes(String(value.executionMode)) && Array.isArray(value.requirements) && Array.isArray(value.acceptanceCriteria) && isIsoTimestamp3(value.createdAt) && isIsoTimestamp3(value.updatedAt);
}
function isRequirement2(value) {
  if (!isRecord6(value)) return false;
  if (Object.keys(value).some((key) => !["schemaVersion", "id", "text", "createdAt"].includes(key))) {
    return false;
  }
  return value.schemaVersion === SCHEMA_VERSION && typeof value.id === "string" && value.id.trim() !== "" && typeof value.text === "string" && value.text.trim() !== "" && isIsoTimestamp3(value.createdAt);
}
function isLearningCandidateCollection(value) {
  if (value === void 0) return true;
  if (!Array.isArray(value)) return false;
  const ids = /* @__PURE__ */ new Set();
  for (const candidate of value) {
    if (!isRecord6(candidate) || candidate.schemaVersion !== SCHEMA_VERSION || typeof candidate.id !== "string" || candidate.id.trim() === "" || ids.has(candidate.id) || typeof candidate.domain !== "string" || candidate.domain.trim() === "" || typeof candidate.text !== "string" || candidate.text.trim() === "" || typeof candidate.rationale !== "string" || candidate.rationale.trim() === "" || !isIsoTimestamp3(candidate.proposedAt)) {
      return false;
    }
    ids.add(candidate.id);
    if (candidate.status === "proposed") continue;
    if (candidate.status === "accepted" && candidate.confirmedBy === "user" && isIsoTimestamp3(candidate.acceptedAt)) {
      continue;
    }
    if (candidate.status === "archived" && typeof candidate.archiveReason === "string" && candidate.archiveReason.trim() !== "" && isIsoTimestamp3(candidate.archivedAt)) {
      continue;
    }
    return false;
  }
  return true;
}
function isCommitMetadata2(value) {
  if (value === null) return true;
  if (!isRecord6(value)) return false;
  if (Object.keys(value).some((key) => !["sha", "message"].includes(key))) return false;
  return typeof value.sha === "string" && value.sha.trim() !== "" && (value.message === void 0 || typeof value.message === "string");
}
async function readPendingTransitionIntent(paths, filename, taskStatus) {
  const records = await readJsonlRecords(paths.repoRoot, filename);
  const candidate = records.at(-1);
  if (!isTransitionIntent(candidate) || candidate.oldStatus !== taskStatus) return null;
  return candidate;
}
function isTransitionIntent(value) {
  return isRecord6(value) && value.schemaVersion === SCHEMA_VERSION && value.type === "transition_intent" && typeof value.operationId === "string" && typeof value.timestamp === "string" && typeof value.actor === "string" && typeof value.reason === "string" && isTaskStatus2(value.oldStatus) && isTaskStatus2(value.newStatus);
}
function isTaskStatus2(value) {
  return value === "planning" || value === "ready" || value === "in_progress" || value === "checking" || value === "finished" || value === "archived" || value === "blocked";
}
async function readJsonlRecords(repoRoot, filename) {
  await assertNoSymlink(repoRoot, filename);
  let contents;
  try {
    contents = await readFile6(filename, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read JSONL file ${filename}`, error);
  }
  return contents.split("\n").filter((line) => line !== "").map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new SchemaError(`Invalid JSONL in ${filename} at line ${index + 1}`, error);
    }
  });
}
function isIsoTimestamp3(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}
function isRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var ARTIFACTS, TASK_ID_PATTERN2, LEARNING_DOMAIN_PATTERN, TASK_LOCK_RETRY_MILLISECONDS, TASK_LOCK_TIMEOUT_MILLISECONDS, taskLockContext, DEFAULT_TRANSITION_OPERATIONS;
var init_task_store = __esm({
  "src/core/task-store.ts"() {
    "use strict";
    init_errors();
    init_json();
    init_paths();
    init_types();
    ARTIFACTS = [
      "brief.md",
      "plan.md",
      "context.jsonl",
      "evidence.jsonl",
      "check.md",
      "journal.md"
    ];
    TASK_ID_PATTERN2 = /^t-\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
    LEARNING_DOMAIN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    TASK_LOCK_RETRY_MILLISECONDS = 25;
    TASK_LOCK_TIMEOUT_MILLISECONDS = 5e3;
    taskLockContext = new AsyncLocalStorage();
    DEFAULT_TRANSITION_OPERATIONS = {
      createOperationId: randomUUID4,
      appendJournal: appendJsonl,
      moveDirectory: rename2,
      writeTask: writeJsonAtomic
    };
  }
});

// src/core/check.ts
import { readFile as readFile7 } from "node:fs/promises";
import { isAbsolute as isAbsolute3, join as join8, relative as relative5, resolve as resolve4 } from "node:path";
async function upsertCheck(paths, taskId, input, now = () => /* @__PURE__ */ new Date()) {
  return withTaskLock(paths, taskId, () => upsertCheckLocked(paths, taskId, input, now));
}
async function upsertCheckLocked(paths, taskId, input, now) {
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
  const requirementId = boundedNonempty3(input.requirementId, "Requirement ID", MAX_ID_BYTES);
  const declaredIds = declaredRequirementIds(location);
  if (!declaredIds.includes(requirementId)) {
    throw new ValidationError(`Requirement or acceptance ID is not declared for ${taskId}: ${requirementId}`);
  }
  const evidenceIds = uniqueStrings(
    input.evidenceIds.map((id) => boundedNonempty3(id, "Evidence ID", MAX_ID_BYTES))
  );
  const knownEvidenceIds = new Set(evidence.map(({ id }) => id));
  const missingEvidence = evidenceIds.find((id) => !knownEvidenceIds.has(id));
  if (missingEvidence !== void 0) {
    throw new ValidationError(`Evidence ID is not present for ${taskId}: ${missingEvidence}`);
  }
  const result = validateResult2(input.result);
  if (result === "pass" && evidenceIds.length === 0) {
    throw new ValidationError("A passing check row requires at least one evidence ID.");
  }
  const planItem = boundedNonempty3(input.planItem, "Check plan item", MAX_TEXT_BYTES);
  const checkedPaths = uniqueStrings(
    input.paths.map((path) => normalizeRepositoryPath2(paths.repoRoot, path))
  );
  if (checkedPaths.length === 0) {
    throw new ValidationError("Check paths must contain at least one repository-relative path.");
  }
  const summary = boundedNonempty3(input.summary, "Check summary", MAX_TEXT_BYTES);
  const actor = boundedNonempty3(input.actor, "Check actor", MAX_ID_BYTES);
  const request = {
    schemaVersion: SCHEMA_VERSION,
    actor,
    requirementId,
    planItem,
    paths: checkedPaths,
    evidenceIds,
    result,
    summary
  };
  await executeTaskMutation(paths, location, {
    mutationKind: "check_upsert",
    actor,
    timestamp: now().toISOString(),
    fingerprint: mutationFingerprint(request)
  }, async (timestamp, recovering, pending) => {
    const current = await findTask(paths, taskId);
    if (current.scope === "archive" || current.task.status === "archived" || current.task.status === "finished") {
      throw new ValidationError(`Task check rows cannot be edited: ${taskId}`);
    }
    const currentEvidence = await readEvidence(paths, current);
    const currentDeclaredIds = declaredRequirementIds(current);
    if (!currentDeclaredIds.includes(requirementId)) {
      throw new ValidationError(`Requirement or acceptance ID is not declared for ${taskId}: ${requirementId}`);
    }
    const currentEvidenceIds = new Set(currentEvidence.map(({ id }) => id));
    const missingEvidence2 = evidenceIds.find((id) => !currentEvidenceIds.has(id));
    if (missingEvidence2 !== void 0) {
      throw new ValidationError(`Evidence ID is not present for ${taskId}: ${missingEvidence2}`);
    }
    const row = {
      schemaVersion: SCHEMA_VERSION,
      requirementId,
      planItem,
      paths: checkedPaths,
      evidenceIds,
      result,
      summary,
      checkedAt: timestamp
    };
    const existing = await readRows(paths, current, currentEvidence);
    const eventType = existing.some((candidate) => candidate.requirementId === requirementId) ? "check_updated" : "check_recorded";
    if (recovering && pending?.completion.type !== eventType) {
      throw new SchemaError(`Pending check mutation for ${requirementId} no longer has the expected operation type.`);
    }
    const byId = new Map(existing.map((candidate) => [candidate.requirementId, candidate]));
    byId.set(requirementId, row);
    const rows = currentDeclaredIds.flatMap((id) => {
      const candidate = byId.get(id);
      return candidate === void 0 ? [] : [candidate];
    });
    const contents = renderCheckDocument(rows);
    return {
      expected: mutationTargetSummary(paths, [{
        filename: join8(current.directory, "check.md"),
        contents
      }], mutationValueIdentity({ requirementId }, row)),
      completion: {
        schemaVersion: SCHEMA_VERSION,
        type: eventType,
        mutationKind: eventType,
        mutationProtocolVersion: 1,
        timestamp,
        actor,
        requirementId,
        result
      },
      apply: () => writeManagedMutationTarget(paths, current, join8(current.directory, "check.md"), contents)
    };
  });
  return showCheck(paths, taskId);
}
async function showCheck(paths, taskId) {
  await readConfig(paths);
  const location = await findTask(paths, taskId);
  const evidence = await readEvidence(paths, location);
  return summarize(taskId, await readRows(paths, location, evidence));
}
async function readCheckForLocation(paths, location) {
  const evidence = await readEvidence(paths, location);
  const rows = await readRows(paths, location, evidence);
  return { summary: summarize(location.task.id, rows), evidence };
}
function summarize(taskId, rows) {
  return {
    taskId,
    rows,
    totals: {
      total: rows.length,
      pass: rows.filter(({ result }) => result === "pass").length,
      fail: rows.filter(({ result }) => result === "fail").length,
      uncovered: rows.filter(({ result }) => result === "uncovered").length
    }
  };
}
async function readRows(paths, location, evidence) {
  const filename = join8(location.directory, "check.md");
  await assertNoSymlink(paths.repoRoot, filename);
  let contents;
  try {
    contents = await readFile7(filename, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read check matrix ${filename}`, error);
  }
  return parseCheckDocument(contents, paths.repoRoot, declaredRequirementIds(location), evidence, filename);
}
function parseCheckDocument(contents, repoRoot, declaredIds, evidence, filename) {
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
  let value;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch (error) {
    throw new SchemaError(`Invalid authoritative check payload in ${filename}`, error);
  }
  if (!isRecord7(value) || Object.keys(value).some((key) => key !== "schemaVersion" && key !== "rows") || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.rows)) {
    throw new SchemaError(`Invalid authoritative check payload in ${filename}`);
  }
  const evidenceIds = new Set(evidence.map(({ id }) => id));
  const seen = /* @__PURE__ */ new Set();
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
    if (missingEvidence !== void 0) {
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
function validateStoredRow(value, repoRoot, filename, rowNumber) {
  if (!isRecord7(value)) throw new SchemaError(`Invalid check row ${rowNumber} in ${filename}`);
  const fields = [
    "schemaVersion",
    "requirementId",
    "planItem",
    "paths",
    "evidenceIds",
    "result",
    "summary",
    "checkedAt"
  ];
  if (Object.keys(value).some((key) => !fields.includes(key)) || value.schemaVersion !== SCHEMA_VERSION || typeof value.requirementId !== "string" || typeof value.planItem !== "string" || !Array.isArray(value.paths) || !value.paths.every((path) => typeof path === "string") || !Array.isArray(value.evidenceIds) || !value.evidenceIds.every((id) => typeof id === "string") || typeof value.summary !== "string" || typeof value.checkedAt !== "string") {
    throw new SchemaError(`Invalid check row ${rowNumber} in ${filename}`);
  }
  if (value.requirementId.trim() === "" || Buffer.byteLength(value.requirementId.trim(), "utf8") > MAX_ID_BYTES || value.planItem.trim() === "" || Buffer.byteLength(value.planItem.trim(), "utf8") > MAX_TEXT_BYTES || value.summary.trim() === "" || Buffer.byteLength(value.summary.trim(), "utf8") > MAX_TEXT_BYTES || value.paths.length === 0) {
    throw new SchemaError(`Invalid check row fields at row ${rowNumber} in ${filename}`);
  }
  const checkedAt = new Date(value.checkedAt);
  if (Number.isNaN(checkedAt.valueOf()) || checkedAt.toISOString() !== value.checkedAt) {
    throw new SchemaError(`Invalid check row timestamp at row ${rowNumber} in ${filename}`);
  }
  let result;
  try {
    result = validateResult2(value.result);
  } catch (error) {
    throw new SchemaError(`Invalid check row result at row ${rowNumber} in ${filename}`, error);
  }
  const storedPaths = value.paths;
  const storedEvidenceIds = value.evidenceIds;
  if (new Set(storedPaths).size !== storedPaths.length || new Set(storedEvidenceIds).size !== storedEvidenceIds.length || storedEvidenceIds.some(
    (id) => id.trim() === "" || Buffer.byteLength(id.trim(), "utf8") > MAX_ID_BYTES
  )) {
    throw new SchemaError(`Invalid duplicate or empty check values at row ${rowNumber} in ${filename}`);
  }
  let normalizedPaths;
  try {
    normalizedPaths = storedPaths.map((path) => normalizeRepositoryPath2(repoRoot, path));
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
    checkedAt: value.checkedAt
  };
}
async function readEvidence(paths, location) {
  const filename = join8(location.directory, "evidence.jsonl");
  await assertNoSymlink(paths.repoRoot, filename);
  let contents;
  try {
    contents = await readFile7(filename, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read evidence records ${filename}`, error);
  }
  const seen = /* @__PURE__ */ new Set();
  return contents.split("\n").filter(Boolean).map((line, index) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new SchemaError(`Invalid evidence JSONL in ${filename} at line ${index + 1}`, error);
    }
    if (!isEvidenceRecord2(value) || seen.has(value.id)) {
      throw new SchemaError(`Invalid evidence record in ${filename} at line ${index + 1}`);
    }
    seen.add(value.id);
    return value;
  });
}
function isEvidenceRecord2(value) {
  if (!isRecord7(value)) return false;
  const fields = [
    "schemaVersion",
    "id",
    "kind",
    "summary",
    "result",
    "recordedAt",
    "command",
    "exitCode",
    "actor"
  ];
  if (Object.keys(value).some((key) => !fields.includes(key))) return false;
  const timestamp = typeof value.recordedAt === "string" ? new Date(value.recordedAt) : null;
  const exitCodeValid = value.exitCode === void 0 || typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode) && value.exitCode >= 0;
  if (!exitCodeValid) return false;
  if (value.result === "pass" && value.exitCode !== void 0 && value.exitCode !== 0) return false;
  if (value.result === "fail" && value.exitCode === 0) return false;
  if (value.kind === "tdd-red" && (value.result !== "fail" || typeof value.exitCode !== "number" || value.exitCode === 0)) {
    return false;
  }
  if (value.kind === "tdd-green" && (value.result !== "pass" || value.exitCode !== 0)) return false;
  return value.schemaVersion === SCHEMA_VERSION && typeof value.id === "string" && value.id.trim() !== "" && ["command", "manual", "tdd-red", "tdd-green"].includes(String(value.kind)) && typeof value.summary === "string" && value.summary.trim() !== "" && ["pass", "fail"].includes(String(value.result)) && timestamp !== null && !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value.recordedAt && typeof value.actor === "string" && value.actor.trim() !== "" && (value.command === void 0 || typeof value.command === "string" && value.command.trim() !== "");
}
function renderCheckDocument(rows) {
  const payload = { schemaVersion: SCHEMA_VERSION, rows };
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
      row.summary
    ].map(escapeTableCell).join(" | ")).map((line) => `| ${line} |`),
    ""
  ];
  return lines.join("\n");
}
function escapeTableCell(value) {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}
function declaredRequirementIds(location) {
  return [...location.task.requirements, ...location.task.acceptanceCriteria].map(({ id }) => id);
}
function normalizeRepositoryPath2(repoRoot, path) {
  const trimmed = boundedNonempty3(path, "Check path", MAX_TEXT_BYTES);
  if (trimmed.includes("\0") || trimmed.includes("\\") || isAbsolute3(trimmed) || /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith("//")) {
    throw new ValidationError(`Check path must be repository-relative: ${path}`);
  }
  const resolved = assertInside(repoRoot, resolve4(repoRoot, trimmed));
  const normalized = relative5(repoRoot, resolved).split("\\").join("/");
  if (normalized === "" || normalized === "." || normalized !== trimmed) {
    throw new ValidationError(`Check path must identify a repository file or directory: ${path}`);
  }
  return normalized;
}
function boundedNonempty3(value, label, maxBytes) {
  const normalized = value.trim();
  if (normalized === "") throw new ValidationError(`${label} must not be empty.`);
  if (Buffer.byteLength(normalized, "utf8") > maxBytes) {
    throw new ValidationError(`${label} exceeds the ${maxBytes}-byte audit metadata limit.`);
  }
  return normalized;
}
function uniqueStrings(values) {
  return [...new Set(values)];
}
function validateResult2(value) {
  if (value !== "pass" && value !== "fail" && value !== "uncovered") {
    throw new ValidationError("Check result must be pass, fail, or uncovered.");
  }
  return value;
}
function isRecord7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var CHECK_PREFIX, CHECK_SUFFIX, MAX_TEXT_BYTES, MAX_ID_BYTES;
var init_check = __esm({
  "src/core/check.ts"() {
    "use strict";
    init_config();
    init_errors();
    init_paths();
    init_task_store();
    init_types();
    CHECK_PREFIX = "<!-- vinea-checks:v1:";
    CHECK_SUFFIX = " -->";
    MAX_TEXT_BYTES = 4e3;
    MAX_ID_BYTES = 200;
  }
});

// package.json
var package_default = {
  name: "vinea",
  version: "0.1.0",
  private: true,
  type: "module",
  engines: {
    node: ">=18.18"
  },
  scripts: {
    build: "node scripts/build.mjs",
    typecheck: "tsc --noEmit",
    test: "vitest run",
    "package:plugin": "node scripts/package-public-plugin.mjs",
    "check:plugin": "node scripts/check-public-plugin.mjs",
    check: "npm run typecheck && npm test && npm run package:plugin && npm run check:plugin",
    "test:e2e:manual": "node dist/vinea.mjs --help"
  },
  devDependencies: {
    "@types/node": "^18.19.76",
    esbuild: "^0.25.2",
    typescript: "^5.8.3",
    vitest: "^2.1.9"
  }
};

// src/cli/args.ts
var UsageError = class extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
    this.name = "UsageError";
  }
  exitCode = 2;
  code = "VINEA_VALIDATION_INVALID";
};
function parseOptions(args, valueOptions, booleanOptions) {
  const parsed = /* @__PURE__ */ new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (parsed.has(argument)) throw new UsageError(`Duplicate option: ${argument}`);
    if (booleanOptions.has(argument)) {
      parsed.set(argument, true);
      continue;
    }
    if (!valueOptions.has(argument)) throw new UsageError(`Unknown option: ${argument}`);
    const value = args[index + 1];
    if (value === void 0 || value.startsWith("--")) {
      throw new UsageError(`Missing value for ${argument}.`);
    }
    parsed.set(argument, value);
    index += 1;
  }
  return parsed;
}
function requiredOption(options, name) {
  const value = options.get(name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new UsageError(`Missing required option: ${name}.`);
  }
  return value;
}
function optionalValue(options, name) {
  const value = options.get(name);
  return typeof value === "string" ? value : void 0;
}
function requiredTaskId(value) {
  if (value === void 0 || value.startsWith("--") || value.trim() === "") {
    throw new UsageError("Missing task ID.");
  }
  return value;
}
function oneOf(value, allowed, option) {
  if (!allowed.includes(value)) {
    throw new UsageError(`Invalid ${option} value: ${value}. Expected ${allowed.join("|")}.`);
  }
  return value;
}
function parseExitCode(value) {
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`Invalid --exit-code value: ${value}. Expected a non-negative integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new UsageError(`Invalid --exit-code value: ${value}. Expected a non-negative integer.`);
  }
  return parsed;
}
function commaList(value, option) {
  const values = value.split(",").map((item) => item.trim());
  if (values.some((item) => item === "")) {
    throw new UsageError(`${option} must be a comma-separated list of nonempty values.`);
  }
  return values;
}
function requestsJson(args) {
  return args.includes("--json");
}

// src/cli/render.ts
init_errors();

// src/core/workflow.ts
init_config();
init_check();
import { execFile as execFile2 } from "node:child_process";
import { lstat as lstat10, readFile as readFile9 } from "node:fs/promises";
import { isAbsolute as isAbsolute5, join as join9, resolve as resolve7 } from "node:path";
import { promisify as promisify2 } from "node:util";

// src/core/context.ts
init_config();
init_errors();
init_paths();
init_task_store();
init_types();
import { lstat as lstat9, readFile as readFile8, realpath } from "node:fs/promises";
import {
  isAbsolute as isAbsolute4,
  relative as relative6,
  resolve as resolve5
} from "node:path";
async function addContextReference(paths, taskId, input, now = () => /* @__PURE__ */ new Date()) {
  return withTaskLock(paths, taskId, () => addContextReferenceLocked(paths, taskId, input, now));
}
async function addContextReferenceLocked(paths, taskId, input, now) {
  const config = await readConfig(paths);
  assertNonempty(input.purpose, "Context purpose");
  assertBoundedNonempty(input.actor, "Context actor", 200);
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  const normalizedPath = normalizeRepositoryPath3(input.path);
  if (Buffer.byteLength(normalizedPath, "utf8") > 4096) {
    throw new ValidationError("Context path exceeds the 4096-byte audit metadata limit.");
  }
  const estimatedBytes = await inspectContextFile(paths.repoRoot, normalizedPath);
  const purpose = input.purpose.trim();
  const actor = input.actor.trim();
  const filename = resolve5(location.directory, "context.jsonl");
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
      estimatedBytes
    })
  }, async (timestamp, recovering) => {
    const current = await findTask(paths, taskId);
    assertTaskMutable(current);
    const currentFilename = resolve5(current.directory, "context.jsonl");
    const references = await readContextReferences(paths.repoRoot, currentFilename);
    if (references.some((reference3) => reference3.path === normalizedPath)) {
      if (recovering) {
        throw new SchemaError(`Pending context mutation already contains ${normalizedPath}, but its managed target does not match.`);
      }
      throw new ValidationError(`Context path is already registered for task ${taskId}: ${normalizedPath}`);
    }
    const nextFiles = references.length + 1;
    const nextEstimatedBytes = references.reduce(
      (total, reference3) => total + reference3.estimatedBytes,
      estimatedBytes
    );
    if (!recovering && nextFiles > config.context.maxFiles) {
      throw new ValidationError(
        `Context file budget exceeded for task ${taskId}: ${nextFiles} > ${config.context.maxFiles}`
      );
    }
    if (!recovering && nextEstimatedBytes > config.context.maxEstimatedBytes) {
      throw new ValidationError(
        `Context byte budget exceeded for task ${taskId}: ${nextEstimatedBytes} > ${config.context.maxEstimatedBytes}`
      );
    }
    const reference2 = {
      schemaVersion: SCHEMA_VERSION,
      path: normalizedPath,
      purpose,
      estimatedBytes,
      addedAt: timestamp
    };
    const contents = renderContextReferences([...references, reference2]);
    return {
      expected: mutationTargetSummary(paths, [{ filename: currentFilename, contents }], mutationValueIdentity({ path: normalizedPath }, reference2)),
      completion: {
        schemaVersion: SCHEMA_VERSION,
        type: "context_added",
        mutationKind: "context_added",
        mutationProtocolVersion: 1,
        timestamp,
        actor,
        path: normalizedPath
      },
      apply: () => writeManagedMutationTarget(paths, current, currentFilename, contents)
    };
  });
  const reference = (await readContextReferences(paths.repoRoot, filename)).find(
    (candidate) => candidate.path === intent.expected.identity.path
  );
  if (reference === void 0) throw new SchemaError(`Recovered context mutation did not record ${normalizedPath}.`);
  return reference;
}
async function listContextReferences(paths, taskId) {
  const config = await readConfig(paths);
  const location = await findTask(paths, taskId);
  const references = await readContextReferences(paths.repoRoot, resolve5(location.directory, "context.jsonl"));
  return {
    references,
    totals: {
      files: references.length,
      estimatedBytes: references.reduce((total, reference) => total + reference.estimatedBytes, 0)
    },
    limits: { ...config.context }
  };
}
function normalizeRepositoryPath3(input) {
  const value = input.trim();
  if (value === "") throw new ValidationError("Context path must not be empty.");
  if (isAbsolute4(value) || /^[a-zA-Z]:[/\\]/.test(value) || value.startsWith("\\")) {
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
async function inspectContextFile(repoRoot, repositoryPath) {
  const candidate = assertInside(repoRoot, resolve5(repoRoot, repositoryPath));
  const segments = repositoryPath.split("/");
  let current = repoRoot;
  try {
    for (const segment of segments) {
      current = resolve5(current, segment);
      const entry2 = await lstat9(current);
      if (entry2.isSymbolicLink()) {
        throw new ValidationError(`Context path must not contain symbolic links: ${repositoryPath}`);
      }
    }
    const entry = await lstat9(candidate);
    if (!entry.isFile()) {
      throw new ValidationError(`Context path must reference a regular file: ${repositoryPath}`);
    }
    const [realRoot, realCandidate] = await Promise.all([realpath(repoRoot), realpath(candidate)]);
    const difference = relative6(realRoot, realCandidate);
    if (isAbsolute4(difference) || difference === ".." || difference.startsWith("../")) {
      throw new ValidationError(`Context path resolves outside the repository: ${repositoryPath}`);
    }
    return entry.size;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (isMissing5(error)) {
      throw new ValidationError(`Context path does not exist: ${repositoryPath}`, error);
    }
    throw new ValidationError(`Unable to inspect context path: ${repositoryPath}`, error);
  }
}
async function readContextReferences(repoRoot, filename) {
  await assertNoSymlink(repoRoot, filename);
  let contents;
  try {
    contents = await readFile8(filename, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to read context manifest ${filename}`, error);
  }
  return contents.split("\n").filter((line) => line !== "").map((line, index) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new SchemaError(`Invalid JSONL in ${filename} at line ${index + 1}`, error);
    }
    if (!isContextReference(value)) {
      throw new SchemaError(`Invalid context record in ${filename} at line ${index + 1}`);
    }
    return value;
  });
}
function isContextReference(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return record.schemaVersion === SCHEMA_VERSION && typeof record.path === "string" && typeof record.purpose === "string" && typeof record.estimatedBytes === "number" && Number.isSafeInteger(record.estimatedBytes) && record.estimatedBytes >= 0 && typeof record.addedAt === "string";
}
function renderContextReferences(references) {
  return references.map((reference) => JSON.stringify(reference)).join("\n") + "\n";
}
function assertNonempty(value, label) {
  if (value.trim() === "") throw new ValidationError(`${label} must not be empty.`);
}
function assertBoundedNonempty(value, label, maxBytes) {
  assertNonempty(value, label);
  if (Buffer.byteLength(value.trim(), "utf8") > maxBytes) {
    throw new ValidationError(`${label} exceeds the ${maxBytes}-byte audit metadata limit.`);
  }
}
function isMissing5(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// src/core/workflow.ts
init_errors();
init_evidence();

// src/core/git.ts
import { execFile } from "node:child_process";
import { resolve as resolve6 } from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
async function inspectBusinessGitStatus(repoRoot) {
  let porcelain;
  try {
    const topLevel = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    if (resolve6(topLevel.stdout.trim()) !== resolve6(repoRoot)) {
      return {
        gitUnavailable: true,
        businessDirtyPaths: [],
        error: "Vinea repository root is nested below a different Git worktree root."
      };
    }
    const result = await execFileAsync("git", ["status", "--porcelain=v1", "-z"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    porcelain = result.stdout;
  } catch (error) {
    return {
      gitUnavailable: true,
      businessDirtyPaths: [],
      error: error instanceof Error ? error.message : "Unable to run git status --porcelain=v1 -z."
    };
  }
  return {
    gitUnavailable: false,
    businessDirtyPaths: parsePorcelainPaths(porcelain).filter((path) => !isVineaPath(path)),
    error: null
  };
}
function parsePorcelainPaths(porcelain) {
  const records = porcelain.split("\0");
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === "") continue;
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Malformed git status --porcelain=v1 -z output.");
    }
    const status = record.slice(0, 2);
    paths.push(record.slice(3));
    if (status.includes("R") || status.includes("C")) {
      const originalPath = records[index + 1];
      if (originalPath === void 0 || originalPath === "") {
        throw new Error("Malformed renamed path in git status --porcelain=v1 -z output.");
      }
      paths.push(originalPath);
      index += 1;
    }
  }
  return [...new Set(paths)];
}
function isVineaPath(path) {
  return path === ".vinea" || path.startsWith(".vinea/");
}

// src/core/workflow.ts
init_task_store();
init_paths();
init_schema();
init_validate();
init_types();
init_json();
var execFileAsync2 = promisify2(execFile2);
var DEFAULT_ARCHIVE_OPERATIONS = { removeTaskSessionBindings };
var FORWARD_TRANSITIONS2 = {
  planning: "ready",
  ready: "in_progress",
  in_progress: "checking",
  checking: "finished",
  finished: "archived"
};
var BLOCKABLE = /* @__PURE__ */ new Set(["planning", "ready", "in_progress", "checking"]);
var UNBLOCK_TARGETS2 = /* @__PURE__ */ new Set(["ready", "in_progress", "checking"]);
function suggestRisk(title, description, changedPaths = [], rules = DEFAULT_CONFIG.riskRules) {
  const searchable = normalize([title, description, ...changedPaths].join(" "));
  const matchedHigh = matchedRules(searchable, rules.high);
  const matchedMedium = matchedRules(searchable, rules.medium);
  const reasons = [...matchedHigh, ...matchedMedium.filter((reason) => !matchedHigh.includes(reason))];
  return {
    level: matchedHigh.length > 0 ? "high" : matchedMedium.length > 0 ? "medium" : "low",
    reasons
  };
}
async function createTask(paths, input, now = () => /* @__PURE__ */ new Date()) {
  await readConfig(paths);
  assertNonempty2(input.title, "Task title");
  const timestamp = now().toISOString();
  const slug = slugify(input.title);
  const id = `t-${formatTaskTimestamp(new Date(timestamp))}-${slug}`;
  const task = {
    schemaVersion: SCHEMA_VERSION,
    id,
    title: input.title.trim(),
    status: "planning",
    risk: { level: input.risk.level, reasons: [...input.risk.reasons] },
    qualityMode: input.qualityMode,
    executionMode: input.executionMode,
    requirements: [],
    acceptanceCriteria: [],
    commit: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const event = {
    schemaVersion: SCHEMA_VERSION,
    type: "created",
    timestamp,
    actor: "cli",
    confirmation: input.confirmation,
    status: "planning"
  };
  const created = await createTaskArtifacts(paths, task, event);
  return { task: created.task, directory: created.directory };
}
async function appendInlineAudit(paths, input, now = () => /* @__PURE__ */ new Date()) {
  await readConfig(paths);
  assertNonempty2(input.title, "Request title");
  assertNonempty2(input.description, "Request description");
  assertNonempty2(input.reason, "Inline skip reason");
  const record = {
    schemaVersion: SCHEMA_VERSION,
    timestamp: now().toISOString(),
    requestSummary: `${input.title.trim()}: ${input.description.trim()}`,
    proposedRisk: input.proposedRisk,
    reason: input.reason.trim()
  };
  await appendJsonl(join9(paths.vineaRoot, "inline-audit.jsonl"), record, paths.repoRoot);
  return record;
}
async function readTask(paths, taskId) {
  await readConfig(paths);
  return (await findTask(paths, taskId)).task;
}
async function listTasks(paths, status) {
  await readConfig(paths);
  return (await listStoredTasks(paths, status)).map(({ task }) => task);
}
async function orientWorkspace(paths, input) {
  assertHost(input.host);
  if (input.sessionId !== void 0) {
    sessionBindingPath(paths, input.host, input.sessionId);
  }
  const [health, gitStatus] = await Promise.all([
    inspectWorkspace(paths),
    inspectGitStatus(paths.repoRoot)
  ]);
  if (health.initialized && health.supportedSchema && health.missingRequiredDirectories.includes("tasks/active")) {
    throw new SchemaError(
      "Active task storage tasks/active is missing, malformed, or unsafe; run `vinea doctor` for workspace diagnostics."
    );
  }
  const canInspectTasks = health.initialized && health.supportedSchema;
  const locations = canInspectTasks ? await listStoredTasks(paths, "active") : [];
  const candidates = await Promise.all(locations.map(async (location) => {
    const [context, latestEvidence, latestCheckEvent, check] = await Promise.all([
      listContextReferences(paths, location.task.id),
      readLatestEvidence(paths, location),
      readLatestCheckEvent(paths, location),
      readCheckForLocation(paths, location)
    ]);
    return {
      id: location.task.id,
      title: location.task.title,
      status: location.task.status,
      qualityMode: location.task.qualityMode,
      executionMode: location.task.executionMode,
      requirementsNotCovered: incompleteRequirements(location.task, check.summary.rows),
      contextReferences: context.references,
      latestEvidence,
      latestCheckEvent
    };
  }));
  let binding = null;
  let hasValidBinding = false;
  if (input.sessionId !== void 0) {
    const stored = await readSessionBinding(paths, input.host, input.sessionId);
    if (stored.status === "valid") {
      hasValidBinding = candidates.some(({ id }) => id === stored.binding.taskId);
      binding = {
        status: hasValidBinding ? "bound" : "stale",
        taskId: stored.binding.taskId,
        boundAt: stored.binding.boundAt
      };
    } else if (stored.status === "malformed") {
      binding = { status: "malformed", message: stored.message };
    }
  }
  const recommendation = hasValidBinding ? "resume-bound" : candidates.length === 0 ? "no-active-task" : candidates.length === 1 ? "confirm-single" : "choose-task";
  return { health, gitStatus, binding, candidates, recommendation };
}
async function continueTask(paths, taskId, input) {
  return withTaskLock(paths, taskId, () => continueTaskLocked(paths, taskId, input));
}
async function continueTaskLocked(paths, taskId, input) {
  assertHost(input.host);
  if (input.sessionId !== void 0) {
    sessionBindingPath(paths, input.host, input.sessionId);
  }
  if (!input.confirmed) {
    throw new ValidationError("Continuation requires explicit --confirmed.");
  }
  if (input.start === true) {
    assertNonempty2(input.reason ?? "", "Continuation start reason");
  } else if (input.reason !== void 0) {
    throw new ValidationError("--reason requires --start.");
  }
  await readConfig(paths);
  let location = await findTask(paths, taskId);
  if (location.scope === "archive" || location.task.status === "archived") {
    throw new ValidationError(`Task is archived and cannot be continued: ${taskId}`);
  }
  if (location.task.status === "finished") {
    throw new ValidationError(`Task is finished and cannot be continued: ${taskId}`);
  }
  if (input.start === true && location.task.status !== "ready") {
    throw new ValidationError(
      `Only a ready task can be started during continuation; ${taskId} is ${location.task.status}.`
    );
  }
  await assertTaskLifecycleStructure(paths, location);
  const timestamp = (input.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  let task = location.task;
  if (input.start === true) {
    task = await transitionTask(paths, taskId, "in_progress", {
      actor: input.host,
      reason: input.reason,
      now: () => new Date(timestamp)
    });
    location = await findTask(paths, taskId);
  }
  const event = {
    schemaVersion: SCHEMA_VERSION,
    type: "continued",
    timestamp,
    actor: input.host,
    confirmation: "user",
    host: input.host,
    sessionBound: input.sessionId !== void 0,
    started: input.start === true,
    status: task.status
  };
  await appendTaskContinuation(paths, location, event);
  let binding = null;
  if (input.sessionId !== void 0) {
    binding = {
      schemaVersion: SCHEMA_VERSION,
      taskId,
      boundAt: timestamp
    };
    await writeSessionBinding(paths, input.host, input.sessionId, binding);
  }
  return { task, binding };
}
async function transitionTask(paths, taskId, newStatus, options) {
  return withTaskLock(paths, taskId, () => transitionTaskLocked(paths, taskId, newStatus, options));
}
async function transitionTaskLocked(paths, taskId, newStatus, options) {
  await readConfig(paths);
  assertNonempty2(options.actor, "Transition actor");
  assertNonempty2(options.reason, "Transition reason");
  const location = await findTask(paths, taskId);
  const oldStatus = location.task.status;
  const matchingPendingRetry = await hasMatchingPendingTaskTransition(paths, location, oldStatus, newStatus);
  assertTransitionAllowed(oldStatus, newStatus, options.unblock === true);
  if (newStatus === "ready") await assertReadyPrerequisites(paths, location);
  if (newStatus === "checking") await assertTddReadyForCheck(paths, location);
  await assertTaskLifecycleStructure(paths, location, matchingPendingRetry);
  const timestamp = (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  const task = { ...location.task, status: newStatus, updatedAt: timestamp };
  const transition = {
    schemaVersion: SCHEMA_VERSION,
    timestamp,
    actor: options.actor.trim(),
    reason: options.reason.trim(),
    oldStatus,
    newStatus
  };
  return (await persistTaskTransition(paths, location, task, transition)).task;
}
async function finishTask(paths, taskId, input) {
  return withTaskLock(paths, taskId, () => finishTaskLocked(paths, taskId, input));
}
async function finishTaskLocked(paths, taskId, input) {
  if (!input.confirmed) throw new ValidationError("Finish requires explicit --confirmed.");
  await readConfig(paths);
  assertBoundedNonempty2(input.actor, "Finish actor", 200);
  const location = await findTask(paths, taskId);
  if (location.scope !== "active" || location.task.status !== "checking") {
    throw new FinishGateError(
      `Finish requires task ${taskId} to be active with status checking; found ${location.task.status}.`
    );
  }
  await assertTaskLifecycleStructure(paths, location);
  const { summary, evidence } = await readCheckForLocation(paths, location);
  const declaredIds = [
    ...location.task.requirements.map(({ id }) => id),
    ...location.task.acceptanceCriteria.map(({ id }) => id)
  ];
  const coveredIds = new Set(summary.rows.map(({ requirementId }) => requirementId));
  const missing = declaredIds.filter((id) => !coveredIds.has(id));
  if (missing.length > 0) {
    throw new FinishGateError(`Finish coverage is missing declared requirement or acceptance IDs: ${missing.join(", ")}.`);
  }
  const unsuccessful = summary.rows.filter(({ result }) => result !== "pass");
  if (unsuccessful.length > 0) {
    throw new FinishGateError(
      `Finish is blocked by failed or uncovered check rows: ${unsuccessful.map(({ requirementId }) => requirementId).join(", ")}.`
    );
  }
  const evidenceById = new Map(evidence.map((record) => [record.id, record]));
  const withoutPassingEvidence = summary.rows.filter(
    (row) => !row.evidenceIds.some((id) => evidenceById.get(id)?.result === "pass")
  );
  if (withoutPassingEvidence.length > 0) {
    throw new FinishGateError(
      `Finish is blocked by check rows without passing evidence: ${withoutPassingEvidence.map(({ requirementId }) => requirementId).join(", ")}.`
    );
  }
  try {
    await assertTddReadyForCheck(paths, location);
  } catch (error) {
    throw new FinishGateError(
      `Finish TDD evidence is invalid; a valid tdd-red must precede tdd-green for ${taskId}.`
    );
  }
  assertLearningCandidatesClassified(location.task);
  const gitStatus = await inspectBusinessGitStatus(paths.repoRoot);
  if (gitStatus.gitUnavailable) {
    throw new FinishGateError(
      `Finish gitUnavailable: ${gitStatus.error ?? "Git status could not be inspected."}`
    );
  }
  if (gitStatus.businessDirtyPaths.length > 0) {
    throw new FinishGateError(
      `Finish is blocked by business dirty paths: ${gitStatus.businessDirtyPaths.join(", ")}.`
    );
  }
  return transitionTask(paths, taskId, "finished", {
    actor: input.actor,
    reason: "Completion gates satisfied.",
    now: input.now
  });
}
async function archiveTask(paths, taskId, input, operationOverrides = {}) {
  return withTaskLock(paths, taskId, () => archiveTaskLocked(paths, taskId, input, operationOverrides));
}
async function archiveTaskLocked(paths, taskId, input, operationOverrides) {
  if (!input.confirmed) throw new ValidationError("Archive requires explicit --confirmed.");
  await readConfig(paths);
  assertBoundedNonempty2(input.actor, "Archive actor", 200);
  const location = await findTask(paths, taskId);
  if (location.task.status !== "finished") {
    throw new TransitionError(
      `Archive requires task ${taskId} to have status finished; found ${location.task.status}.`
    );
  }
  await assertTaskLifecycleStructure(
    paths,
    location,
    await hasMatchingPendingTaskTransition(paths, location, "finished", "archived")
  );
  const operations = { ...DEFAULT_ARCHIVE_OPERATIONS, ...operationOverrides };
  await operations.removeTaskSessionBindings(paths, taskId);
  return transitionTask(paths, taskId, "archived", {
    actor: input.actor,
    reason: "Task archived after confirmed finish.",
    now: input.now
  });
}
async function addRequirement(paths, taskId, input, now = () => /* @__PURE__ */ new Date()) {
  return withTaskLock(paths, taskId, () => addRequirementLike(paths, taskId, input, "requirements", "requirement_added", now));
}
async function addAcceptanceCriterion(paths, taskId, input, now = () => /* @__PURE__ */ new Date()) {
  return withTaskLock(paths, taskId, () => addRequirementLike(
    paths,
    taskId,
    input,
    "acceptanceCriteria",
    "acceptance_criterion_added",
    now
  ));
}
async function setTaskBrief(paths, taskId, sourceFile, actor = "cli", now = () => /* @__PURE__ */ new Date()) {
  return setTaskDocument(paths, taskId, sourceFile, "brief.md", actor, now);
}
async function setTaskPlan(paths, taskId, sourceFile, actor = "cli", now = () => /* @__PURE__ */ new Date()) {
  return setTaskDocument(paths, taskId, sourceFile, "plan.md", actor, now);
}
function nextGate(task) {
  if (task.status === "blocked") return "unblock to ready, in_progress, or checking";
  if (task.status === "archived") return "none";
  return FORWARD_TRANSITIONS2[task.status] ?? "none";
}
function incompleteRequirements(task, rows = []) {
  const passingIds = new Set(rows.filter((row) => row.result === "pass").map((row) => row.requirementId));
  return [...task.requirements, ...task.acceptanceCriteria].map((requirement) => requirement.id).filter((id) => !passingIds.has(id));
}
function assertTransitionAllowed(oldStatus, newStatus, unblock) {
  if (oldStatus === "blocked") {
    if (unblock && UNBLOCK_TARGETS2.has(newStatus)) return;
    throw new TransitionError(`Blocked task requires explicit unblock to ready, in_progress, or checking.`);
  }
  if (unblock) throw new TransitionError(`Only blocked tasks can be unblocked.`);
  if (BLOCKABLE.has(oldStatus) && newStatus === "blocked") return;
  if (FORWARD_TRANSITIONS2[oldStatus] === newStatus) return;
  throw new TransitionError(`Cannot transition task from ${oldStatus} to ${newStatus}.`);
}
async function addRequirementLike(paths, taskId, input, collection, eventType, now) {
  await readConfig(paths);
  assertBoundedNonempty2(input.id, "Requirement ID", 200);
  assertNonempty2(input.text, "Requirement text");
  assertBoundedNonempty2(input.actor, "Requirement actor", 200);
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  const id = input.id.trim();
  const text = input.text.trim();
  const actor = input.actor.trim();
  await executeTaskMutation(paths, location, {
    mutationKind: eventType,
    actor,
    timestamp: now().toISOString(),
    fingerprint: mutationFingerprint({
      schemaVersion: SCHEMA_VERSION,
      type: eventType,
      actor,
      requirementId: id,
      text
    })
  }, async (timestamp, recovering) => {
    const current = await findTask(paths, taskId);
    assertTaskMutable(current);
    const allRequirements = [...current.task.requirements, ...current.task.acceptanceCriteria];
    if (allRequirements.some((requirement2) => requirement2.id === id)) {
      if (recovering) {
        throw new SchemaError(`Pending ${eventType} mutation already has requirement ${id}, but task.json does not match its recorded target.`);
      }
      throw new ValidationError(`Requirement ID already exists in task ${taskId}: ${id}`);
    }
    const requirement = {
      schemaVersion: SCHEMA_VERSION,
      id,
      text,
      createdAt: timestamp
    };
    const task = {
      ...current.task,
      [collection]: [...current.task[collection], requirement],
      updatedAt: timestamp
    };
    return {
      expected: mutationTargetSummary(paths, [{
        filename: join9(current.directory, "task.json"),
        contents: `${JSON.stringify(task, null, 2)}
`
      }], mutationValueIdentity({ requirementId: id }, requirement)),
      completion: {
        schemaVersion: SCHEMA_VERSION,
        type: eventType,
        mutationKind: eventType,
        mutationProtocolVersion: 1,
        timestamp,
        actor,
        requirementId: id
      },
      apply: () => writeJsonAtomic(join9(current.directory, "task.json"), task, paths.repoRoot)
    };
  });
  return (await findTask(paths, taskId)).task;
}
async function setTaskDocument(paths, taskId, sourceFile, artifact, actor, now) {
  return withTaskLock(paths, taskId, () => setTaskDocumentLocked(paths, taskId, sourceFile, artifact, actor, now));
}
async function setTaskDocumentLocked(paths, taskId, sourceFile, artifact, actor, now) {
  await readConfig(paths);
  assertNonempty2(sourceFile, "Source file");
  assertBoundedNonempty2(actor, "Task document actor", 200);
  const location = await findTask(paths, taskId);
  assertTaskMutable(location);
  const { bytes } = await readTaskDocumentSource(paths, sourceFile);
  let contents;
  try {
    contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ValidationError(`Task document source must contain valid UTF-8: ${sourceFile}`, error);
  }
  if (contents.trim() === "") {
    throw new ValidationError(`Task document source must not be empty: ${sourceFile}`);
  }
  const type = artifact === "brief.md" ? "brief_set" : "plan_set";
  const normalizedActor = actor.trim();
  await executeTaskMutation(paths, location, {
    mutationKind: type,
    actor: normalizedActor,
    timestamp: now().toISOString(),
    fingerprint: mutationFingerprint({
      schemaVersion: SCHEMA_VERSION,
      type,
      actor: normalizedActor,
      artifact,
      contentsSha256: mutationFingerprint(contents)
    })
  }, async (timestamp) => ({
    expected: mutationTargetSummary(paths, [{
      filename: join9(location.directory, artifact),
      contents
    }], { artifact, valueSha256: mutationFingerprint(contents) }),
    completion: {
      schemaVersion: SCHEMA_VERSION,
      type,
      mutationKind: type,
      mutationProtocolVersion: 1,
      timestamp,
      actor: normalizedActor,
      artifact
    },
    apply: () => writeManagedMutationTarget(paths, location, join9(location.directory, artifact), contents)
  }));
  return { taskId, artifact, estimatedBytes: bytes.byteLength };
}
async function assertTaskLifecycleStructure(paths, location, matchingPendingTransition = false) {
  const report = await validateTaskStructure(paths, location);
  const issues = matchingPendingTransition ? report.issues.filter(({ code }) => code !== "TASK_STATE_SCOPE_INVALID") : report.issues;
  if (issues.length === 0) return;
  const issue = issues[0];
  throw new SchemaError(
    `Task ${location.task.id} lifecycle is blocked by ${issue.code} at ${issue.path}: ${issue.message}. Run \`vinea validate\` to inspect all task-structure issues.`
  );
}
async function readTaskDocumentSource(paths, sourceFile) {
  const source = sourceFile.trim();
  if (isAbsolute5(source) || /^\\/u.test(source) || /^[a-z]:[\\/]/iu.test(source) || source.includes("\0")) {
    throw new ValidationError(`Task document source must be repository-relative: ${sourceFile}`);
  }
  const segments = source.split(/[\\/]/u);
  if (segments.includes("..")) {
    throw new ValidationError(`Task document source must not contain parent traversal: ${sourceFile}`);
  }
  const relativeSource = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (relativeSource === "") {
    throw new ValidationError(`Task document source must name a repository-relative file: ${sourceFile}`);
  }
  let filename;
  try {
    filename = assertInside(paths.repoRoot, resolve7(paths.repoRoot, relativeSource));
    await assertNoSymlink(paths.repoRoot, filename);
  } catch (error) {
    throw new ValidationError(`Task document source must not contain symbolic links: ${sourceFile}`, error);
  }
  let entry;
  try {
    entry = await lstat10(filename);
  } catch (error) {
    throw new ValidationError(`Unable to inspect task document source ${sourceFile}`, error);
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new ValidationError(`Task document source must be a regular non-symlink file: ${sourceFile}`);
  }
  try {
    return { bytes: await readFile9(filename) };
  } catch (error) {
    throw new ValidationError(`Unable to read task document source ${sourceFile}`, error);
  }
}
async function assertReadyPrerequisites(paths, location) {
  const briefPath = join9(location.directory, "brief.md");
  const planPath = join9(location.directory, "plan.md");
  await Promise.all([
    assertNoSymlink(paths.repoRoot, briefPath),
    assertNoSymlink(paths.repoRoot, planPath)
  ]);
  const [brief, plan] = await Promise.all([
    readFile9(briefPath, "utf8"),
    readFile9(planPath, "utf8")
  ]);
  const missing = [];
  if (brief.trim() === "") missing.push("brief.md");
  if (plan.trim() === "") missing.push("plan.md");
  const requirements = Array.isArray(location.task.requirements) ? location.task.requirements : [];
  const acceptanceCriteria = Array.isArray(location.task.acceptanceCriteria) ? location.task.acceptanceCriteria : [];
  if (![...requirements, ...acceptanceCriteria].some(isStructurallyValidRequirement)) {
    missing.push("valid requirement or acceptance criterion");
  }
  if (missing.length > 0) {
    throw new TransitionError(`Task is not ready; missing ${missing.join(", ")}.`);
  }
}
function isStructurallyValidRequirement(value) {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value;
  if (candidate.schemaVersion !== SCHEMA_VERSION) return false;
  if (typeof candidate.id !== "string" || candidate.id.trim() === "") return false;
  if (typeof candidate.text !== "string" || candidate.text.trim() === "") return false;
  if (typeof candidate.createdAt !== "string") return false;
  const parsed = new Date(candidate.createdAt);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === candidate.createdAt;
}
function matchedRules(searchable, rules) {
  return rules.filter((rule) => {
    const normalizedRule = normalize(rule);
    return normalizedRule !== "" && ` ${searchable} `.includes(` ${normalizedRule} `);
  });
}
function normalize(value) {
  return value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function slugify(value) {
  return normalize(value).replace(/ /g, "-") || "task";
}
function formatTaskTimestamp(date) {
  if (Number.isNaN(date.valueOf())) throw new ValidationError("Clock returned an invalid date.");
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}
function assertNonempty2(value, label) {
  if (value.trim() === "") throw new ValidationError(`${label} must not be empty.`);
}
function assertBoundedNonempty2(value, label, maxBytes) {
  assertNonempty2(value, label);
  if (Buffer.byteLength(value.trim(), "utf8") > maxBytes) {
    throw new ValidationError(`${label} exceeds the ${maxBytes}-byte audit metadata limit.`);
  }
}
function assertHost(value) {
  if (value !== "codex" && value !== "claude") {
    throw new ValidationError(`Invalid host: ${value}. Expected codex|claude.`);
  }
}
function assertLearningCandidatesClassified(task) {
  const candidates = task.learningCandidates;
  if (candidates === void 0) return;
  if (!Array.isArray(candidates)) {
    throw new FinishGateError("Finish learning candidate data is malformed.");
  }
  for (const candidate of candidates) {
    if (!isRecord8(candidate) || candidate.schemaVersion !== SCHEMA_VERSION || typeof candidate.id !== "string" || candidate.id.trim() === "" || typeof candidate.domain !== "string" || candidate.domain.trim() === "" || typeof candidate.text !== "string" || candidate.text.trim() === "" || typeof candidate.rationale !== "string" || candidate.rationale.trim() === "" || !isIsoTimestamp4(candidate.proposedAt)) {
      throw new FinishGateError("Finish learning candidate data is malformed.");
    }
    if (candidate.status === "accepted") {
      if (candidate.confirmedBy !== "user" || !isIsoTimestamp4(candidate.acceptedAt)) {
        throw new FinishGateError(`Finish learning candidate ${candidate.id} is not validly accepted.`);
      }
      continue;
    }
    if (candidate.status === "archived") {
      if (!isIsoTimestamp4(candidate.archivedAt) || typeof candidate.archiveReason !== "string" || candidate.archiveReason.trim() === "") {
        throw new FinishGateError(`Finish learning candidate ${candidate.id} is not validly archived.`);
      }
      continue;
    }
    throw new FinishGateError(
      `Finish learning candidate ${candidate.id} must be accepted or archived before completion.`
    );
  }
}
function isIsoTimestamp4(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}
function isRecord8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function inspectGitStatus(repoRoot) {
  try {
    const result = await execFileAsync2("git", ["status", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    return {
      available: true,
      porcelain: result.stdout,
      error: null
    };
  } catch (error) {
    return {
      available: false,
      porcelain: "",
      error: error instanceof Error ? error.message : "Unable to run git status --porcelain."
    };
  }
}

// src/cli/render.ts
var helpText = `Usage: vinea <command>

Commands:
  init
  orient
  propose
  continue
  check
  check show
  finish
  archive
  doctor
  validate
  task list
  task show
  task transition
  task unblock
  task require
  task accept
  task set-plan
  task set-brief
  context add
  context list
  evidence record
  learning propose
  learning accept
  learning archive
`;
function writeOutput(value, json, human) {
  process.stdout.write(json ? `${JSON.stringify(value)}
` : human);
}
function reportError(error, json) {
  const normalized = normalizeError(error);
  if (json) {
    const envelope = {
      error: {
        code: normalized.code,
        message: normalized.message,
        ...normalized.details === void 0 ? {} : { details: normalized.details }
      }
    };
    process.stdout.write(`${JSON.stringify(envelope)}
`);
  } else {
    process.stderr.write(`${normalized.code}: ${normalized.message}
`);
  }
  return normalized.exitCode;
}
function renderProposal(proposal) {
  return [
    `title: ${proposal.title}`,
    `description: ${proposal.description}`,
    `risk: ${proposal.risk.level}`,
    `risk reasons: ${proposal.risk.reasons.length ? proposal.risk.reasons.join(", ") : "none"}`,
    `quality mode: ${proposal.qualityMode}`,
    `execution mode: ${proposal.executionMode}`,
    "confirmation required",
    ""
  ].join("\n");
}
function renderInlineAudit(record) {
  return [
    "Inline skip recorded.",
    `timestamp: ${record.timestamp}`,
    `request: ${record.requestSummary}`,
    `reason: ${record.reason}`,
    ""
  ].join("\n");
}
function renderTask(task, checkRows = []) {
  const incomplete = incompleteRequirements(task, checkRows);
  return [
    `task ID: ${task.id}`,
    `status: ${task.status}`,
    `quality mode: ${task.qualityMode}`,
    `execution mode: ${task.executionMode}`,
    `risk: ${task.risk.level}`,
    `risk reasons: ${task.risk.reasons.length ? task.risk.reasons.join(", ") : "none"}`,
    `incomplete requirements: ${incomplete.length ? incomplete.join(", ") : "none"}`,
    `next gate: ${nextGate(task)}`,
    ""
  ].join("\n");
}
function renderContextManifest(manifest) {
  if (manifest.references.length === 0) {
    return `No context references. Budget: 0/${manifest.limits.maxFiles} files, 0/${manifest.limits.maxEstimatedBytes} bytes.
`;
  }
  return [
    ...manifest.references.map(
      (reference) => `${reference.path} (${reference.estimatedBytes} bytes): ${reference.purpose}`
    ),
    `Budget: ${manifest.totals.files}/${manifest.limits.maxFiles} files, ${manifest.totals.estimatedBytes}/${manifest.limits.maxEstimatedBytes} bytes.`,
    ""
  ].join("\n");
}
function renderEvidence(evidence) {
  return [
    `Evidence: ${evidence.id}`,
    `kind: ${evidence.kind}`,
    `result: ${evidence.result}`,
    `summary: ${evidence.summary}`,
    ""
  ].join("\n");
}
function renderCheckSummary(summary) {
  const lines = summary.rows.map(
    (row) => `${row.requirementId}: ${row.result}; paths: ${row.paths.join(", ")}; evidence: ${row.evidenceIds.join(", ") || "none"}; ${row.summary}`
  );
  lines.push(
    `Totals: ${summary.totals.total} rows; ${summary.totals.pass} pass; ${summary.totals.fail} fail; ${summary.totals.uncovered} uncovered.`,
    ""
  );
  return lines.join("\n");
}
function renderOrient(summary) {
  const lines = [
    `workspace healthy: ${summary.health.healthy}`,
    `git available: ${summary.gitStatus.available}`,
    `git status: ${summary.gitStatus.porcelain === "" ? "clean" : summary.gitStatus.porcelain.trimEnd()}`,
    `binding: ${summary.binding === null ? "none" : summary.binding.status}`,
    `recommendation: ${summary.recommendation}`
  ];
  for (const candidate of summary.candidates) {
    lines.push(
      `${candidate.id}: ${candidate.title} [${candidate.status}; ${candidate.qualityMode}; ${candidate.executionMode}]`,
      `  requirements not covered: ${candidate.requirementsNotCovered.length ? candidate.requirementsNotCovered.join(", ") : "none"}`,
      `  context references: ${candidate.contextReferences.length ? candidate.contextReferences.map(({ path }) => path).join(", ") : "none"}`,
      `  latest evidence: ${candidate.latestEvidence?.id ?? "none"}`,
      `  latest check event: ${String(candidate.latestCheckEvent?.type ?? "none")}`
    );
  }
  return `${lines.join("\n")}
`;
}
function renderDoctorReport(report) {
  const lines = [
    `initialized: ${report.initialized}`,
    `config schema: ${report.configSchemaVersion ?? "missing"}`,
    `supported schema: ${report.supportedSchema}`,
    `missing directories: ${report.missingRequiredDirectories.length ? report.missingRequiredDirectories.join(", ") : "none"}`,
    `git available: ${report.gitStatus.available}`,
    `healthy: ${report.healthy}`
  ];
  if (report.migrationGuidance) lines.push(`guidance: ${report.migrationGuidance}`);
  if (report.gitStatus.error) lines.push(`git guidance: ${report.gitStatus.error}`);
  for (const lock of report.taskLocks) {
    const label = lock.path === ".vinea/.runtime/learning-promotion.lock" ? "learning promotion lock" : "task lock";
    lines.push(
      `${label}: ${lock.path}; task: ${lock.taskId ?? "unknown"}; age milliseconds: ${lock.ageMilliseconds ?? "unknown"}; owner: ${lock.owner.status}`,
      `${label} guidance: ${lock.recoveryInstruction}`
    );
  }
  return `${lines.join("\n")}
`;
}
function renderValidationReport(report) {
  if (report.issues.length === 0) return "Vinea state is valid.\n";
  return `${report.issues.map(
    (issue) => `[${issue.code}] ${issue.path}: ${issue.message}`
  ).join("\n")}
`;
}
function normalizeError(error) {
  if (error instanceof UsageError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      exitCode: error.exitCode
    };
  }
  if (error instanceof VineaError) {
    return { code: error.code, message: error.message, exitCode: 1 };
  }
  return {
    code: "VINEA_SCHEMA_INVALID",
    message: "Unexpected Vinea failure.",
    exitCode: 1
  };
}

// src/cli.ts
init_config();
init_check();
init_evidence();

// src/core/doctor.ts
init_paths();
init_schema();
init_task_locks();
import { execFile as execFile3 } from "node:child_process";
import { lstat as lstat11, readdir as readdir4 } from "node:fs/promises";
import { promisify as promisify3 } from "node:util";
var execFileAsync3 = promisify3(execFile3);
async function diagnoseWorkspace(paths) {
  const [workspace, runtimeSessions, taskLocks, gitStatus] = await Promise.all([
    inspectWorkspace(paths),
    inspectRuntimeSessions(paths),
    inspectTaskLocks(paths),
    inspectGitAvailability(paths.repoRoot)
  ]);
  const missingRequiredDirectories = workspace.missingRequiredDirectories.filter(
    (directory) => directory !== ".runtime/sessions" || runtimeSessions !== "missing"
  );
  if (runtimeSessions === "invalid" && !missingRequiredDirectories.includes(".runtime/sessions")) {
    missingRequiredDirectories.push(".runtime/sessions");
  }
  return {
    ...workspace,
    missingRequiredDirectories,
    migrationGuidance: runtimeSessions === "invalid" && workspace.migrationGuidance === null ? "Repair or remove malformed local .runtime/sessions state before using session recovery." : workspace.migrationGuidance,
    healthy: workspace.supportedSchema && missingRequiredDirectories.length === 0 && taskLocks.length === 0,
    taskLocks,
    gitStatus
  };
}
async function inspectRuntimeSessions(paths) {
  try {
    await assertNoSymlink(paths.repoRoot, paths.sessions);
    const entry = await lstat11(paths.sessions);
    if (!entry.isDirectory() || entry.isSymbolicLink()) return "invalid";
    await readdir4(paths.sessions);
    return "usable";
  } catch (error) {
    return isMissing6(error) ? "missing" : "invalid";
  }
}
async function inspectGitAvailability(repoRoot) {
  try {
    await execFileAsync3("git", ["--no-optional-locks", "status", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
    });
    return { available: true, error: null };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "Unable to run git status --porcelain."
    };
  }
}
function isMissing6(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// src/cli.ts
init_learning();
init_paths();
init_validate();
async function main(args) {
  const json = requestsJson(args);
  try {
    const command = args[0];
    if (command === "--help" || command === "-h") {
      parseOptions(args.slice(1), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set());
      process.stdout.write(helpText);
      return 0;
    }
    if (command === "--version" || command === "-V") {
      parseOptions(args.slice(1), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set());
      process.stdout.write(`${package_default.version}
`);
      return 0;
    }
    if (command === "init") {
      const options = parseOptions(args.slice(1), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(["--json"]));
      await initializeWorkspace(resolveVineaPaths(process.cwd()));
      writeOutput({ initialized: true }, options.has("--json"), "Initialized Vinea workspace.\n");
      return 0;
    }
    if (command === "doctor") {
      const options = parseOptions(args.slice(1), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(["--json"]));
      const report = await diagnoseWorkspace(resolveVineaPaths(process.cwd()));
      writeOutput(report, options.has("--json"), renderDoctorReport(report));
      return report.healthy ? 0 : 1;
    }
    if (command === "validate") {
      const options = parseOptions(args.slice(1), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(["--json"]));
      const report = await validateWorkspace(resolveVineaPaths(process.cwd()));
      writeOutput(report, options.has("--json"), renderValidationReport(report));
      return report.issues.length === 0 ? 0 : 1;
    }
    if (command === "propose") {
      return await handlePropose(args.slice(1));
    }
    if (command === "orient") {
      return await handleOrient(args.slice(1));
    }
    if (command === "continue") {
      return await handleContinue(args.slice(1));
    }
    if (command === "task") {
      return await handleTask(args.slice(1));
    }
    if (command === "context") {
      return await handleContext(args.slice(1));
    }
    if (command === "evidence") {
      return await handleEvidence(args.slice(1));
    }
    if (command === "learning") {
      return await handleLearning(args.slice(1));
    }
    if (command === "check") {
      return await handleCheck(args.slice(1));
    }
    if (command === "finish") {
      return await handleFinish(args.slice(1));
    }
    if (command === "archive") {
      return await handleArchive(args.slice(1));
    }
    throw new UsageError(`Unknown command: ${command ?? "(none)"}`);
  } catch (error) {
    return reportError(error, json);
  }
}
async function handleOrient(args) {
  const options = parseOptions(
    args,
    /* @__PURE__ */ new Set(["--host", "--session-id"]),
    /* @__PURE__ */ new Set(["--json"])
  );
  const host = oneOf(requiredOption(options, "--host"), ["codex", "claude"], "--host");
  const summary = await orientWorkspace(resolveVineaPaths(process.cwd()), {
    host,
    sessionId: optionalValue(options, "--session-id")
  });
  writeOutput(summary, options.has("--json"), renderOrient(summary));
  return summary.health.initialized && summary.health.supportedSchema ? 0 : 1;
}
async function handleContinue(args) {
  const taskId = requiredTaskId(args[0]);
  const options = parseOptions(
    args.slice(1),
    /* @__PURE__ */ new Set(["--host", "--session-id", "--reason"]),
    /* @__PURE__ */ new Set(["--confirmed", "--start", "--json"])
  );
  if (!options.has("--confirmed")) {
    throw new UsageError("Continuation requires explicit --confirmed.");
  }
  const start = options.has("--start");
  const reason = optionalValue(options, "--reason");
  if (start && reason === void 0) {
    throw new UsageError("--start requires --reason.");
  }
  if (!start && reason !== void 0) {
    throw new UsageError("--reason requires --start.");
  }
  const host = oneOf(requiredOption(options, "--host"), ["codex", "claude"], "--host");
  const result = await continueTask(resolveVineaPaths(process.cwd()), taskId, {
    host,
    sessionId: optionalValue(options, "--session-id"),
    confirmed: true,
    start,
    reason
  });
  writeOutput(
    result,
    options.has("--json"),
    `Continued ${result.task.id} on ${host}; status: ${result.task.status}; binding: ${result.binding === null ? "none" : "saved"}.
`
  );
  return 0;
}
async function handlePropose(args) {
  const options = parseOptions(
    args,
    /* @__PURE__ */ new Set(["--title", "--description", "--risk", "--quality", "--execution", "--inline-skip-reason"]),
    /* @__PURE__ */ new Set(["--confirmed", "--json"])
  );
  const title = requiredOption(options, "--title");
  const description = requiredOption(options, "--description");
  const requestedRisk = oneOf(requiredOption(options, "--risk"), ["auto", "low", "medium", "high"], "--risk");
  const qualityMode = oneOf(requiredOption(options, "--quality"), ["standard", "tdd"], "--quality");
  const executionMode = oneOf(
    requiredOption(options, "--execution"),
    ["single-agent", "delegated"],
    "--execution"
  );
  const confirmed = options.has("--confirmed");
  const inlineSkipReason = optionalValue(options, "--inline-skip-reason");
  const json = options.has("--json");
  if (confirmed && inlineSkipReason !== void 0) {
    throw new UsageError("--confirmed cannot be combined with --inline-skip-reason.");
  }
  const paths = resolveVineaPaths(process.cwd());
  const config = await readConfig(paths);
  const suggested = suggestRisk(title, description, [], config.riskRules);
  const risk = {
    level: requestedRisk === "auto" ? suggested.level : requestedRisk,
    reasons: suggested.reasons
  };
  const proposal = { title: title.trim(), description: description.trim(), risk, qualityMode, executionMode };
  if (inlineSkipReason !== void 0) {
    const record = await appendInlineAudit(paths, {
      title,
      description,
      proposedRisk: risk,
      reason: inlineSkipReason
    });
    writeOutput(record, json, renderInlineAudit(record));
    return 0;
  }
  if (confirmed) {
    const created = await createTask(paths, {
      title,
      risk,
      qualityMode,
      executionMode,
      confirmation: "user"
    });
    await writeTaskOutput(paths, created.task, json);
    return 0;
  }
  writeOutput(proposal, json, renderProposal(proposal));
  return 0;
}
async function handleTask(args) {
  const subcommand = args[0];
  const paths = resolveVineaPaths(process.cwd());
  if (subcommand === "list") {
    const options = parseOptions(args.slice(1), /* @__PURE__ */ new Set(["--status"]), /* @__PURE__ */ new Set(["--json"]));
    const status = oneOf(optionalValue(options, "--status") ?? "active", ["active", "all"], "--status");
    const tasks = await listTasks(paths, status);
    const json = options.has("--json");
    const checks = await Promise.all(tasks.map((task) => showCheck(paths, task.id)));
    writeOutput(
      tasks,
      json,
      tasks.length === 0 ? "No tasks.\n" : tasks.map((task, index) => renderTask(task, checks[index].rows)).join("\n")
    );
    return 0;
  }
  if (subcommand === "show") {
    const taskId = requiredTaskId(args[1]);
    const options = parseOptions(args.slice(2), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(["--json"]));
    const task = await readTask(paths, taskId);
    const check = await showCheck(paths, taskId);
    writeOutput(task, options.has("--json"), renderTask(task, check.rows));
    return 0;
  }
  if (subcommand === "transition" || subcommand === "unblock") {
    const taskId = requiredTaskId(args[1]);
    const options = parseOptions(args.slice(2), /* @__PURE__ */ new Set(["--to", "--reason"]), /* @__PURE__ */ new Set(["--json"]));
    const to = oneOf(
      requiredOption(options, "--to"),
      ["planning", "ready", "in_progress", "checking", "finished", "archived", "blocked"],
      "--to"
    );
    if (to === "finished" || to === "archived") {
      throw new UsageError(`Use the confirmed ${to === "finished" ? "finish" : "archive"} command for ${to} transitions.`);
    }
    if (subcommand === "unblock" && !["ready", "in_progress", "checking"].includes(to)) {
      throw new UsageError("unblock --to must be ready, in_progress, or checking.");
    }
    const task = await transitionTask(paths, taskId, to, {
      actor: "cli",
      reason: requiredOption(options, "--reason"),
      unblock: subcommand === "unblock"
    });
    await writeTaskOutput(paths, task, options.has("--json"));
    return 0;
  }
  if (subcommand === "require" || subcommand === "accept") {
    const taskId = requiredTaskId(args[1]);
    const options = parseOptions(args.slice(2), /* @__PURE__ */ new Set(["--id", "--text"]), /* @__PURE__ */ new Set(["--json"]));
    const input = {
      id: requiredOption(options, "--id"),
      text: requiredOption(options, "--text"),
      actor: "cli"
    };
    const task = subcommand === "require" ? await addRequirement(paths, taskId, input) : await addAcceptanceCriterion(paths, taskId, input);
    await writeTaskOutput(paths, task, options.has("--json"));
    return 0;
  }
  if (subcommand === "set-plan" || subcommand === "set-brief") {
    const taskId = requiredTaskId(args[1]);
    const options = parseOptions(args.slice(2), /* @__PURE__ */ new Set(["--file"]), /* @__PURE__ */ new Set(["--json"]));
    const result = subcommand === "set-plan" ? await setTaskPlan(paths, taskId, requiredOption(options, "--file"), "cli") : await setTaskBrief(paths, taskId, requiredOption(options, "--file"), "cli");
    writeOutput(
      result,
      options.has("--json"),
      `Updated ${result.artifact} for ${result.taskId} (${result.estimatedBytes} bytes).
`
    );
    return 0;
  }
  throw new UsageError(`Unknown task command: ${subcommand ?? "(none)"}`);
}
async function handleContext(args) {
  const subcommand = args[0];
  const taskId = requiredTaskId(args[1]);
  const paths = resolveVineaPaths(process.cwd());
  if (subcommand === "add") {
    const options = parseOptions(args.slice(2), /* @__PURE__ */ new Set(["--path", "--purpose"]), /* @__PURE__ */ new Set(["--json"]));
    const reference = await addContextReference(paths, taskId, {
      path: requiredOption(options, "--path"),
      purpose: requiredOption(options, "--purpose"),
      actor: "cli"
    });
    writeOutput(
      reference,
      options.has("--json"),
      `Added context ${reference.path} (${reference.estimatedBytes} bytes).
`
    );
    return 0;
  }
  if (subcommand === "list") {
    const options = parseOptions(args.slice(2), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(["--json"]));
    const manifest = await listContextReferences(paths, taskId);
    writeOutput(manifest, options.has("--json"), renderContextManifest(manifest));
    return 0;
  }
  throw new UsageError(`Unknown context command: ${subcommand ?? "(none)"}`);
}
async function handleEvidence(args) {
  const subcommand = args[0];
  if (subcommand !== "record") {
    throw new UsageError(`Unknown evidence command: ${subcommand ?? "(none)"}`);
  }
  const taskId = requiredTaskId(args[1]);
  const options = parseOptions(
    args.slice(2),
    /* @__PURE__ */ new Set(["--kind", "--summary", "--command", "--exit-code", "--result"]),
    /* @__PURE__ */ new Set(["--json"])
  );
  const kind = oneOf(
    requiredOption(options, "--kind"),
    ["command", "manual", "tdd-red", "tdd-green"],
    "--kind"
  );
  const resultValue = optionalValue(options, "--result");
  const result = resultValue === void 0 ? void 0 : oneOf(resultValue, ["pass", "fail"], "--result");
  const exitCodeValue = optionalValue(options, "--exit-code");
  const exitCode = exitCodeValue === void 0 ? void 0 : parseExitCode(exitCodeValue);
  const evidence = await recordEvidence(resolveVineaPaths(process.cwd()), taskId, {
    kind,
    summary: requiredOption(options, "--summary"),
    command: optionalValue(options, "--command"),
    exitCode,
    result,
    actor: "cli"
  });
  writeOutput(evidence, options.has("--json"), renderEvidence(evidence));
  return 0;
}
async function handleLearning(args) {
  const subcommand = args[0];
  const taskId = requiredTaskId(args[1]);
  const paths = resolveVineaPaths(process.cwd());
  if (subcommand === "propose") {
    const options = parseOptions(
      args.slice(2),
      /* @__PURE__ */ new Set(["--id", "--domain", "--text", "--rationale"]),
      /* @__PURE__ */ new Set(["--json"])
    );
    const task = await proposeLearning(paths, taskId, {
      id: requiredOption(options, "--id"),
      domain: requiredOption(options, "--domain"),
      text: requiredOption(options, "--text"),
      rationale: requiredOption(options, "--rationale"),
      actor: "cli"
    });
    await writeTaskOutput(paths, task, options.has("--json"));
    return 0;
  }
  if (subcommand === "accept") {
    const options = parseOptions(
      args.slice(2),
      /* @__PURE__ */ new Set(["--id", "--confirmed-by"]),
      /* @__PURE__ */ new Set(["--json"])
    );
    const confirmedBy = oneOf(
      requiredOption(options, "--confirmed-by"),
      ["user"],
      "--confirmed-by"
    );
    const task = await acceptLearning(paths, taskId, {
      id: requiredOption(options, "--id"),
      confirmedBy,
      actor: "cli"
    });
    await writeTaskOutput(paths, task, options.has("--json"));
    return 0;
  }
  if (subcommand === "archive") {
    const options = parseOptions(
      args.slice(2),
      /* @__PURE__ */ new Set(["--id", "--reason"]),
      /* @__PURE__ */ new Set(["--json"])
    );
    const task = await archiveLearning(paths, taskId, {
      id: requiredOption(options, "--id"),
      reason: requiredOption(options, "--reason"),
      actor: "cli"
    });
    await writeTaskOutput(paths, task, options.has("--json"));
    return 0;
  }
  throw new UsageError(`Unknown learning command: ${subcommand ?? "(none)"}`);
}
async function handleCheck(args) {
  const paths = resolveVineaPaths(process.cwd());
  if (args[0] === "show") {
    const taskId2 = requiredTaskId(args[1]);
    const options2 = parseOptions(args.slice(2), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(["--json"]));
    const summary2 = await showCheck(paths, taskId2);
    writeOutput(summary2, options2.has("--json"), renderCheckSummary(summary2));
    return 0;
  }
  const taskId = requiredTaskId(args[0]);
  const options = parseOptions(
    args.slice(1),
    /* @__PURE__ */ new Set(["--requirement", "--plan-item", "--paths", "--evidence", "--result", "--summary"]),
    /* @__PURE__ */ new Set(["--json"])
  );
  const evidence = optionalValue(options, "--evidence");
  const summary = await upsertCheck(paths, taskId, {
    requirementId: requiredOption(options, "--requirement"),
    planItem: requiredOption(options, "--plan-item"),
    paths: commaList(requiredOption(options, "--paths"), "--paths"),
    evidenceIds: evidence === void 0 ? [] : commaList(evidence, "--evidence"),
    result: oneOf(
      requiredOption(options, "--result"),
      ["pass", "fail", "uncovered"],
      "--result"
    ),
    summary: requiredOption(options, "--summary"),
    actor: "cli"
  });
  writeOutput(summary, options.has("--json"), renderCheckSummary(summary));
  return 0;
}
async function handleFinish(args) {
  const taskId = requiredTaskId(args[0]);
  const options = parseOptions(args.slice(1), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(["--confirmed", "--json"]));
  if (!options.has("--confirmed")) throw new UsageError("Finish requires explicit --confirmed.");
  const paths = resolveVineaPaths(process.cwd());
  const task = await finishTask(paths, taskId, {
    confirmed: true,
    actor: "cli"
  });
  await writeTaskOutput(paths, task, options.has("--json"));
  return 0;
}
async function handleArchive(args) {
  const taskId = requiredTaskId(args[0]);
  const options = parseOptions(args.slice(1), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(["--confirmed", "--json"]));
  if (!options.has("--confirmed")) throw new UsageError("Archive requires explicit --confirmed.");
  const paths = resolveVineaPaths(process.cwd());
  const task = await archiveTask(paths, taskId, {
    confirmed: true,
    actor: "cli"
  });
  await writeTaskOutput(paths, task, options.has("--json"));
  return 0;
}
async function writeTaskOutput(paths, task, json) {
  const check = await showCheck(paths, task.id);
  writeOutput(task, json, renderTask(task, check.rows));
}
void main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
export {
  main
};
