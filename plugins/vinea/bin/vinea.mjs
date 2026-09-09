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

// src/kernel/errors.ts
function requireThat(value, code, message) {
  if (!value) throw new KernelError(code, message);
}
var KernelError;
var init_errors = __esm({
  "src/kernel/errors.ts"() {
    "use strict";
    KernelError = class extends Error {
      constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "KernelError";
      }
    };
  }
});

// src/kernel/schema.ts
function invalid(path, reason) {
  throw new KernelError("SCHEMA_INVALID", `${path}: ${reason}`);
}
function record(value, path = "object") {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(path, "expected plain object");
  const out = value;
  for (const key of Object.keys(out)) if (["__proto__", "constructor", "prototype"].includes(key)) invalid(path, "unsafe property");
  return out;
}
function canonicalJson(value) {
  function normalize(v) {
    if (v === null || typeof v === "boolean" || typeof v === "string") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map(normalize);
    if (typeof v !== "object") invalid("JSON", "unsupported value");
    return Object.fromEntries(Object.entries(record(v)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, item]) => [k, normalize(item)]));
  }
  try {
    return JSON.stringify(normalize(value));
  } catch (error) {
    if (error instanceof KernelError) throw error;
    throw new KernelError("SCHEMA_INVALID", "Value is not finite acyclic JSON");
  }
}
function assertRepositoryState(value) {
  stateRule(value);
  const state = value;
  const active = /* @__PURE__ */ new Set();
  for (const [workspace, claim] of Object.entries(state.claims)) {
    const key = JSON.stringify([claim.taskId, claim.assignmentId]);
    const task2 = state.tasks[claim.taskId];
    if (workspace !== claim.workspaceId || !task2 || claim.epoch < 1 || claim.epoch > (state.epochs[key] ?? -1) || claim.contractVersion < 1 || claim.contractVersion > task2.contracts.length || claim.assignmentId !== null && !task2.assignments[claim.assignmentId]) invalid(workspace, "invalid claim reference");
    if (claim.state === "writer" || claim.state === "restore-target") {
      if (active.has(key) || claim.epoch !== state.epochs[key]) invalid(key, "multiple current writers or stale epoch");
      active.add(key);
    }
    if (claim.state === "restore-target" && !claim.recovery || ["writer", "released"].includes(claim.state) && claim.recovery) invalid(workspace, "invalid recovery state");
    if (claim.recovery && !state.snapshots[claim.recovery.snapshotId]) invalid(workspace, "missing recovery snapshot");
  }
  for (const [key, task2] of Object.entries(state.tasks)) {
    if (key !== task2.id || !task2.contracts.length || task2.owner.epoch < 1) invalid(key, "invalid task identity");
    if (task2.relatedTo && !state.tasks[task2.relatedTo.taskId]?.deliveries[task2.relatedTo.deliveryId]) invalid(key, "missing original delivery");
    task2.contracts.forEach((c, i) => {
      if (c.version !== i + 1 || !c.acceptance.length || new Set(c.acceptance.map((a) => a.id)).size !== c.acceptance.length) invalid(key, "invalid contract history");
    });
    const visit = (key2, stack) => {
      if (stack.has(key2) || !task2.assignments[key2]) invalid(key2, "invalid assignment dependency");
      const next = new Set(stack).add(key2);
      for (const dependency of task2.assignments[key2].dependsOn) visit(dependency, next);
    };
    for (const [name, assignment2] of Object.entries(task2.assignments)) {
      if (name !== assignment2.id) invalid(name, "assignment ID mismatch");
      visit(name, /* @__PURE__ */ new Set());
    }
    for (const [name, e] of Object.entries(task2.evidence)) {
      if (name !== e.id || !state.snapshots[e.snapshotId] || e.contractVersion < 1 || e.contractVersion > task2.contracts.length) invalid(name, "invalid evidence reference");
      if (e.source === "command-runner" !== (e.artifactId !== null) || e.sequence < 1 || e.result === "pass" && e.exitCode !== null && e.exitCode !== 0 || e.phase === "red" && (e.result !== "fail" || !e.exitCode) || e.phase === "green" && (e.result !== "pass" || e.exitCode !== 0)) invalid(name, "invalid evidence provenance or result");
    }
    for (const [name, c] of Object.entries(task2.contributions)) {
      if (name !== c.id || c.contractVersion < 1 || c.contractVersion > task2.contracts.length || c.assignmentId !== null && !task2.assignments[c.assignmentId] || c.evidenceIds.some((e) => !task2.evidence[e]) || c.snapshotId !== null && !state.snapshots[c.snapshotId] || c.integrated && !state.snapshots[c.integrated.snapshotId] || c.kind === "change" && (!c.snapshotId || !c.writeToken || c.writeToken.taskId !== task2.id || c.writeToken.assignmentId !== c.assignmentId)) invalid(name, "invalid contribution reference");
    }
    for (const [name, c] of Object.entries(task2.checks)) if (name !== c.id || !state.snapshots[c.snapshotId] || c.contractVersion < 1 || c.contractVersion > task2.contracts.length || c.verification.some((v) => !task2.evidence[v.evidenceId]) || c.rows.some((r) => r.evidenceIds.some((e) => !task2.evidence[e]))) invalid(name, "invalid check reference");
    for (const [name, d] of Object.entries(task2.deliveries)) if (name !== d.id || !state.snapshots[d.snapshotId] || d.contractVersion < 1 || d.contractVersion > task2.contracts.length || d.owner.epoch < 1 || d.contributionIds.some((c) => !task2.contributions[c]) || d.checkSetIds.some((c) => !task2.checks[c])) invalid(name, "invalid delivery reference");
    if (task2.diagnostics.some((d) => d.evidenceIds.some((e) => !task2.evidence[e])) || task2.userAcceptances.some((a) => !task2.deliveries[a.deliveryId])) invalid(key, "invalid task history reference");
  }
  for (const [key, s] of Object.entries(state.snapshots)) {
    if (key !== s.id || !s.scope.length || new Set(s.entries.map((e) => e.path)).size !== s.entries.length) invalid(key, "snapshot identity mismatch");
    if (s.entries.some((e) => !s.scope.some((root) => e.path === root || e.path.startsWith(`${root}/`)))) invalid(key, "snapshot entry escapes selected scope");
    for (const e of s.entries) if (e.kind === "file" ? !e.sha256 || !e.mode : e.sha256 !== null || e.mode !== null) invalid(e.path, "snapshot entry mismatch");
  }
  for (const [key, receipt] of Object.entries(state.operations)) if (key !== receipt.operationId || receipt.revision < 1 || receipt.revision > state.revision) invalid(key, "invalid operation receipt");
}
var text, id, integer, bool, one, nullable, array, object, map, pathRule, hash, actorRule, decisionRule, invocationRule, metaRule, grantRule, criterionRule, draftFields, contractDraftRule, contractRule, ownerRule, tokenFields, tokenRule, recoveryRule, claimRule, environmentRule, entryRule, snapshotRule, evidenceRule, checkRowRule, verificationRule, checkRule, contributionRule, diagnosticRule, assignmentRule, deliveryRule, taskRule, stateRule;
var init_schema = __esm({
  "src/kernel/schema.ts"() {
    "use strict";
    init_errors();
    text = (v, p = "value") => {
      if (typeof v !== "string" || !v.trim() || v.length > 32e3) invalid(p, "expected bounded nonempty text");
    };
    id = (v, p = "id") => {
      if (typeof v !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(v) || [...Object.getOwnPropertyNames(Object.prototype), "prototype"].includes(v)) invalid(p, "unsafe ID");
    };
    integer = (v, p = "number") => {
      if (!Number.isSafeInteger(v) || v < 0) invalid(p, "expected nonnegative integer");
    };
    bool = (v, p = "boolean") => {
      if (typeof v !== "boolean") invalid(p, "expected boolean");
    };
    one = (...values) => (v, p = "value") => {
      if (!values.includes(v)) invalid(p, "unsupported value");
    };
    nullable = (rule) => (v, p) => {
      if (v !== null) rule(v, p);
    };
    array = (rule) => (v, p = "array") => {
      if (!Array.isArray(v) || v.length > 1e5) invalid(p, "expected bounded array");
      v.forEach((item, i) => rule(item, `${p}[${i}]`));
    };
    object = (fields, optional = {}) => (v, p = "object") => {
      const o = record(v, p);
      for (const key of Object.keys(o)) if (!Object.hasOwn(fields, key) && !Object.hasOwn(optional, key)) invalid(`${p}.${key}`, "unknown field");
      for (const [key, rule] of Object.entries(fields)) rule(o[key], `${p}.${key}`);
      for (const [key, rule] of Object.entries(optional)) if (Object.hasOwn(o, key)) rule(o[key], `${p}.${key}`);
    };
    map = (rule, keyRule = id) => (v, p = "map") => {
      for (const [key, item] of Object.entries(record(v, p))) {
        keyRule(key, p);
        rule(item, `${p}.${key}`);
      }
    };
    pathRule = (v, p = "path") => {
      text(v, p);
      if (v.startsWith("/") || v.includes("\\") || v.split("/").some((s) => !s || s === "." || s === "..") || v.includes("\0")) invalid(p, "unsafe relative path");
    };
    hash = (v, p = "hash") => {
      if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) invalid(p, "invalid SHA256");
    };
    actorRule = object({ instanceId: id, host: text }, { hostSessionId: text });
    decisionRule = object({ summary: text, reference: nullable(text) });
    invocationRule = object({ entry: one("run", "brainstorm", "plan", "continue", "check", "debug", "finish", "orient", "doctor"), activation: one("named-entry", "named-request", "bound-followup", "none"), analysisOnly: bool, persist: bool });
    metaRule = object({ operationId: id, actor: actorRule, invocation: invocationRule });
    grantRule = object({ businessWrite: bool, delegate: bool, commit: bool, deploy: bool, allowedPaths: array(pathRule) });
    criterionRule = object({ id, text });
    draftFields = { goal: text, scope: array(text), constraints: array(text), acceptance: array(criterionRule), grant: grantRule, quality: one("standard", "tdd") };
    contractDraftRule = object(draftFields);
    contractRule = object({ ...draftFields, version: integer, decision: decisionRule });
    ownerRule = object({ instanceId: id, epoch: integer });
    tokenFields = { taskId: id, assignmentId: nullable(id), workspaceId: id, instanceId: id, epoch: integer, contractVersion: integer };
    tokenRule = object(tokenFields);
    recoveryRule = object({ snapshotId: id, operationId: id });
    claimRule = object({ ...tokenFields, state: one("writer", "restore-target", "unknown-writer-hold", "released"), recovery: nullable(recoveryRule) });
    environmentRule = object({ runtime: text, platform: text, labels: map(text) });
    entryRule = object({ path: pathRule, kind: one("file", "deleted"), sha256: nullable(hash), mode: nullable(one("100644", "100755")) });
    snapshotRule = object({ id, fingerprint: hash, baseCommit: nullable(text), scope: array(pathRule), entries: array(entryRule), workspaceId: id, createdBy: id, capturedAt: text });
    evidenceRule = object({ id, contractVersion: integer, snapshotId: id, actor: actorRule, source: one("command-runner", "agent-report", "user-observation"), result: one("pass", "fail", "unverified"), phase: nullable(one("red", "green")), argv: nullable(array(text)), cwd: text, environment: environmentRule, exitCode: nullable(integer), summary: text, artifactId: nullable(id), sequence: integer });
    checkRowRule = object({ acceptanceId: id, result: one("pass", "fail", "unverified", "accepted-gap"), evidenceIds: array(id), summary: text, gapDecision: nullable(decisionRule) });
    verificationRule = object({ evidenceId: id, argv: nullable(array(text)), environment: environmentRule });
    checkRule = object({ id, contractVersion: integer, snapshotId: id, assessor: actorRule, independent: bool, rows: array(checkRowRule), verification: array(verificationRule) });
    contributionRule = object({ id, kind: one("analysis", "change"), assignmentId: nullable(id), contractVersion: integer, submittedBy: id, snapshotId: nullable(id), evidenceIds: array(id), summary: text, writeToken: nullable(tokenRule), integrated: nullable(object({ snapshotId: id, owner: ownerRule, rationale: text })) });
    diagnosticRule = object({ id, kind: one("fact", "hypothesis", "ruled-out", "change", "validation-gap"), text, evidenceIds: array(id), actor: actorRule, createdAt: text });
    assignmentRule = object({ id, outcome: text, dependsOn: array(id), assignee: nullable(id), businessWrite: bool, status: one("open", "closed", "cancelled") });
    deliveryRule = object({ id, contractVersion: integer, snapshotId: id, checkSetIds: array(id), contributionIds: array(id), exclusions: array(text), owner: ownerRule, acceptedGaps: array(object({ acceptanceId: id, decision: decisionRule })), createdAt: text });
    taskRule = object({ id, title: text, status: one("active", "delivered", "archived"), contracts: array(contractRule), owner: ownerRule, assignments: map(assignmentRule), contributions: map(contributionRule), evidence: map(evidenceRule), checks: map(checkRule), diagnostics: array(diagnosticRule), deliveries: map(deliveryRule), userAcceptances: array(object({ deliveryId: id, decision: decisionRule, actor: actorRule, recordedAt: text })), relatedTo: nullable(object({ taskId: id, deliveryId: id })), legacySource: nullable(object({ path: text, fingerprint: hash, originalStatus: text })) });
    stateRule = object({ kernelSchemaVersion: one(1), repositoryId: id, revision: integer, tasks: map(taskRule), claims: map(claimRule), epochs: map(integer, text), snapshots: map(snapshotRule), operations: map(object({ operationId: id, requestHash: hash, revision: integer, resourceIds: array(id) })) });
  }
});

// src/kernel/repository.ts
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
async function gitOutput(cwd, args) {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) delete env[key];
  return (await execute("git", args, { cwd, env, maxBuffer: 16 * 1024 * 1024 })).stdout;
}
async function discoverRepository(cwd) {
  const root = await realpath(resolve(cwd));
  try {
    const path = async (flag) => {
      const out = await gitOutput(root, ["rev-parse", "--path-format=absolute", flag]);
      return realpath(out.endsWith("\n") ? out.slice(0, -1) : out);
    };
    const worktreeRoot = await path("--show-toplevel");
    const commonGitDir = await path("--git-common-dir");
    return {
      worktreeRoot,
      commonGitDir,
      storeRoot: join(commonGitDir, "vinea"),
      workspaceId: createHash("sha256").update(worktreeRoot).digest("hex")
    };
  } catch {
    throw new KernelError("NOT_GIT_REPOSITORY", "A Git working tree is required; no repository was initialized");
  }
}
function newActor(host, hostSessionId) {
  const actor = { instanceId: randomUUID(), host, ...hostSessionId ? { hostSessionId } : {} };
  actorRule(actor);
  return actor;
}
var execute;
var init_repository = __esm({
  "src/kernel/repository.ts"() {
    "use strict";
    init_errors();
    init_schema();
    execute = promisify(execFile);
  }
});

// src/kernel/io.ts
import { lstat, mkdir, open, readFile, rename, unlink, link } from "node:fs/promises";
import { dirname, join as join2, relative, resolve as resolve2, isAbsolute } from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
function assertPersistence(meta) {
  if (!meta.invocation.persist) throw new KernelError("PERSISTENCE_DISABLED", "This invocation must not write files");
}
async function safePath(root, target) {
  const full = resolve2(target), rel = relative(root, full);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new KernelError("UNSAFE_PATH", "Path escapes its authorized root");
  }
  let current = resolve2(root);
  for (const part of ["", ...rel.split(/[\\/]/).filter(Boolean)]) {
    if (part) current = join2(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new KernelError("UNSAFE_PATH", "Symbolic links are not allowed in managed paths");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return full;
}
async function storagePath(ctx, rel) {
  const target = resolve2(ctx.storeRoot, rel);
  await safePath(ctx.storeRoot, target);
  return safePath(ctx.commonGitDir, target);
}
async function readManaged(ctx, rel) {
  const file = await storagePath(ctx, rel);
  const info = await lstat(file);
  if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new KernelError("STATE_INVALID", "Invalid or oversized managed file");
  return readFile(file);
}
async function writeManaged(ctx, meta, rel, bytes, immutable = false) {
  assertPersistence(meta);
  if (Buffer.byteLength(bytes) > 64 * 1024 * 1024) throw new KernelError("STATE_TOO_LARGE", "Managed files cannot exceed the read limit of 64 MiB");
  const path = await storagePath(ctx, rel);
  await mkdir(dirname(path), { recursive: true });
  await storagePath(ctx, rel);
  const temp = `${path}.${randomUUID2()}.tmp`;
  try {
    const file = await open(temp, "wx", 384);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    if (immutable) {
      try {
        await link(temp, path);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (!(await readManaged(ctx, rel)).equals(Buffer.from(bytes))) throw new KernelError("ARTIFACT_CONFLICT", "Immutable artifact differs");
      }
    } else await rename(temp, path);
  } finally {
    await unlink(temp).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
async function writeJson(ctx, meta, rel, value, immutable = false) {
  await writeManaged(ctx, meta, rel, `${canonicalJson(value)}
`, immutable);
}
var init_io = __esm({
  "src/kernel/io.ts"() {
    "use strict";
    init_errors();
    init_schema();
  }
});

// src/kernel/policy.ts
function getTask(state, taskId, mutable = true) {
  id(taskId);
  const task2 = state.tasks[taskId];
  requireThat(task2, "TASK_NOT_FOUND", "Task was not found");
  if (mutable) requireThat(task2.status === "active", "TASK_READ_ONLY", "Delivered and archived tasks are immutable; open a linked repair");
  return task2;
}
function currentContract(task2) {
  return task2.contracts[task2.contracts.length - 1];
}
function assertContract(task2, version2) {
  requireThat(currentContract(task2).version === version2, "CONTRACT_VERSION_CHANGED", "Read the current contract before continuing");
}
function assertOwner(task2, meta, epoch) {
  requireThat(task2.owner.instanceId === meta.actor.instanceId && task2.owner.epoch === epoch, "OWNER_CHANGED", "Delivery ownership has changed");
}
function assertEntry(meta, task2, capability) {
  metaRule(meta);
  assertPersistence(meta);
  requireThat(meta.invocation.activation !== "none", "ACTIVATION_REQUIRED", "Explicit Vinea activation is required");
  requireThat(!["orient", "doctor"].includes(meta.invocation.entry), "ENTRY_SCOPE_DENIED", "This entry is read-only");
  if (meta.invocation.activation === "bound-followup") requireThat(task2, "BINDING_REQUIRED", "A bound task is required");
  if (capability !== "state-write") {
    requireThat(
      ["run", "continue", "debug"].includes(meta.invocation.entry) && !meta.invocation.analysisOnly,
      "ENTRY_SCOPE_DENIED",
      "This entry does not authorize business changes or delegation"
    );
  }
  if (task2 && capability === "business-write") {
    const grant = currentContract(task2).grant;
    requireThat(grant.businessWrite && grant.allowedPaths.length > 0, "BUSINESS_WRITE_NOT_GRANTED", "No business paths are writable");
  }
  if (task2 && capability === "delegate") requireThat(currentContract(task2).grant.delegate, "DELEGATION_NOT_GRANTED", "Delegation is not authorized");
}
function assertWritablePath(task2, path) {
  const grant = currentContract(task2).grant;
  requireThat(
    grant.businessWrite && grant.allowedPaths.some((root) => path === root || path.startsWith(`${root}/`)),
    "PATH_NOT_GRANTED",
    "Path is outside the task grant"
  );
}
var init_policy = __esm({
  "src/kernel/policy.ts"() {
    "use strict";
    init_errors();
    init_io();
    init_schema();
  }
});

// src/kernel/ownership.ts
import { randomUUID as randomUUID3 } from "node:crypto";
function executionKey(taskId, assignmentId) {
  return JSON.stringify([taskId, assignmentId]);
}
function assertWorkspaceClaimable(state, workspaceId) {
  requireThat(!state.claims[workspaceId] || state.claims[workspaceId].state === "released", "WORKSPACE_OCCUPIED", "Workspace is written, restoring, or held by an unknown writer");
}
function assertCurrentToken(ctx, state, meta, token) {
  tokenRule(token);
  const claim = state.claims[ctx.workspaceId], task2 = getTask(state, token.taskId);
  requireThat(
    claim?.state === "writer" && token.workspaceId === ctx.workspaceId && claim.instanceId === meta.actor.instanceId && token.instanceId === claim.instanceId && token.epoch === claim.epoch && token.taskId === claim.taskId && token.assignmentId === claim.assignmentId && token.epoch === state.epochs[executionKey(token.taskId, token.assignmentId)],
    "STALE_WRITE_TOKEN",
    "Write ownership is absent, stale, held, or restoring"
  );
  assertContract(task2, token.contractVersion);
  assertContract(task2, claim.contractVersion);
}
function assertWriteToken(ctx, state, meta, token) {
  assertCurrentToken(ctx, state, meta, token);
  assertEntry(meta, getTask(state, token.taskId), "business-write");
}
async function addAssignment(ctx, meta, input) {
  const result = await mutateState(ctx, meta, { command: "assignment.add", input }, (state) => {
    const task2 = getTask(state, input.taskId);
    assertEntry(meta, task2, "delegate");
    assertOwner(task2, meta, input.ownerEpoch);
    const assignment2 = { ...structuredClone(input.assignment), id: randomUUID3(), status: "open" };
    task2.assignments[assignment2.id] = assignment2;
    return [assignment2.id];
  });
  return (await readState(ctx)).tasks[input.taskId].assignments[result.resourceIds[0]];
}
async function claimWork(ctx, meta, input) {
  const receipt = await mutateState(ctx, meta, { command: "work.claim", input, workspaceId: ctx.workspaceId }, (state) => {
    const task2 = getTask(state, input.taskId);
    assertEntry(meta, task2, "business-write");
    assertContract(task2, input.contractVersion);
    const assignment2 = input.assignmentId === null ? null : task2.assignments[input.assignmentId];
    const previous = state.claims[ctx.workspaceId];
    const key = executionKey(input.taskId, input.assignmentId);
    const same = previous?.state === "writer" && previous.instanceId === meta.actor.instanceId && previous.taskId === input.taskId && previous.assignmentId === input.assignmentId && previous.epoch === state.epochs[key];
    if (same && previous.contractVersion === input.contractVersion) return [ctx.workspaceId, String(previous.epoch)];
    if (!same) assertWorkspaceClaimable(state, ctx.workspaceId);
    if (input.assignmentId !== null) requireThat(assignment2?.status === "open" && assignment2.businessWrite && (assignment2.assignee === null || assignment2.assignee === meta.actor.instanceId), "ASSIGNMENT_NOT_GRANTED", "Assignment is not granted to this writer");
    else requireThat(same || task2.owner.instanceId === meta.actor.instanceId, "ASSIGNMENT_NOT_GRANTED", "Only the owner or current handed-off writer can claim unassigned implementation");
    requireThat(!Object.values(state.claims).some((c) => c.workspaceId !== ctx.workspaceId && c.taskId === input.taskId && c.assignmentId === input.assignmentId && ["writer", "restore-target"].includes(c.state)), "WORKSPACE_OCCUPIED", "Execution is occupied in another workspace");
    const epoch = (state.epochs[key] ?? 0) + 1;
    state.epochs[key] = epoch;
    state.claims[ctx.workspaceId] = { ...input, workspaceId: ctx.workspaceId, instanceId: meta.actor.instanceId, epoch, state: "writer", recovery: null };
    return [ctx.workspaceId, String(epoch)];
  });
  const token = { ...input, workspaceId: ctx.workspaceId, instanceId: meta.actor.instanceId, epoch: Number(receipt.resourceIds[1]) };
  assertWriteToken(ctx, await readState(ctx), meta, token);
  return token;
}
function toWriteToken(claim) {
  const { taskId, assignmentId, workspaceId, instanceId, epoch, contractVersion } = claim;
  return { taskId, assignmentId, workspaceId, instanceId, epoch, contractVersion };
}
async function releaseWork(ctx, meta, token) {
  tokenRule(token);
  await mutateState(ctx, meta, { command: "work.release", token }, (state) => {
    assertEntry(meta, getTask(state, token.taskId, false), "state-write");
    const claim = state.claims[ctx.workspaceId];
    requireThat(
      claim?.state === "writer" && claim.instanceId === meta.actor.instanceId && claim.instanceId === token.instanceId && token.workspaceId === ctx.workspaceId && claim.taskId === token.taskId && claim.assignmentId === token.assignmentId && claim.epoch === token.epoch,
      "STALE_WRITE_TOKEN",
      "Cannot release a different, held, or restoring writer"
    );
    state.claims[ctx.workspaceId] = { ...claim, state: "released", recovery: null };
    return [ctx.workspaceId];
  });
}
var init_ownership = __esm({
  "src/kernel/ownership.ts"() {
    "use strict";
    init_errors();
    init_store();
    init_policy();
    init_schema();
  }
});

// src/kernel/snapshots.ts
var snapshots_exports = {};
__export(snapshots_exports, {
  captureSnapshot: () => captureSnapshot,
  compareSnapshot: () => compareSnapshot,
  fingerprintSnapshot: () => fingerprintSnapshot,
  loadSnapshot: () => loadSnapshot,
  restoreSnapshot: () => restoreSnapshot,
  validateSnapshotContents: () => validateSnapshotContents
});
import { createHash as createHash2, randomUUID as randomUUID4 } from "node:crypto";
import { lstat as lstat2, readFile as readFile2, mkdir as mkdir2, unlink as unlink2, chmod, open as open2, rename as rename2 } from "node:fs/promises";
import { dirname as dirname2, join as join3 } from "node:path";
function fingerprintSnapshot(baseCommit, scope, entries) {
  return hash2(canonicalJson({ baseCommit, scope, entries }));
}
function safeInput(path) {
  pathRule(path);
  requireThat(!path.split("/").some((p) => [".git", ".vinea", ".ssh", ".aws", "credentials"].includes(p) || /^\.env(?:\.|$)/.test(p) || /\.(?:pem|key|p12|pfx)$/i.test(p)), "SENSITIVE_INPUT", "Sensitive or managed paths cannot be snapshotted");
}
async function head(ctx) {
  try {
    return (await gitOutput(ctx.worktreeRoot, ["rev-parse", "--verify", "HEAD"])).trim();
  } catch {
    return null;
  }
}
async function collect(ctx, scope, limits) {
  scope.forEach(safeInput);
  for (const path of scope) await safePath(ctx.worktreeRoot, join3(ctx.worktreeRoot, path));
  const baseCommit = await head(ctx);
  const currentPaths = await gitOutput(ctx.worktreeRoot, ["--literal-pathspecs", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...scope]);
  const baselinePaths = baseCommit === null ? "" : await gitOutput(ctx.worktreeRoot, ["--literal-pathspecs", "ls-tree", "-r", "-z", "--name-only", baseCommit, "--", ...scope]);
  const names = [...new Set([...currentPaths.split("\0"), ...baselinePaths.split("\0")].filter(Boolean))].sort();
  requireThat(names.length <= limits.maxFiles, "SNAPSHOT_LIMIT", "Snapshot file limit exceeded");
  const entries = [], blobs = /* @__PURE__ */ new Map();
  let bytes = 0;
  for (const path of names) {
    safeInput(path);
    const target = await safePath(ctx.worktreeRoot, join3(ctx.worktreeRoot, path));
    try {
      const info = await lstat2(target);
      requireThat(info.isFile(), "UNSAFE_PATH", "Snapshot inputs must be regular files");
      requireThat(info.size <= limits.maxFileBytes && bytes + info.size <= limits.maxTotalBytes, "SNAPSHOT_LIMIT", "Snapshot byte limit exceeded");
      const contents = await readFile2(target);
      bytes += contents.length;
      requireThat(contents.length <= limits.maxFileBytes && bytes <= limits.maxTotalBytes, "SNAPSHOT_LIMIT", "Input grew beyond snapshot limit");
      requireThat(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(contents.toString("utf8")), "SENSITIVE_INPUT", "Private key material cannot be snapshotted");
      const sha256 = hash2(contents);
      blobs.set(sha256, contents);
      entries.push({ path, kind: "file", sha256, mode: info.mode & 73 ? "100755" : "100644" });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      entries.push({ path, kind: "deleted", sha256: null, mode: null });
    }
  }
  return { baseCommit, entries, blobs, fingerprint: fingerprintSnapshot(baseCommit, scope, entries) };
}
async function captureSnapshot(ctx, meta, input) {
  assertPersistence(meta);
  const state = await readState(ctx), task2 = getTask(state, input.taskId);
  assertEntry(meta, task2, "state-write");
  if (input.token) assertWriteToken(ctx, state, meta, input.token);
  requireThat(Array.isArray(input.paths) && input.paths.length > 0, "SNAPSHOT_SCOPE_REQUIRED", "Explicit snapshot scope is required");
  const request = { command: "snapshot.capture", input, workspaceId: ctx.workspaceId };
  const previous = await lookupOperation(ctx, meta, request);
  if (previous) return (await readState(ctx)).snapshots[previous.resourceIds[0]];
  const scope = [...new Set(input.paths)].sort(), limits = input.limits ?? defaults;
  requireThat(Object.values(limits).every((n) => Number.isSafeInteger(n) && n > 0), "SNAPSHOT_LIMIT", "Limits must be positive integers");
  requireThat(Object.keys(defaults).every((key) => limits[key] <= defaults[key]), "SNAPSHOT_LIMIT", "Custom limits may tighten, not exceed, the recovery limits");
  const first = await collect(ctx, scope, limits), second = await collect(ctx, scope, limits);
  requireThat(first.fingerprint === second.fingerprint, "SNAPSHOT_CHANGED", "Inputs changed during capture");
  const snapshot2 = {
    id: randomUUID4(),
    fingerprint: first.fingerprint,
    baseCommit: first.baseCommit,
    scope,
    entries: first.entries,
    workspaceId: ctx.workspaceId,
    createdBy: meta.actor.instanceId,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  for (const [sha, bytes] of first.blobs) await writeManaged(ctx, meta, `blobs/${sha}`, bytes, true);
  await writeJson(ctx, meta, `snapshots/${snapshot2.id}.json`, snapshot2, true);
  const receipt = await mutateState(ctx, meta, request, (current) => {
    assertEntry(meta, getTask(current, input.taskId), "state-write");
    if (input.token) assertWriteToken(ctx, current, meta, input.token);
    current.snapshots[snapshot2.id] = snapshot2;
    return [snapshot2.id];
  });
  return (await readState(ctx)).snapshots[receipt.resourceIds[0]];
}
async function compareSnapshot(ctx, snapshot2) {
  snapshotRule(snapshot2);
  const now = await collect(ctx, snapshot2.scope, defaults);
  const previous = new Map(snapshot2.entries.map((e) => [e.path, canonicalJson(e)]));
  const next = new Map(now.entries.map((e) => [e.path, canonicalJson(e)]));
  const changedPaths = [.../* @__PURE__ */ new Set([...previous.keys(), ...next.keys()])].filter((p) => previous.get(p) !== next.get(p));
  return {
    matches: snapshot2.fingerprint === now.fingerprint,
    changedPaths,
    missingInputs: now.baseCommit !== snapshot2.baseCommit ? ["Git baseline changed"] : []
  };
}
async function loadSnapshot(ctx, snapshotId) {
  id(snapshotId);
  const snapshot2 = (await readState(ctx)).snapshots[snapshotId];
  requireThat(snapshot2, "SNAPSHOT_UNAVAILABLE", "Snapshot is not admitted in the shared store");
  return validateSnapshotContents(ctx, snapshot2);
}
async function validateSnapshotContents(ctx, snapshot2) {
  try {
    const manifest = JSON.parse((await readManaged(ctx, `snapshots/${snapshot2.id}.json`)).toString("utf8"));
    snapshotRule(manifest);
    requireThat(canonicalJson(manifest) === canonicalJson(snapshot2), "SNAPSHOT_UNAVAILABLE", "Snapshot manifest changed");
    requireThat(fingerprintSnapshot(snapshot2.baseCommit, snapshot2.scope, snapshot2.entries) === snapshot2.fingerprint, "SNAPSHOT_UNAVAILABLE", "Snapshot fingerprint is invalid");
    for (const entry of snapshot2.entries) if (entry.sha256) {
      requireThat(
        hash2(await readManaged(ctx, `blobs/${entry.sha256}`)) === entry.sha256,
        "SNAPSHOT_UNAVAILABLE",
        "Snapshot content is corrupt"
      );
    }
  } catch {
    throw new KernelError("SNAPSHOT_UNAVAILABLE", "Snapshot content is missing or corrupt; no current file was substituted");
  }
  return snapshot2;
}
async function restoreSnapshot(ctx, meta, input) {
  assertPersistence(meta);
  const snapshot2 = await loadSnapshot(ctx, input.snapshotId), state = await readState(ctx), task2 = getTask(state, input.taskId);
  assertEntry(meta, task2, "business-write");
  assertContract(task2, input.token.contractVersion);
  const claim = state.claims[ctx.workspaceId];
  requireThat(claim?.state === "restore-target" && claim.recovery.snapshotId === snapshot2.id && claim.instanceId === meta.actor.instanceId && input.token.instanceId === claim.instanceId && claim.taskId === input.taskId && claim.epoch === input.token.epoch && claim.workspaceId === input.token.workspaceId && state.epochs[executionKey(claim.taskId, claim.assignmentId)] === claim.epoch, "STALE_WRITE_TOKEN", "Restore reservation is stale");
  requireThat(snapshot2.baseCommit === input.expectedTargetBase && await head(ctx) === input.expectedTargetBase, "SNAPSHOT_UNAVAILABLE", "Restore baseline is unavailable or changed");
  const contents = /* @__PURE__ */ new Map();
  for (const entry of snapshot2.entries) {
    safeInput(entry.path);
    assertWritablePath(task2, entry.path);
    await safePath(ctx.worktreeRoot, join3(ctx.worktreeRoot, entry.path));
    if (entry.sha256) {
      const bytes = await readManaged(ctx, `blobs/${entry.sha256}`);
      requireThat(hash2(bytes) === entry.sha256, "SNAPSHOT_UNAVAILABLE", "Snapshot content is missing or corrupt");
      contents.set(entry.path, bytes);
    }
  }
  const status = (await gitOutput(ctx.worktreeRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).split("\0").filter(Boolean);
  for (const line of status) {
    requireThat(line.length > 3 && !/[RC]/.test(line.slice(0, 2)), "RECOVERY_CONFLICT", "Unconfirmed rename or dirty target");
    const path = line.slice(3), expected = snapshot2.entries.find((e) => e.path === path);
    requireThat(expected, "RECOVERY_CONFLICT", "Unconfirmed target changes are preserved");
    const bytes = await readFile2(await safePath(ctx.worktreeRoot, join3(ctx.worktreeRoot, path))).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    requireThat(expected.kind === "deleted" ? bytes === null : bytes !== null && hash2(bytes) === expected.sha256, "RECOVERY_CONFLICT", "Target differs from baseline and recovery contents");
  }
  for (const entry of snapshot2.entries) {
    const file = await safePath(ctx.worktreeRoot, join3(ctx.worktreeRoot, entry.path));
    if (entry.kind === "deleted") await unlink2(file).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    else {
      await mkdir2(dirname2(file), { recursive: true });
      const tmp = `${file}.${randomUUID4()}.vinea-restore`;
      try {
        const handle = await open2(tmp, "wx", entry.mode === "100755" ? 493 : 420);
        try {
          await handle.writeFile(contents.get(entry.path));
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename2(tmp, file);
        await chmod(file, entry.mode === "100755" ? 493 : 420);
      } finally {
        await unlink2(tmp).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    }
  }
  requireThat((await compareSnapshot(ctx, snapshot2)).matches, "RECOVERY_CONFLICT", "Restored inputs do not match snapshot");
  await mutateState(ctx, { ...meta, operationId: `restore-${hash2(claim.recovery.operationId)}` }, { command: "restore.publish", input }, (current) => {
    const held = current.claims[ctx.workspaceId];
    requireThat(
      held?.state === "restore-target" && held.epoch === claim.epoch && held.instanceId === meta.actor.instanceId,
      "STALE_WRITE_TOKEN",
      "Restore ownership changed before publication"
    );
    assertContract(getTask(current, input.taskId), claim.contractVersion);
    current.claims[ctx.workspaceId] = { ...held, state: "writer", recovery: null };
    return [ctx.workspaceId];
  });
}
var defaults, hash2;
var init_snapshots = __esm({
  "src/kernel/snapshots.ts"() {
    "use strict";
    init_errors();
    init_policy();
    init_ownership();
    init_io();
    init_store();
    init_repository();
    init_schema();
    defaults = { maxFiles: 2e3, maxTotalBytes: 64 * 1024 * 1024, maxFileBytes: 8 * 1024 * 1024 };
    hash2 = (bytes) => createHash2("sha256").update(bytes).digest("hex");
  }
});

// src/kernel/store.ts
import { mkdir as mkdir3, lstat as lstat3, rmdir, unlink as unlink3, readdir } from "node:fs/promises";
import { join as join4 } from "node:path";
import { createHash as createHash3, randomUUID as randomUUID5 } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
async function initializeStore(ctx, meta, decision) {
  metaRule(meta);
  assertPersistence(meta);
  decisionRule(decision);
  if (!["named-entry", "named-request"].includes(meta.invocation.activation)) throw new KernelError("ACTIVATION_REQUIRED", "Explicit Vinea activation required");
  if (["orient", "doctor"].includes(meta.invocation.entry)) throw new KernelError("ENTRY_SCOPE_DENIED", "This entry cannot initialize storage");
  const root = await storagePath(ctx, ".");
  try {
    await mkdir3(root);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    await readState(ctx);
    return;
  }
  const state = {
    kernelSchemaVersion: 1,
    repositoryId: randomUUID5(),
    revision: 0,
    tasks: {},
    claims: {},
    epochs: {},
    snapshots: {},
    operations: {}
  };
  assertRepositoryState(state);
  await writeJson(ctx, meta, "tasks/state.json", state);
}
async function readState(ctx) {
  try {
    const state = JSON.parse((await readManaged(ctx, "tasks/state.json")).toString("utf8"));
    assertRepositoryState(state);
    return state;
  } catch (error) {
    if (error instanceof KernelError && error.code === "UNSAFE_PATH") throw error;
    if (error.code === "ENOENT") {
      const exists = await lstat3(await storagePath(ctx, ".")).then(() => true, (e) => {
        if (e.code === "ENOENT") return false;
        throw e;
      });
      throw new KernelError(exists ? "INCOMPLETE_INITIALIZATION" : "STORE_MISSING", "Shared store is unavailable; no replacement was created");
    }
    throw new KernelError("STATE_INVALID", "Shared state is malformed or unsupported; it was not repaired");
  }
}
async function withLock(ctx, meta, operation) {
  assertPersistence(meta);
  const path = await storagePath(ctx, "runtime/store.lock");
  await mkdir3(await storagePath(ctx, "runtime"), { recursive: true });
  const deadline = Date.now() + 5e3;
  for (; ; ) {
    await storagePath(ctx, "runtime/store.lock");
    try {
      await mkdir3(path);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new KernelError("STORE_LOCKED", "Store is busy; locks are never automatically stolen");
      await delay(10);
    }
  }
  try {
    await writeJson(ctx, meta, "runtime/store.lock/owner.json", { pid: process.pid, token: randomUUID5(), createdAt: (/* @__PURE__ */ new Date()).toISOString() });
    return await operation();
  } finally {
    await unlink3(join4(path, "owner.json")).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rmdir(path);
  }
}
async function mutateState(ctx, meta, request, change) {
  metaRule(meta);
  assertPersistence(meta);
  if (meta.invocation.activation === "none") throw new KernelError("ACTIVATION_REQUIRED", "Explicit Vinea activation is required before any write");
  await readState(ctx);
  const requestHash = createHash3("sha256").update(canonicalJson({ request, actor: meta.actor, invocation: meta.invocation })).digest("hex");
  return withLock(ctx, meta, async () => {
    const before = await readState(ctx), previous = before.operations[meta.operationId];
    if (previous) {
      if (previous.requestHash !== requestHash) throw new KernelError("OPERATION_ID_REUSED", "Operation payload or actor differs");
      return previous;
    }
    const state = structuredClone(before);
    const resourceIds = change(state);
    state.revision = before.revision + 1;
    const receipt = { operationId: meta.operationId, requestHash, revision: state.revision, resourceIds };
    state.operations[meta.operationId] = receipt;
    assertRepositoryState(state);
    await writeJson(ctx, meta, "tasks/state.json", state);
    return receipt;
  });
}
async function lookupOperation(ctx, meta, request) {
  metaRule(meta);
  assertPersistence(meta);
  const previous = (await readState(ctx)).operations[meta.operationId];
  if (previous && previous.requestHash !== createHash3("sha256").update(canonicalJson({ request, actor: meta.actor, invocation: meta.invocation })).digest("hex")) {
    throw new KernelError("OPERATION_ID_REUSED", "Operation payload or actor differs");
  }
  return previous;
}
async function inspectStore(ctx) {
  const issues = [];
  let status = "ready";
  let state;
  try {
    state = await readState(ctx);
  } catch (error) {
    const e = error;
    status = e.code === "STORE_MISSING" ? "missing" : e.code === "INCOMPLETE_INITIALIZATION" ? "incomplete" : "invalid";
    issues.push({ code: e.code, path: ctx.storeRoot, message: e.message });
  }
  if (status !== "ready") return { status, issues };
  const { validateSnapshotContents: validateSnapshotContents2 } = await Promise.resolve().then(() => (init_snapshots(), snapshots_exports));
  for (const snapshot2 of Object.values(state.snapshots)) {
    try {
      await validateSnapshotContents2(ctx, snapshot2);
    } catch {
      status = "invalid";
      issues.push({ code: "SNAPSHOT_UNAVAILABLE", path: `snapshots/${snapshot2.id}.json`, message: "Admitted snapshot content is missing or invalid; no replacement was made" });
    }
  }
  for (const task2 of Object.values(state.tasks)) for (const evidence2 of Object.values(task2.evidence)) {
    if (evidence2.artifactId) {
      const path = `artifacts/${evidence2.artifactId}/result.json`;
      try {
        const artifact = JSON.parse((await readManaged(ctx, path)).toString("utf8"));
        if (artifact.snapshotId !== evidence2.snapshotId || artifact.code !== evidence2.exitCode || canonicalJson(artifact.argv) !== canonicalJson(evidence2.argv) || canonicalJson(artifact.environment) !== canonicalJson(evidence2.environment)) throw new Error("mismatch");
      } catch {
        status = "invalid";
        issues.push({ code: "ARTIFACT_UNAVAILABLE", path, message: "Evidence artifact is missing or invalid" });
      }
    }
  }
  try {
    await (await Promise.resolve().then(() => (init_sessions(), sessions_exports))).readBindings(ctx);
  } catch {
    status = "invalid";
    issues.push({ code: "BINDING_INVALID", path: "runtime/bindings", message: "Binding data is invalid; durable ownership was not changed" });
  }
  try {
    const entries = await readdir(await storagePath(ctx, "runtime/store.lock"));
    if (status === "ready") status = "locked";
    issues.push({ code: "STORE_LOCKED", path: "runtime/store.lock", message: `Lock present (${entries.length} files); inspect the owner before manual recovery` });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { status, issues };
}
var init_store = __esm({
  "src/kernel/store.ts"() {
    "use strict";
    init_errors();
    init_schema();
    init_io();
    init_io();
  }
});

// src/kernel/sessions.ts
var sessions_exports = {};
__export(sessions_exports, {
  bindSession: () => bindSession,
  readBindings: () => readBindings,
  resolveActor: () => resolveActor
});
import { createHash as createHash4 } from "node:crypto";
import { readdir as readdir2 } from "node:fs/promises";
async function readBindings(ctx) {
  let names;
  try {
    names = await readdir2(await storagePath(ctx, "runtime/bindings"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const out = [];
  for (const name of names.sort()) {
    requireThat(/^[a-f0-9]{64}\.json$/.test(name), "BINDING_INVALID", "Unexpected binding artifact");
    const value = JSON.parse((await readManaged(ctx, `runtime/bindings/${name}`)).toString("utf8"));
    bindingRule(value);
    out.push(value);
  }
  return out;
}
async function resolveActor(ctx, selector) {
  requireThat(typeof selector.host === "string" && !!selector.host.trim(), "ACTOR_RESOLUTION_REQUIRED", "Host is required");
  requireThat(!(selector.newInstance && selector.instanceId), "ACTOR_IDENTITY_MISMATCH", "New and existing identities cannot be combined");
  const all = await readBindings(ctx);
  const matches = all.filter((b) => b.actor.host === selector.host && !!selector.hostSessionId && b.actor.hostSessionId === selector.hostSessionId);
  const ids = new Set(matches.map((b) => b.actor.instanceId));
  requireThat(ids.size <= 1, "ACTOR_IDENTITY_MISMATCH", "Host session has ambiguous instances");
  if (selector.instanceId) {
    id(selector.instanceId);
    const previous = all.find((b) => b.actor.instanceId === selector.instanceId)?.actor;
    requireThat(
      !previous || previous.host === selector.host && (!selector.hostSessionId || !previous.hostSessionId || previous.hostSessionId === selector.hostSessionId),
      "ACTOR_IDENTITY_MISMATCH",
      "Instance host/session differs"
    );
    requireThat(matches.every((b) => b.actor.instanceId === selector.instanceId), "ACTOR_IDENTITY_MISMATCH", "Host session belongs to another instance");
    const actor = {
      ...previous ?? {},
      instanceId: selector.instanceId,
      host: selector.host,
      ...selector.hostSessionId ? { hostSessionId: selector.hostSessionId } : {}
    };
    actorRule(actor);
    return actor;
  }
  if (matches.length) return matches[0].actor;
  if (selector.newInstance) return newActor(selector.host, selector.hostSessionId);
  throw new KernelError("ACTOR_RESOLUTION_REQUIRED", "Reuse the echoed instance ID, resolve a real host session, or explicitly open a new instance");
}
async function bindSession(ctx, meta, input) {
  const task2 = getTask(await readState(ctx), input.taskId, false);
  requireThat(input.assignmentId === null || task2.assignments[input.assignmentId], "ASSIGNMENT_NOT_FOUND", "Assignment does not exist");
  const binding = { actor: meta.actor, workspaceId: ctx.workspaceId, ...input };
  bindingRule(binding);
  if (meta.invocation.persist) {
    assertEntry(meta, task2, "state-write");
    const hash3 = createHash4("sha256").update(JSON.stringify([meta.actor.instanceId, ctx.workspaceId])).digest("hex");
    await writeJson(ctx, meta, `runtime/bindings/${hash3}.json`, binding);
  }
  return binding;
}
var bindingRule;
var init_sessions = __esm({
  "src/kernel/sessions.ts"() {
    "use strict";
    init_errors();
    init_schema();
    init_policy();
    init_repository();
    init_store();
    init_io();
    bindingRule = object({ actor: actorRule, workspaceId: id, taskId: id, assignmentId: nullable(id) });
  }
});

// src/cli.ts
init_repository();
init_errors();
init_io();
import { parseArgs } from "node:util";
import { readFile as readFile4 } from "node:fs/promises";
import { resolve as resolve4 } from "node:path";
import { fileURLToPath } from "node:url";

// src/application.ts
init_sessions();
init_store();
init_policy();

// src/legacy/read.ts
init_io();
init_schema();
import { readdir as readdir3, readFile as readFile3, lstat as lstat4 } from "node:fs/promises";
import { join as join5, resolve as resolve3, relative as relative2 } from "node:path";
import { createHash as createHash5 } from "node:crypto";
function issueCode(error) {
  const code = error?.code;
  if (typeof code === "string" && /^[A-Z_]+$/.test(code)) return code;
  const message = error instanceof Error ? error.message : "";
  return /^LEGACY_[A-Z_]+$/.test(message) ? message : "LEGACY_INVALID";
}
async function inspectLegacy(sourceRoot) {
  const root = resolve3(sourceRoot), files = /* @__PURE__ */ new Map(), records = [], issues = [];
  let total = 0;
  async function read(path) {
    await safePath(root, path);
    const info = await lstat4(path);
    if (!info.isFile() || info.size > 4 * 1024 * 1024 || (total += info.size) > 32 * 1024 * 1024) throw new Error("LEGACY_LIMIT");
    const bytes = await readFile3(path);
    files.set(relative2(root, path), bytes);
    return bytes;
  }
  try {
    const config = record(JSON.parse((await read(join5(root, "config.json"))).toString()));
    if (![1, 2].includes(config.schemaVersion)) throw new Error("LEGACY_SCHEMA_UNSUPPORTED");
    const walk = async (directory) => {
      await safePath(root, directory);
      const children = await readdir3(directory, { withFileTypes: true }).catch((e) => {
        if (e.code === "ENOENT") return [];
        throw e;
      });
      if (children.some((e) => e.name === "task.json")) {
        try {
          const bytes = await read(join5(directory, "task.json")), task2 = record(JSON.parse(bytes.toString()));
          if (![1, 2].includes(task2.schemaVersion)) throw new Error("LEGACY_SCHEMA_UNSUPPORTED");
          text(task2.id);
          text(task2.title);
          text(task2.status);
          let evidence2 = [];
          if (children.some((e) => e.name === "evidence.jsonl")) evidence2 = (await read(join5(directory, "evidence.jsonl"))).toString().split("\n").filter(Boolean).map((line) => JSON.parse(line));
          const constraints = Array.isArray(task2.requirements) ? task2.requirements.map((r) => record(r).text).filter((t) => typeof t === "string" && !!t.trim()) : [];
          for (const entry of children) if (entry.isFile() && !["task.json", "evidence.jsonl"].includes(entry.name)) await read(join5(directory, entry.name));
          const journal = files.get(relative2(root, join5(directory, "journal.md")))?.toString() ?? "";
          const pending = /* @__PURE__ */ new Set();
          for (const line of journal.split("\n").filter((l) => l.trim().startsWith("{"))) {
            const event = record(JSON.parse(line));
            if (typeof event.operationId === "string") {
              if (String(event.type).endsWith("_intent")) pending.add(event.operationId);
              else pending.delete(event.operationId);
            }
          }
          if (pending.size) throw new Error("LEGACY_PENDING_MUTATION");
          records.push({
            path: directory,
            fingerprint: createHash5("sha256").update(bytes).digest("hex"),
            originalId: task2.id,
            originalStatus: task2.status,
            title: task2.title,
            goal: constraints.join("\n") || task2.title,
            constraints,
            historicalEvidence: evidence2,
            quality: task2.qualityMode === "tdd" ? "tdd" : "standard"
          });
        } catch (error) {
          issues.push({ path: directory, code: issueCode(error) });
        }
      }
      for (const child of children) {
        if (child.isSymbolicLink()) {
          issues.push({ path: join5(directory, child.name), code: "UNSAFE_PATH" });
          continue;
        }
        if (child.isDirectory()) await walk(join5(directory, child.name));
      }
    };
    await walk(join5(root, "tasks", "active"));
    await walk(join5(root, "tasks", "archive"));
    const migration = join5(root, ".runtime", "schema-migration.json");
    try {
      const value = record(JSON.parse((await read(migration)).toString()));
      if (value.phase === "intent") issues.push({ path: migration, code: "LEGACY_PENDING_MIGRATION" });
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  } catch (error) {
    issues.push({ path: root, code: issueCode(error) });
  }
  const fingerprints = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, createHash5("sha256").update(bytes).digest("hex")]);
  return { records, fingerprint: createHash5("sha256").update(canonicalJson(fingerprints)).digest("hex"), issues };
}

// src/application.ts
init_schema();

// src/cli/commands.ts
init_store();

// src/kernel/contracts.ts
init_policy();
init_schema();
init_store();
init_errors();
import { randomUUID as randomUUID6 } from "node:crypto";
function makeTask(title, draft, decision, meta) {
  return {
    id: randomUUID6(),
    title,
    status: "active",
    contracts: [{ ...structuredClone(draft), version: 1, decision }],
    owner: { instanceId: meta.actor.instanceId, epoch: 1 },
    assignments: {},
    contributions: {},
    evidence: {},
    checks: {},
    diagnostics: [],
    deliveries: {},
    userAcceptances: [],
    relatedTo: null,
    legacySource: null
  };
}
async function createGoal(ctx, meta, input) {
  assertEntry(meta, null, "business-write");
  contractDraftRule(input.contract);
  decisionRule(input.decision);
  text(input.title);
  requireThat(input.contract.acceptance.length > 0, "ACCEPTANCE_REQUIRED", "At least one acceptance criterion is required");
  const receipt = await mutateState(ctx, meta, { command: "task.create", input }, (state) => {
    const task2 = makeTask(input.title, input.contract, input.decision, meta);
    state.tasks[task2.id] = task2;
    return [task2.id];
  });
  return (await readState(ctx)).tasks[receipt.resourceIds[0]];
}
async function reviseContract(ctx, meta, input) {
  contractDraftRule(input.contract);
  decisionRule(input.decision);
  requireThat(input.contract.acceptance.length > 0, "ACCEPTANCE_REQUIRED", "At least one acceptance criterion is required");
  const receipt = await mutateState(ctx, meta, { command: "task.revise", input }, (state) => {
    const task2 = getTask(state, input.taskId);
    assertEntry(meta, task2, "state-write");
    assertOwner(task2, meta, input.ownerEpoch);
    assertContract(task2, input.expectedVersion);
    const previous = currentContract(task2);
    const widensPaths = input.contract.grant.allowedPaths.some((path) => !previous.grant.allowedPaths.some((root) => path === root || path.startsWith(`${root}/`)));
    if (widensPaths || ["businessWrite", "delegate", "commit", "deploy"].some((key) => !previous.grant[key] && input.contract.grant[key])) {
      assertEntry(meta, null, "business-write");
    }
    task2.contracts.push({ ...structuredClone(input.contract), version: previous.version + 1, decision: input.decision });
    return [task2.id, String(previous.version + 1)];
  });
  return (await readState(ctx)).tasks[input.taskId].contracts[Number(receipt.resourceIds[1]) - 1];
}

// src/cli/commands.ts
init_ownership();

// src/kernel/continuation.ts
init_schema();
init_errors();
init_policy();
init_store();
init_ownership();
init_sessions();
init_snapshots();
init_repository();
function occupancyRef(claim) {
  const { taskId, assignmentId, workspaceId, instanceId, epoch } = claim;
  return { taskId, assignmentId, workspaceId, instanceId, epoch };
}
function sourceClaim(state, from) {
  const claim = state.claims[from.workspaceId];
  requireThat(claim && canonicalJson(occupancyRef(claim)) === canonicalJson(from), "OCCUPANCY_CHANGED", "Source occupancy changed; refresh its public reference");
  return claim;
}
async function continueGoal(ctx, meta, input) {
  metaRule(meta);
  requireThat(meta.invocation.activation !== "none", "ACTIVATION_REQUIRED", "Continuation must be explicitly requested or bound");
  const state = await readState(ctx), task2 = getTask(state, input.taskId);
  const binding = await bindSession(ctx, meta, input), missing = [];
  let writeToken = null;
  const mine = state.claims[ctx.workspaceId];
  if (mine?.instanceId === meta.actor.instanceId && mine.taskId === input.taskId && mine.assignmentId === input.assignmentId) {
    try {
      assertWriteToken(ctx, state, meta, toWriteToken(mine));
      writeToken = toWriteToken(mine);
    } catch (error) {
      missing.push(error.code);
    }
  }
  const occupiedWrites = Object.values(state.claims).filter((c) => c.state !== "released" && (c.taskId === task2.id || c.workspaceId === ctx.workspaceId)).map((c) => ({ ref: occupancyRef(c), state: c.state, contractVersion: c.contractVersion }));
  if (occupiedWrites.some((c) => c.state === "unknown-writer-hold")) missing.push("UNKNOWN_WRITER_HOLD");
  return {
    taskId: task2.id,
    contract: currentContract(task2),
    owner: task2.owner,
    binding,
    writeToken,
    assignment: input.assignmentId ? task2.assignments[input.assignmentId] : null,
    occupiedWrites,
    diagnostics: task2.diagnostics.slice(-20),
    pendingContributionIds: Object.values(task2.contributions).filter((c) => !c.integrated).map((c) => c.id),
    evidenceIds: Object.values(task2.evidence).sort((a, b) => a.sequence - b.sequence).slice(-20).map((e) => e.id),
    missing,
    nextCursor: state.revision,
    unchanged: input.afterRevision === state.revision
  };
}
function transferAuthority(state, meta, input) {
  const task2 = getTask(state, input.from.taskId);
  assertEntry(meta, task2, "business-write");
  assertContract(task2, input.contractVersion);
  actorRule(input.to);
  if (input.decision) decisionRule(input.decision);
  requireThat(input.decision || input.from.instanceId === meta.actor.instanceId, "TRANSFER_DECISION_REQUIRED", "Transferring another instance requires a user decision");
  if (input.to.instanceId !== meta.actor.instanceId) requireThat(
    input.decision || currentContract(task2).grant.delegate,
    "TRANSFER_DECISION_REQUIRED",
    "Handing work to another actor requires authorized collaboration or a user decision"
  );
  if (input.transferOwner) {
    requireThat(input.ownerEpoch === task2.owner.epoch, "OWNER_CHANGED", "Delivery owner changed");
    requireThat(task2.owner.instanceId === meta.actor.instanceId || input.decision, "TRANSFER_DECISION_REQUIRED", "A contributor cannot transfer delivery responsibility without its owner or a user decision");
  } else requireThat(input.ownerEpoch === null, "OWNER_CHANGED", "Owner epoch is only used when transferring ownership");
  return task2;
}
async function handoffWork(ctx, meta, input) {
  requireThat(ctx.workspaceId === input.from.workspaceId, "ISOLATED_RECOVERY_REQUIRED", "Cross-workspace transfers use snapshot recovery");
  const receipt = await mutateState(ctx, meta, { command: "work.handoff", input }, (state) => {
    const task2 = transferAuthority(state, meta, input), old = sourceClaim(state, input.from);
    requireThat(["writer", "released"].includes(old.state), "OCCUPANCY_CHANGED", "A held or restoring workspace cannot be directly handed off");
    requireThat(old.state === "released" || old.instanceId === meta.actor.instanceId, "HOLDER_RELEASE_REQUIRED", "An active writer must hand off itself; other actors use the controlled takeover path");
    const key = executionKey(old.taskId, old.assignmentId);
    requireThat(old.epoch === state.epochs[key], "OCCUPANCY_CHANGED", "A newer executor exists");
    const epoch = old.epoch + 1;
    state.epochs[key] = epoch;
    state.claims[ctx.workspaceId] = { ...old, instanceId: input.to.instanceId, epoch, contractVersion: input.contractVersion, state: "writer", recovery: null };
    if (old.assignmentId) task2.assignments[old.assignmentId].assignee = input.to.instanceId;
    if (input.transferOwner) task2.owner = { instanceId: input.to.instanceId, epoch: task2.owner.epoch + 1 };
    return [ctx.workspaceId, String(epoch)];
  });
  const token = { ...input.from, instanceId: input.to.instanceId, epoch: Number(receipt.resourceIds[1]), contractVersion: input.contractVersion };
  assertWriteToken(ctx, await readState(ctx), { ...meta, actor: input.to }, token);
  return token;
}
async function takeoverWork(ctx, meta, input) {
  one("holder-release", "host-stop-receipt", "user-declared-stop", "unknown")(input.stopBasis);
  requireThat(input.to.instanceId === meta.actor.instanceId, "TRANSFER_DECISION_REQUIRED", "The receiving executor performs its own recovery");
  decisionRule(input.decision);
  const isolated = input.from.workspaceId !== ctx.workspaceId;
  if (input.stopBasis === "unknown") requireThat(isolated && input.baselineSnapshotId, "ISOLATED_RECOVERY_REQUIRED", "Unknown writer requires an isolated snapshot target");
  if (input.stopBasis === "host-stop-receipt") requireThat(input.stopReference, "STOP_EVIDENCE_REQUIRED", "A real stop receipt is required");
  const request = { command: "work.takeover", input, workspaceId: ctx.workspaceId };
  const previous = await lookupOperation(ctx, meta, request);
  if (!previous) {
    if (isolated) {
      requireThat(input.baselineSnapshotId, "SNAPSHOT_UNAVAILABLE", "An isolated target needs a complete snapshot");
      const snapshot2 = await loadSnapshot(ctx, input.baselineSnapshotId);
      const task2 = getTask(await readState(ctx), input.from.taskId);
      snapshot2.entries.forEach((e) => assertWritablePath(task2, e.path));
      requireThat(!await gitOutput(ctx.worktreeRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]), "RECOVERY_CONFLICT", "Target has unconfirmed changes");
      const base = await gitOutput(ctx.worktreeRoot, ["rev-parse", "--verify", "HEAD"]).then((s) => s.trim(), () => null);
      requireThat(base === snapshot2.baseCommit, "SNAPSHOT_UNAVAILABLE", "Target baseline differs");
    }
    await mutateState(ctx, meta, request, (state2) => {
      const task2 = transferAuthority(state2, meta, input), old = sourceClaim(state2, input.from);
      requireThat(["writer", "restore-target", "released"].includes(old.state), "OCCUPANCY_CHANGED", "Only the current executor can be replaced");
      const key = executionKey(old.taskId, old.assignmentId);
      requireThat(old.epoch === state2.epochs[key], "OCCUPANCY_CHANGED", "Executor changed before takeover");
      if (isolated) assertWorkspaceClaimable(state2, ctx.workspaceId);
      if (input.stopBasis === "holder-release") requireThat(old.state === "released", "STOP_EVIDENCE_REQUIRED", "Holder has not released the workspace");
      const epoch = old.epoch + 1;
      state2.epochs[key] = epoch;
      state2.claims[old.workspaceId] = input.stopBasis === "unknown" ? { ...old, state: "unknown-writer-hold" } : { ...old, state: "released", recovery: null };
      const token2 = { ...toWriteToken(old), workspaceId: ctx.workspaceId, instanceId: input.to.instanceId, epoch, contractVersion: input.contractVersion };
      state2.claims[ctx.workspaceId] = isolated ? { ...token2, state: "restore-target", recovery: { snapshotId: input.baselineSnapshotId, operationId: meta.operationId } } : { ...token2, state: "writer", recovery: null };
      if (old.assignmentId) task2.assignments[old.assignmentId].assignee = input.to.instanceId;
      if (input.transferOwner) task2.owner = { instanceId: input.to.instanceId, epoch: task2.owner.epoch + 1 };
      return [ctx.workspaceId, String(epoch)];
    });
  }
  const state = await readState(ctx), claim = state.claims[ctx.workspaceId];
  const receipt = state.operations[meta.operationId];
  requireThat(claim && claim.instanceId === meta.actor.instanceId && claim.epoch === Number(receipt.resourceIds[1]) && ["writer", "restore-target"].includes(claim.state), "OCCUPANCY_CHANGED", "Recovery target changed");
  if (claim.state === "restore-target") {
    const snapshot2 = await loadSnapshot(ctx, claim.recovery.snapshotId);
    await restoreSnapshot(ctx, meta, { taskId: claim.taskId, snapshotId: snapshot2.id, token: toWriteToken(claim), expectedTargetBase: snapshot2.baseCommit });
  }
  const token = toWriteToken(claim);
  assertWriteToken(ctx, await readState(ctx), meta, token);
  return token;
}
async function clearWorkspaceHold(ctx, meta, input) {
  one("holder-release", "host-stop-receipt", "user-declared-stop")(input.stopBasis);
  await mutateState(ctx, meta, { command: "work.clear-hold", input }, (state) => {
    const task2 = getTask(state, input.from.taskId, false), claim = sourceClaim(state, input.from);
    assertEntry(meta, task2, "state-write");
    requireThat(claim.state === "unknown-writer-hold", "OCCUPANCY_CHANGED", "Workspace is not an unknown writer hold");
    if (input.stopBasis === "holder-release") requireThat(meta.actor.instanceId === claim.instanceId, "STOP_EVIDENCE_REQUIRED", "Only the original holder may declare its release");
    else {
      requireThat(task2.owner.instanceId === meta.actor.instanceId || input.decision, "STOP_EVIDENCE_REQUIRED", "Current owner or user decision required");
      if (input.stopBasis === "host-stop-receipt") requireThat(input.stopReference, "STOP_EVIDENCE_REQUIRED", "Host stop receipt required");
      else {
        requireThat(input.decision, "STOP_EVIDENCE_REQUIRED", "Explicit stop decision required");
        decisionRule(input.decision);
      }
    }
    state.claims[claim.workspaceId] = { ...claim, state: "released", recovery: null };
    return [claim.workspaceId];
  });
}

// src/cli/commands.ts
init_snapshots();

// src/kernel/evidence.ts
init_errors();
init_policy();
init_schema();
init_store();
init_io();
import { randomUUID as randomUUID7 } from "node:crypto";
async function appendEvidence(ctx, meta, input, source, artifactId) {
  assertPersistence(meta);
  environmentRule(input.environment);
  one("pass", "fail", "unverified")(input.result);
  nullable(one("red", "green"))(input.phase);
  nullable(array(text))(input.argv);
  nullable(integer)(input.exitCode);
  text(input.summary);
  if (input.result === "pass" && input.exitCode !== null) requireThat(input.exitCode === 0, "EVIDENCE_INVALID", "Passing command cannot have a failing exit code");
  if (input.phase === "red") requireThat(input.result === "fail" && input.exitCode !== null && input.exitCode > 0, "EVIDENCE_INVALID", "RED needs a real nonzero failure");
  if (input.phase === "green") requireThat(input.result === "pass" && input.exitCode === 0, "EVIDENCE_INVALID", "GREEN needs exit zero");
  const receipt = await mutateState(ctx, meta, { command: "evidence.append", input, source, artifactId }, (state) => {
    const task2 = getTask(state, input.taskId);
    assertEntry(meta, task2, "state-write");
    assertContract(task2, input.contractVersion);
    requireThat(state.snapshots[input.snapshotId], "SNAPSHOT_UNAVAILABLE", "Evidence snapshot does not exist");
    const { taskId: _, ...fields } = input;
    const e = { ...fields, id: randomUUID7(), actor: meta.actor, source, artifactId, cwd: ctx.worktreeRoot, sequence: state.revision + 1 };
    task2.evidence[e.id] = e;
    return [e.id];
  });
  return (await readState(ctx)).tasks[input.taskId].evidence[receipt.resourceIds[0]];
}
async function recordReportedEvidence(ctx, meta, input) {
  return appendEvidence(ctx, meta, input, "agent-report", null);
}
async function recordUserObservation(ctx, meta, input) {
  decisionRule(input.decision);
  return appendEvidence(ctx, meta, {
    taskId: input.taskId,
    contractVersion: input.contractVersion,
    snapshotId: input.snapshotId,
    environment: input.environment,
    result: "unverified",
    phase: null,
    argv: null,
    exitCode: null,
    summary: input.decision.summary
  }, "user-observation", null);
}

// src/kernel/verification.ts
init_io();
init_schema();
init_policy();
init_store();
init_snapshots();
import { spawn } from "node:child_process";
import { randomUUID as randomUUID8, createHash as createHash6 } from "node:crypto";
init_errors();
async function runVerification(ctx, meta, input) {
  assertPersistence(meta);
  decisionRule(input.commandAuthorization);
  environmentRule(input.environment);
  array(text)(input.argv);
  nullable(one("red", "green"))(input.phase);
  id(input.taskId);
  id(input.snapshotId);
  integer(input.contractVersion);
  requireThat(input.argv.length > 0 && Number.isSafeInteger(input.timeoutMs) && input.timeoutMs > 0 && input.timeoutMs <= 36e5, "COMMAND_REQUIRED", "Command and bounded timeout required");
  requireThat(!input.argv.some((a) => /(?:Bearer\s+|(?:password|token|secret|api[_-]?key)=)/i.test(a)) && !Object.keys(input.environment.labels).some((k) => /password|token|secret|cookie|authorization|api.?key/i.test(k)), "SENSITIVE_INPUT", "Do not put credentials in recorded arguments or environment labels");
  requireThat(input.environment.runtime === process.version && input.environment.platform === process.platform, "VERIFICATION_CONDITIONS_MISMATCH", "Runtime describes the actual Node verifier; other runtimes belong in labels");
  const task2 = getTask(await readState(ctx), input.taskId);
  assertEntry(meta, task2, "state-write");
  assertContract(task2, input.contractVersion);
  const request = { command: "verify.reserve", input, workspaceId: ctx.workspaceId };
  const existing = await lookupOperation(ctx, meta, request);
  if (existing) {
    const previous = Object.values((await readState(ctx)).tasks[input.taskId].evidence).find((e) => e.artifactId === existing.resourceIds[0]);
    if (previous) return previous;
    throw new KernelError("VERIFICATION_INCOMPLETE", "The command was reserved or started; inspect its result before explicitly scheduling another attempt");
  }
  const snapshot2 = await loadSnapshot(ctx, input.snapshotId);
  requireThat((await compareSnapshot(ctx, snapshot2)).matches, "SNAPSHOT_CHANGED", "Verification inputs have changed");
  let reserved = false;
  const reservation = await mutateState(ctx, meta, request, (state) => {
    const current = getTask(state, input.taskId);
    assertEntry(meta, current, "state-write");
    assertContract(current, input.contractVersion);
    reserved = true;
    return [randomUUID8()];
  });
  requireThat(reserved, "VERIFICATION_INCOMPLETE", "Another invocation owns this verification; the command was not repeated");
  const artifactId = reservation.resourceIds[0];
  const [command, ...args] = input.argv;
  const result = await new Promise((resolve5, reject) => {
    const child = spawn(command, args, { cwd: ctx.worktreeRoot, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false, stdoutBytes = 0, stderrBytes = 0;
    let escalation;
    const stop = (signal) => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (error.code !== "ESRCH") child.kill(signal);
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stop("SIGTERM");
      escalation = setTimeout(() => stop("SIGKILL"), 250);
    }, input.timeoutMs);
    child.stdout.on("data", (b) => {
      stdoutBytes += b.length;
    });
    child.stderr.on("data", (b) => {
      stderrBytes += b.length;
    });
    child.once("error", () => {
      clearTimeout(timeout);
      if (escalation) clearTimeout(escalation);
      reject(new KernelError("COMMAND_START_FAILED", "Verifier could not start"));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (escalation) clearTimeout(escalation);
      resolve5({ code, signal, timedOut, stdoutBytes, stderrBytes });
    });
  });
  const stillMatches = await compareSnapshot(ctx, snapshot2).then((r) => r.matches, () => false);
  assertContract(getTask(await readState(ctx), input.taskId), input.contractVersion);
  const status = result.timedOut || result.signal || result.code === null || !stillMatches ? "unverified" : result.code === 0 ? "pass" : "fail";
  await writeJson(ctx, meta, `artifacts/${artifactId}/result.json`, {
    ...result,
    argv: input.argv,
    snapshotId: snapshot2.id,
    environment: input.environment,
    rawOutputStored: false
  }, true);
  return appendEvidence(ctx, { ...meta, operationId: `evidence-${createHash6("sha256").update(meta.operationId).digest("hex")}` }, {
    taskId: input.taskId,
    contractVersion: input.contractVersion,
    snapshotId: snapshot2.id,
    result: status,
    phase: status === "unverified" ? null : input.phase,
    argv: input.argv,
    exitCode: result.code,
    environment: input.environment,
    summary: status === "unverified" ? "Command timed out, terminated, or input changed; not verified" : `Command exited ${result.code}`
  }, "command-runner", artifactId);
}

// src/kernel/contributions.ts
init_errors();
init_store();
init_policy();
init_ownership();
init_snapshots();
import { randomUUID as randomUUID9 } from "node:crypto";
async function submitContribution(ctx, meta, input) {
  const c = input.contribution;
  if (c.kind === "change") {
    requireThat(c.snapshotId && c.writeToken, "CONTRIBUTION_INVALID", "Changes require a snapshot and write token");
    const snapshot2 = await loadSnapshot(ctx, c.snapshotId);
    requireThat(
      snapshot2.workspaceId === ctx.workspaceId && (await compareSnapshot(ctx, snapshot2)).matches,
      "SNAPSHOT_CHANGED",
      "Contribution must describe this workspace's current inputs"
    );
  }
  const receipt = await mutateState(ctx, meta, { command: "contribution.submit", input }, (state) => {
    const task2 = getTask(state, input.taskId);
    assertEntry(meta, task2, "state-write");
    assertContract(task2, c.contractVersion);
    if (c.kind === "change") {
      requireThat(c.writeToken && c.writeToken.taskId === task2.id && c.writeToken.assignmentId === c.assignmentId, "CONTRIBUTION_INVALID", "Contribution and token refer to different work");
      assertWriteToken(ctx, state, meta, c.writeToken);
    }
    requireThat(c.evidenceIds.every((e) => !!task2.evidence[e]), "EVIDENCE_NOT_FOUND", "Contribution evidence is absent");
    const contribution2 = { ...structuredClone(c), id: randomUUID9(), submittedBy: meta.actor.instanceId, integrated: null };
    task2.contributions[contribution2.id] = contribution2;
    return [contribution2.id];
  });
  return (await readState(ctx)).tasks[input.taskId].contributions[receipt.resourceIds[0]];
}
async function integrateContribution(ctx, meta, input) {
  const snapshot2 = await loadSnapshot(ctx, input.snapshotId);
  requireThat((await compareSnapshot(ctx, snapshot2)).matches, "SNAPSHOT_CHANGED", "Integrated inputs have changed");
  await mutateState(ctx, meta, { command: "contribution.integrate", input }, (state) => {
    const task2 = getTask(state, input.taskId);
    assertEntry(meta, task2, "state-write");
    assertOwner(task2, meta, input.ownerEpoch);
    assertContract(task2, input.contractVersion);
    const c = task2.contributions[input.contributionId];
    requireThat(c && c.contractVersion === input.contractVersion, "EVIDENCE_VERSION_MISMATCH", "Contribution is absent or uses an older contract");
    requireThat(input.rationale.trim(), "RATIONALE_REQUIRED", "Explain the integration decision");
    c.integrated = { snapshotId: snapshot2.id, owner: { ...task2.owner }, rationale: input.rationale };
    return [c.id];
  });
  return (await readState(ctx)).tasks[input.taskId].contributions[input.contributionId];
}

// src/kernel/delivery.ts
init_errors();
init_policy();
init_store();
init_io();
init_schema();
init_snapshots();
init_ownership();
import { randomUUID as randomUUID10 } from "node:crypto";
function verifyRows(task2, version2, snapshotId, rows, verification) {
  assertContract(task2, version2);
  array(checkRowRule)(rows);
  array(verificationRule)(verification);
  const criteria = new Set(currentContract(task2).acceptance.map((c) => c.id));
  requireThat(new Set(rows.map((r) => r.acceptanceId)).size === rows.length, "CHECK_INVALID", "Duplicate acceptance rows");
  requireThat(new Set(verification.map((v) => v.evidenceId)).size === verification.length, "CHECK_INVALID", "Duplicate verification requirements");
  const expected = new Map(verification.map((v) => [v.evidenceId, v]));
  for (const row of rows) {
    requireThat(criteria.has(row.acceptanceId), "CHECK_INVALID", "Unknown acceptance criterion");
    if (row.result === "accepted-gap") requireThat(row.gapDecision, "GAP_REQUIRES_DECISION", "Accepted gap needs a user decision");
    if (row.result === "pass") requireThat(row.evidenceIds.length > 0, "PASS_REQUIRES_EVIDENCE", "Passing rows need evidence");
    for (const id2 of row.evidenceIds) {
      const e = task2.evidence[id2];
      requireThat(e, "EVIDENCE_NOT_FOUND", "Evidence is absent");
      if (row.result !== "pass") continue;
      requireThat(e.contractVersion === version2 && e.snapshotId === snapshotId, "EVIDENCE_VERSION_MISMATCH", "Evidence describes a different contract or snapshot");
      requireThat(e.result === "pass", "EVIDENCE_NOT_PASSING", "Nonpassing evidence cannot support a pass");
      const basis = expected.get(id2);
      requireThat(
        basis && canonicalJson(basis.argv) === canonicalJson(e.argv) && canonicalJson(basis.environment) === canonicalJson(e.environment),
        "VERIFICATION_CONDITIONS_MISMATCH",
        "Current command or environment differs from the evidence"
      );
    }
  }
}
async function recordCheckSet(ctx, meta, input) {
  assertPersistence(meta);
  const snapshot2 = await loadSnapshot(ctx, input.snapshotId);
  requireThat((await compareSnapshot(ctx, snapshot2)).matches, "SNAPSHOT_CHANGED", "Check inputs changed");
  const receipt = await mutateState(ctx, meta, { command: "check.record", input }, (state) => {
    const task2 = getTask(state, input.taskId);
    assertEntry(meta, task2, "state-write");
    verifyRows(task2, input.contractVersion, input.snapshotId, input.rows, input.verification);
    if (input.independent) {
      requireThat(meta.invocation.entry === "check", "CHECK_INVALID", "Independent check requires the explicit check entry");
      requireThat(input.rows.every((r) => r.evidenceIds.every((e) => task2.evidence[e].actor.instanceId === meta.actor.instanceId)), "CHECK_INVALID", "Do not relabel another assessor's evidence as your own check");
    }
    const { taskId: _, ...fields } = input;
    const checks = { ...structuredClone(fields), id: randomUUID10(), assessor: meta.actor };
    task2.checks[checks.id] = checks;
    return [checks.id];
  });
  return (await readState(ctx)).tasks[input.taskId].checks[receipt.resourceIds[0]];
}
async function finishGoal(ctx, meta, input) {
  assertPersistence(meta);
  requireThat(["run", "continue", "debug", "finish"].includes(meta.invocation.entry) && !meta.invocation.analysisOnly, "ENTRY_SCOPE_DENIED", "This entry cannot finalize delivery");
  const snapshot2 = await loadSnapshot(ctx, input.snapshotId);
  requireThat((await compareSnapshot(ctx, snapshot2)).matches, "SNAPSHOT_CHANGED", "Delivery inputs changed");
  const receipt = await mutateState(ctx, meta, { command: "finish", input }, (state) => {
    const task2 = getTask(state, input.taskId);
    assertEntry(meta, task2, "state-write");
    assertOwner(task2, meta, input.ownerEpoch);
    assertContract(task2, input.contractVersion);
    const rows = [];
    for (const id2 of input.checkSetIds) {
      const checks = task2.checks[id2];
      requireThat(checks && checks.snapshotId === input.snapshotId, "CHECK_INVALID", "A selected check describes different inputs");
      verifyRows(task2, input.contractVersion, snapshot2.id, checks.rows, input.verification);
      rows.push(...checks.rows);
    }
    requireThat(currentContract(task2).acceptance.every((a) => rows.some((r) => r.acceptanceId === a.id)), "COVERAGE_MISSING", "Acceptance criteria are not covered");
    requireThat(rows.every((r) => ["pass", "accepted-gap"].includes(r.result)), "CHECK_NOT_PASSING", "Unresolved failures or unverified results remain");
    for (const checks of Object.values(task2.checks)) if (!input.checkSetIds.includes(checks.id) && checks.snapshotId === snapshot2.id && checks.contractVersion === input.contractVersion && checks.rows.some((r) => r.result === "fail" || r.result === "unverified")) {
      requireThat(input.exclusions.some((reason) => reason.includes(checks.id)), "UNRESOLVED_CHECK", "Explain why a current unsuccessful check is not used");
    }
    for (const id2 of input.contributionIds) requireThat(
      task2.contributions[id2]?.integrated?.snapshotId === snapshot2.id,
      "CONTRIBUTION_NOT_INTEGRATED",
      "Contribution is not integrated into this snapshot"
    );
    requireThat(!Object.values(state.claims).some((c) => c.taskId === task2.id && c.workspaceId !== ctx.workspaceId && ["writer", "restore-target"].includes(c.state)), "WORKSPACE_OCCUPIED", "Another executor is still active for this task");
    const claim = state.claims[ctx.workspaceId];
    if (claim && claim.state !== "released") {
      assertCurrentToken(ctx, state, meta, toWriteToken(claim));
      requireThat(claim.taskId === task2.id, "WORKSPACE_OCCUPIED", "Another task still owns this workspace");
      state.claims[ctx.workspaceId] = { ...claim, state: "released", recovery: null };
    }
    if (currentContract(task2).quality === "tdd") {
      const evidence2 = Object.values(task2.evidence).filter((e) => e.contractVersion === input.contractVersion).sort((a, b) => a.sequence - b.sequence);
      const red = evidence2.find((e) => e.phase === "red" && e.result === "fail" && e.exitCode !== null && e.exitCode > 0);
      requireThat(red && evidence2.some((e) => e.phase === "green" && e.result === "pass" && e.exitCode === 0 && e.sequence > red.sequence && e.snapshotId === snapshot2.id), "TDD_EVIDENCE_REQUIRED", "Current TDD evidence needs RED before GREEN");
    }
    const delivery = {
      id: randomUUID10(),
      contractVersion: input.contractVersion,
      snapshotId: snapshot2.id,
      checkSetIds: input.checkSetIds,
      contributionIds: input.contributionIds,
      exclusions: input.exclusions,
      owner: { ...task2.owner },
      acceptedGaps: rows.filter((r) => r.result === "accepted-gap").map((r) => ({ acceptanceId: r.acceptanceId, decision: r.gapDecision })),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    task2.deliveries[delivery.id] = delivery;
    task2.status = "delivered";
    return [delivery.id];
  });
  return (await readState(ctx)).tasks[input.taskId].deliveries[receipt.resourceIds[0]];
}
async function acceptDelivery(ctx, meta, input) {
  decisionRule(input.decision);
  await mutateState(ctx, meta, { command: "delivery.accept", input }, (state) => {
    const task2 = getTask(state, input.taskId, false);
    assertEntry(meta, task2, "state-write");
    requireThat(task2.deliveries[input.deliveryId], "DELIVERY_NOT_FOUND", "Delivery is absent");
    task2.userAcceptances.push({ deliveryId: input.deliveryId, decision: input.decision, actor: meta.actor, recordedAt: (/* @__PURE__ */ new Date()).toISOString() });
    return [input.deliveryId];
  });
}
async function archiveGoal(ctx, meta, input) {
  decisionRule(input.decision);
  await mutateState(ctx, meta, { command: "archive", input }, (state) => {
    const task2 = getTask(state, input.taskId, false);
    assertEntry(meta, task2, "state-write");
    requireThat(task2.owner.instanceId === meta.actor.instanceId && task2.status === "delivered", "ARCHIVE_NOT_READY", "Only the owner can archive a delivered task");
    requireThat(!Object.values(state.claims).some((c) => c.taskId === task2.id && ["writer", "restore-target"].includes(c.state)), "WORKSPACE_OCCUPIED", "An executor is still active");
    task2.status = "archived";
    return [task2.id];
  });
}

// src/kernel/debug.ts
init_store();
init_policy();
init_schema();
import { randomUUID as randomUUID11 } from "node:crypto";
init_errors();
async function recordDiagnostic(ctx, meta, input) {
  text(input.text);
  array(id)(input.evidenceIds);
  one("fact", "hypothesis", "ruled-out", "change", "validation-gap")(input.kind);
  const receipt = await mutateState(ctx, meta, { command: "debug.record", input }, (state) => {
    const task2 = getTask(state, input.taskId);
    assertEntry(meta, task2, "state-write");
    requireThat(input.evidenceIds.every((e) => !!task2.evidence[e]), "EVIDENCE_NOT_FOUND", "Diagnostic evidence is absent");
    const record2 = { id: randomUUID11(), kind: input.kind, text: input.text, evidenceIds: input.evidenceIds, actor: meta.actor, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    task2.diagnostics.push(record2);
    return [record2.id];
  });
  return (await readState(ctx)).tasks[input.taskId].diagnostics.find((d) => d.id === receipt.resourceIds[0]);
}
async function openRepair(ctx, meta, input) {
  decisionRule(input.decision);
  text(input.title);
  text(input.expected);
  text(input.actual);
  requireThat(["run", "continue", "debug"].includes(meta.invocation.entry), "ENTRY_SCOPE_DENIED", "This entry cannot open repair work");
  const receipt = await mutateState(ctx, meta, { command: "debug.open", input }, (state) => {
    const source = getTask(state, input.taskId, false);
    assertEntry(meta, source, "state-write");
    let task2 = source;
    if (source.status !== "active" || input.deliveryId) {
      const candidates = Object.keys(source.deliveries);
      const deliveryId = input.deliveryId ?? (candidates.length === 1 ? candidates[0] : null);
      requireThat(deliveryId && source.deliveries[deliveryId], "DELIVERY_SELECTION_REQUIRED", "Select a real delivery to repair");
      const original = currentContract(source);
      task2 = makeTask(input.title, {
        ...structuredClone(original),
        goal: input.title,
        acceptance: [{ id: "repair", text: input.expected }],
        grant: meta.invocation.analysisOnly ? { businessWrite: false, delegate: false, commit: false, deploy: false, allowedPaths: [] } : { ...original.grant, delegate: false, commit: false, deploy: false }
      }, input.decision, meta);
      task2.relatedTo = { taskId: source.id, deliveryId };
      state.tasks[task2.id] = task2;
    }
    task2.diagnostics.push({
      id: randomUUID11(),
      kind: "fact",
      text: `Expected: ${input.expected}
Reported actual: ${input.actual}`,
      evidenceIds: [],
      actor: meta.actor,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return [task2.id];
  });
  return (await readState(ctx)).tasks[receipt.resourceIds[0]];
}

// src/legacy/import.ts
init_store();
init_io();
init_policy();
init_schema();
init_errors();
async function importLegacy(ctx, meta, input) {
  assertPersistence(meta);
  decisionRule(input.decision);
  assertEntry(meta, null, "state-write");
  const source = await inspectLegacy(input.sourceRoot);
  requireThat(source.issues.length === 0, "LEGACY_INVALID", "Legacy source has unresolved diagnostics");
  requireThat(source.fingerprint === input.expectedFingerprint, "LEGACY_SOURCE_CHANGED", "Preview and explicitly approve the current source");
  const receipt = await mutateState(ctx, meta, { command: "legacy.import", input }, (state) => source.records.map((record2) => {
    const existing = Object.values(state.tasks).find((t) => t.legacySource?.path === record2.path && t.legacySource.fingerprint === source.fingerprint);
    if (existing) return existing.id;
    const task2 = makeTask(record2.title, {
      goal: record2.goal,
      scope: [],
      constraints: record2.constraints,
      acceptance: [{ id: "review-import", text: "Review imported requirements before authorizing execution" }],
      quality: record2.quality,
      grant: { businessWrite: false, delegate: false, commit: false, deploy: false, allowedPaths: [] }
    }, input.decision, meta);
    task2.legacySource = { path: record2.path, fingerprint: source.fingerprint, originalStatus: record2.originalStatus };
    task2.diagnostics.push({
      id: `legacy-${task2.id}`,
      kind: "fact",
      text: `Imported historical task ${record2.originalId}; ${record2.historicalEvidence.length} historical evidence records remain at the source and are not current verification`,
      evidenceIds: [],
      actor: meta.actor,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    state.tasks[task2.id] = task2;
    return task2.id;
  }));
  return receipt.resourceIds;
}

// src/cli/commands.ts
init_schema();
var route = (handler, check) => ({ handler, check });
var task = { taskId: id };
var version = { ...task, contractVersion: integer };
var snapshot = { ...version, snapshotId: id };
var ref = object({ taskId: id, assignmentId: nullable(id), workspaceId: id, instanceId: id, epoch: integer });
var transfer = { from: ref, to: actorRule, contractVersion: integer, transferOwner: bool, ownerEpoch: nullable(integer), decision: nullable(decisionRule) };
var evidence = { ...snapshot, result: one("pass", "fail", "unverified"), phase: nullable(one("red", "green")), argv: nullable(array(text)), exitCode: nullable(integer), summary: text, environment: environmentRule };
var assignment = object({ outcome: text, dependsOn: array(id), assignee: nullable(id), businessWrite: bool });
var contribution = object({
  kind: one("analysis", "change"),
  assignmentId: nullable(id),
  contractVersion: integer,
  snapshotId: nullable(id),
  evidenceIds: array(id),
  summary: text,
  writeToken: nullable(tokenRule)
});
var commands = {
  "init": route(initializeStore, decisionRule),
  "task create": route(createGoal, object({ title: text, contract: contractDraftRule, decision: decisionRule })),
  "task revise": route(reviseContract, object({ ...task, expectedVersion: integer, ownerEpoch: integer, contract: contractDraftRule, decision: decisionRule })),
  "assignment add": route(addAssignment, object({ ...task, ownerEpoch: integer, assignment })),
  "continue": route(continueGoal, object({ ...task, assignmentId: nullable(id) }, { afterRevision: integer })),
  "work claim": route(claimWork, object({ ...version, assignmentId: nullable(id) })),
  "work release": route(releaseWork, tokenRule),
  "work handoff": route(handoffWork, object(transfer)),
  "work takeover": route(takeoverWork, object({
    ...transfer,
    decision: decisionRule,
    stopBasis: one("holder-release", "host-stop-receipt", "user-declared-stop", "unknown"),
    stopReference: nullable(text),
    baselineSnapshotId: nullable(id)
  })),
  "work clear-hold": route(clearWorkspaceHold, object({ from: ref, stopBasis: one("holder-release", "host-stop-receipt", "user-declared-stop"), stopReference: nullable(text), decision: nullable(decisionRule) })),
  "snapshot capture": route(captureSnapshot, object({ ...task, paths: array(text), token: nullable(tokenRule) }, { limits: object({ maxFiles: integer, maxTotalBytes: integer, maxFileBytes: integer }) })),
  "snapshot restore": route(restoreSnapshot, object({ ...task, snapshotId: id, token: tokenRule, expectedTargetBase: nullable(text) })),
  "evidence report": route(recordReportedEvidence, object(evidence)),
  "evidence observe": route(recordUserObservation, object({ ...snapshot, decision: decisionRule, environment: environmentRule })),
  "verify": route(runVerification, object({ ...snapshot, argv: array(text), phase: nullable(one("red", "green")), timeoutMs: integer, environment: environmentRule, commandAuthorization: decisionRule })),
  "contribution submit": route(submitContribution, object({ ...task, contribution })),
  "contribution integrate": route(integrateContribution, object({ ...snapshot, contributionId: id, ownerEpoch: integer, rationale: text })),
  "check record": route(recordCheckSet, object({ ...snapshot, independent: bool, rows: array(checkRowRule), verification: array(verificationRule) })),
  "finish": route(finishGoal, object({ ...snapshot, ownerEpoch: integer, checkSetIds: array(id), contributionIds: array(id), exclusions: array(text), verification: array(verificationRule) })),
  "delivery accept": route(acceptDelivery, object({ ...task, deliveryId: id, decision: decisionRule })),
  "archive": route(archiveGoal, object({ ...task, decision: decisionRule })),
  "debug open": route(openRepair, object({ ...task, deliveryId: nullable(id), title: text, expected: text, actual: text, decision: decisionRule })),
  "debug record": route(recordDiagnostic, object({ ...task, kind: one("fact", "hypothesis", "ruled-out", "change", "validation-gap"), text, evidenceIds: array(id) })),
  "legacy import": route(importLegacy, object({ sourceRoot: text, expectedFingerprint: text, decision: decisionRule }))
};

// src/application.ts
init_errors();
init_snapshots();
var selectorRule = object({ host: text }, { instanceId: id, hostSessionId: text, newInstance: bool });
var envelopeRule = object({ meta: object({ operationId: id, actor: selectorRule, invocation: invocationRule }), payload: () => {
} });
function taskSummary(task2) {
  return {
    id: task2.id,
    title: task2.title,
    status: task2.status,
    contract: currentContract(task2),
    owner: task2.owner,
    assignments: Object.values(task2.assignments),
    contributionIds: Object.keys(task2.contributions),
    evidenceIds: Object.values(task2.evidence).sort((a, b) => a.sequence - b.sequence).slice(-20).map((e) => e.id),
    checkSetIds: Object.keys(task2.checks),
    deliveryIds: Object.keys(task2.deliveries),
    userAcceptances: task2.userAcceptances,
    relatedTo: task2.relatedTo,
    legacySource: task2.legacySource,
    diagnostics: task2.diagnostics.slice(-20)
  };
}
async function executeCommand(ctx, command, envelope) {
  envelopeRule(envelope);
  requireThat(command === "session resolve" || !envelope.meta.actor.newInstance, "ACTOR_RESOLUTION_REQUIRED", "Resolve a new instance once, then reuse the returned Actor");
  const actor = await resolveActor(ctx, envelope.meta.actor), meta = { ...envelope.meta, actor };
  metaRule(meta);
  const reply = (data) => ({ actor, workspaceId: ctx.workspaceId, operationId: meta.operationId, data });
  try {
    if (command === "session resolve") {
      object({})(envelope.payload);
      return reply(actor);
    }
    requireThat(Object.hasOwn(commands, command), "COMMAND_UNKNOWN", "Unknown command; use --help");
    const entry = commands[command];
    entry.check(envelope.payload);
    if (meta.invocation.activation === "bound-followup") {
      const payload = record(envelope.payload);
      const taskId = payload.taskId ?? (payload.from ? record(payload.from).taskId : void 0);
      const bound = (await readBindings(ctx)).some((b) => b.actor.instanceId === actor.instanceId && b.workspaceId === ctx.workspaceId && b.taskId === taskId);
      requireThat(bound, "BINDING_REQUIRED", "Follow-up has no matching task binding");
    }
    let data = await entry.handler(ctx, meta, envelope.payload);
    if (command === "task create" || command === "debug open") {
      const task2 = data;
      await bindSession(ctx, meta, { taskId: task2.id, assignmentId: null });
      data = taskSummary(task2);
    }
    if (command === "snapshot capture") {
      const s = data;
      data = {
        id: s.id,
        fingerprint: s.fingerprint,
        baseCommit: s.baseCommit,
        scope: s.scope,
        entries: s.entries.length,
        manifest: `snapshots/${s.id}.json`
      };
    }
    return reply(data ?? null);
  } catch (error) {
    const known = error instanceof KernelError;
    const causeCode = error?.code;
    if (!known && command === "init" && (causeCode === "EPERM" || causeCode === "EACCES")) {
      return { ...reply(null), error: {
        code: "STORAGE_PERMISSION_DENIED",
        message: "The host denied Vinea storage access. Request access to the exact store directory; do not create alternate task state or bypass host permissions.",
        details: { storeRoot: ctx.storeRoot, causeCode }
      } };
    }
    return { ...reply(null), error: {
      code: known ? error.code : "COMMAND_FAILED",
      message: known ? error.message : "Command failed; inspect current state before retrying",
      details: known ? error.details : {}
    } };
  }
}
async function executeReadCommand(ctx, command, input) {
  let data;
  if (["doctor", "validate"].includes(command)) data = await inspectStore(ctx);
  else if (command === "snapshot show") {
    requireThat(input.resourceId, "ID_REQUIRED", "Specify --id");
    data = await loadSnapshot(ctx, input.resourceId);
  } else if (command === "legacy inspect") {
    requireThat(input.sourceRoot, "SOURCE_REQUIRED", "Specify the exact legacy source root");
    data = await inspectLegacy(input.sourceRoot);
  } else {
    const state = await readState(ctx);
    if (command === "task show") {
      requireThat(input.taskId, "TASK_REQUIRED", "Specify --task");
      data = taskSummary(getTask(state, input.taskId, false));
    } else if (["evidence show", "check show", "contribution show", "delivery show"].includes(command)) {
      requireThat(input.taskId && input.resourceId, "ID_REQUIRED", "Specify --task and --id");
      id(input.resourceId);
      const task2 = getTask(state, input.taskId, false);
      const resources = command === "evidence show" ? task2.evidence : command === "check show" ? task2.checks : command === "contribution show" ? task2.contributions : task2.deliveries;
      data = resources[input.resourceId];
      requireThat(data, "RESOURCE_NOT_FOUND", "Resource is absent in the selected task");
    } else {
      const limit = input.limit ?? 20;
      requireThat(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, "LIMIT_INVALID", "Page size must be between 1 and 100");
      if (input.after) id(input.after);
      const tasks = Object.values(state.tasks).filter((t) => !input.after || t.id > input.after).sort((a, b) => a.id < b.id ? -1 : 1);
      const page = tasks.slice(0, limit);
      data = {
        revision: state.revision,
        tasks: page.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          goal: currentContract(t).goal,
          contractVersion: currentContract(t).version,
          owner: t.owner,
          relatedTo: t.relatedTo
        })),
        nextAfter: tasks.length > limit ? page.at(-1).id : null
      };
    }
  }
  return { actor: null, workspaceId: ctx.workspaceId, operationId: null, data };
}

// src/cli.ts
var reads = ["task show", "task list", "orient", "doctor", "validate", "legacy inspect", "snapshot show", "evidence show", "check show", "contribution show", "delivery show"];
var legacy = ["propose", "migrate", "learning", "task transition", "task unblock", "task require", "task accept", "task set-plan", "task set-brief", "task rework", "evidence record"];
var help = `Vinea: explicit local task collaboration

vinea <command> --input - --json
Read commands: --task <id> or --source <legacy-directory>

${["session resolve", ...Object.keys(commands), ...reads].sort().join("\n")}

Resolve an instance once; reuse its echoed Actor. No automatic Git, migration, or agent dispatch.
`;
async function main(argv, io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }) {
  try {
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
      io.stdout.write(help);
      return 0;
    }
    if (legacy.some((c) => argv.slice(0, c.split(" ").length).join(" ") === c)) throw new KernelError("LEGACY_COMMAND_REMOVED", "Legacy stage commands are read-only history; use legacy inspect/import explicitly");
    const parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
      input: { type: "string" },
      json: { type: "boolean" },
      task: { type: "string" },
      source: { type: "string" },
      id: { type: "string" },
      limit: { type: "string" },
      after: { type: "string" }
    } });
    const command = parsed.positionals.join(" ");
    if (!reads.includes(command) && command !== "session resolve" && !Object.hasOwn(commands, command)) throw new KernelError("COMMAND_UNKNOWN", "Unknown command; use --help");
    const ctx = await discoverRepository(process.cwd());
    let result;
    if (reads.includes(command)) result = await executeReadCommand(ctx, command, {
      taskId: parsed.values.task,
      sourceRoot: parsed.values.source,
      resourceId: parsed.values.id,
      limit: parsed.values.limit === void 0 ? void 0 : Number(parsed.values.limit),
      after: parsed.values.after
    });
    else {
      if (!parsed.values.input) throw new KernelError("INPUT_REQUIRED", "Use --input - for the structured command envelope");
      let content = "";
      if (parsed.values.input === "-") {
        for await (const chunk of io.stdin) {
          content += chunk.toString();
          if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new KernelError("INPUT_TOO_LARGE", "Input exceeds 2 MiB");
        }
      } else content = await readFile4(await safePath(ctx.worktreeRoot, resolve4(ctx.worktreeRoot, parsed.values.input)), "utf8");
      if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new KernelError("INPUT_TOO_LARGE", "Input exceeds 2 MiB");
      let envelope;
      try {
        envelope = JSON.parse(content);
      } catch {
        throw new KernelError("INPUT_INVALID", "Input must be a JSON command envelope");
      }
      result = await executeCommand(ctx, command, envelope);
    }
    io.stdout.write(`${JSON.stringify(result, null, parsed.values.json ? void 0 : 2)}
`);
    return result.error || command === "validate" && result.data.status !== "ready" ? 1 : 0;
  } catch (error) {
    const known = error instanceof KernelError;
    io.stdout.write(`${JSON.stringify({
      actor: null,
      workspaceId: null,
      operationId: null,
      data: null,
      error: { code: known ? error.code : "COMMAND_FAILED", message: known ? error.message : "Command failed; inspect current state before retrying", details: known ? error.details : {} }
    })}
`);
    return 1;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve4(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
export {
  main
};
