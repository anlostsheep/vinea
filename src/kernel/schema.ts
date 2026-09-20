import { KernelError } from "./errors.js";
import type { RepositoryState } from "./types.js";

export type Rule = (value: unknown, path?: string) => void;
function invalid(path: string, reason: string): never { throw new KernelError("SCHEMA_INVALID", `${path}: ${reason}`); }
export const text: Rule = (v, p = "value") => {
  if (typeof v !== "string" || !v.trim() || v.length > 32000) invalid(p, "expected bounded nonempty text");
};
export const id: Rule = (v, p = "id") => {
  if (typeof v !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(v)
    || [...Object.getOwnPropertyNames(Object.prototype), "prototype"].includes(v)) invalid(p, "unsafe ID");
};
export const integer: Rule = (v, p = "number") => { if (!Number.isSafeInteger(v) || (v as number) < 0) invalid(p, "expected nonnegative integer"); };
export const bool: Rule = (v, p = "boolean") => { if (typeof v !== "boolean") invalid(p, "expected boolean"); };
export const one = (...values: unknown[]): Rule => (v, p = "value") => { if (!values.includes(v)) invalid(p, "unsupported value"); };
export const nullable = (rule: Rule): Rule => (v, p) => { if (v !== null) rule(v, p); };
export const array = (rule: Rule): Rule => (v, p = "array") => {
  if (!Array.isArray(v) || v.length > 100000) invalid(p, "expected bounded array");
  v.forEach((item, i) => rule(item, `${p}[${i}]`));
};
export function record(value: unknown, path = "object"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(path, "expected plain object");
  const out = value as Record<string, unknown>;
  for (const key of Object.keys(out)) if (["__proto__", "constructor", "prototype"].includes(key)) invalid(path, "unsafe property");
  return out;
}
export const object = (fields: Record<string, Rule>, optional: Record<string, Rule> = {}): Rule => (v, p = "object") => {
  const o = record(v, p);
  for (const key of Object.keys(o)) if (!Object.hasOwn(fields, key) && !Object.hasOwn(optional, key)) invalid(`${p}.${key}`, "unknown field");
  for (const [key, rule] of Object.entries(fields)) rule(o[key], `${p}.${key}`);
  for (const [key, rule] of Object.entries(optional)) if (Object.hasOwn(o, key)) rule(o[key], `${p}.${key}`);
};
export const map = (rule: Rule, keyRule: Rule = id): Rule => (v, p = "map") => {
  for (const [key, item] of Object.entries(record(v, p))) { keyRule(key, p); rule(item, `${p}.${key}`); }
};
export const pathRule: Rule = (v, p = "path") => {
  text(v, p);
  if ((v as string).startsWith("/") || (v as string).includes("\\")
    || (v as string).split("/").some(s => !s || s === "." || s === "..") || (v as string).includes("\0")) invalid(p, "unsafe relative path");
};
const hash: Rule = (v, p = "hash") => { if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) invalid(p, "invalid SHA256"); };
export const actorRule = object({ instanceId: id, host: text }, { hostSessionId: text });
export const decisionRule = object({ summary: text, reference: nullable(text) });
export const executionRequestRule = object({ kind: one("implementation-request", "implementation-confirmation", "continuation", "plan-approval"), userMessage: text, reference: text, action: nullable(text) });
const planningArtifactRule = object({ id, kind: one("brief", "plan"), contractVersion: integer, path: pathRule, sha256: hash });
const authorizationRule = object({ id, contractVersion: integer, documentIds: array(id), request: executionRequestRule, actor: actorRule, recordedAt: text, revoked: nullable(decisionRule) });
const workflowRule = object({ protocol: one("planning-authorization-v1"), planningRequired: bool, documents: array(planningArtifactRule), authorizations: array(authorizationRule) });
export const invocationRule = object({ entry: one("run", "brainstorm", "plan", "continue", "check", "debug", "finish", "orient", "doctor"), activation: one("named-entry", "named-request", "bound-followup", "none"), analysisOnly: bool, persist: bool });
export const metaRule = object({ operationId: id, actor: actorRule, invocation: invocationRule });
const grantRule = object({ businessWrite: bool, delegate: bool, commit: bool, deploy: bool, allowedPaths: array(pathRule) });
const criterionRule = object({ id, text });
export const draftFields = { goal: text, scope: array(text), constraints: array(text), acceptance: array(criterionRule), grant: grantRule, quality: one("standard", "tdd") };
export const contractDraftRule = object(draftFields);
const contractRule = object({ ...draftFields, version: integer, decision: decisionRule });
const ownerRule = object({ instanceId: id, epoch: integer });
const tokenFields = { taskId: id, assignmentId: nullable(id), workspaceId: id, instanceId: id, epoch: integer, contractVersion: integer };
export const tokenRule = object(tokenFields);
const recoveryRule = object({ snapshotId: id, operationId: id });
const claimRule = object({ ...tokenFields, state: one("writer", "restore-target", "unknown-writer-hold", "released"), recovery: nullable(recoveryRule) });
export const environmentRule = object({ runtime: text, platform: text, labels: map(text) });
const entryRule = object({ path: pathRule, kind: one("file", "deleted"), sha256: nullable(hash), mode: nullable(one("100644", "100755")) });
export const snapshotRule = object({ id, fingerprint: hash, baseCommit: nullable(text), scope: array(pathRule), entries: array(entryRule), workspaceId: id, createdBy: id, capturedAt: text });
const evidenceRule = object({ id, contractVersion: integer, snapshotId: id, actor: actorRule, source: one("command-runner", "agent-report", "user-observation"), result: one("pass", "fail", "unverified"), phase: nullable(one("red", "green")), argv: nullable(array(text)), cwd: text, environment: environmentRule, exitCode: nullable(integer), summary: text, artifactId: nullable(id), sequence: integer });
export const checkRowRule = object({ acceptanceId: id, result: one("pass", "fail", "unverified", "accepted-gap"), evidenceIds: array(id), summary: text, gapDecision: nullable(decisionRule) });
export const verificationRule = object({ evidenceId: id, argv: nullable(array(text)), environment: environmentRule });
const checkRule = object({ id, contractVersion: integer, snapshotId: id, assessor: actorRule, independent: bool, rows: array(checkRowRule), verification: array(verificationRule) });
const contributionRule = object({ id, kind: one("analysis", "change"), assignmentId: nullable(id), contractVersion: integer, submittedBy: id, snapshotId: nullable(id), evidenceIds: array(id), summary: text, writeToken: nullable(tokenRule), integrated: nullable(object({ snapshotId: id, owner: ownerRule, rationale: text })) });
const diagnosticRule = object({ id, kind: one("fact", "hypothesis", "ruled-out", "change", "validation-gap"), text, evidenceIds: array(id), actor: actorRule, createdAt: text });
const assignmentRule = object({ id, outcome: text, dependsOn: array(id), assignee: nullable(id), businessWrite: bool, status: one("open", "closed", "cancelled") });
const deliveryRule = object({ id, contractVersion: integer, snapshotId: id, checkSetIds: array(id), contributionIds: array(id), exclusions: array(text), owner: ownerRule, acceptedGaps: array(object({ acceptanceId: id, decision: decisionRule })), createdAt: text });
const taskRule = object({ id, title: text, status: one("active", "delivered", "archived"), contracts: array(contractRule), owner: ownerRule, assignments: map(assignmentRule), contributions: map(contributionRule), evidence: map(evidenceRule), checks: map(checkRule), diagnostics: array(diagnosticRule), deliveries: map(deliveryRule), userAcceptances: array(object({ deliveryId: id, decision: decisionRule, actor: actorRule, recordedAt: text })), relatedTo: nullable(object({ taskId: id, deliveryId: id })), legacySource: nullable(object({ path: text, fingerprint: hash, originalStatus: text })) }, { workflow: workflowRule });
const stateRule = object({ kernelSchemaVersion: one(1), repositoryId: id, revision: integer, tasks: map(taskRule), claims: map(claimRule), epochs: map(integer, text), snapshots: map(snapshotRule), operations: map(object({ operationId: id, requestHash: hash, revision: integer, resourceIds: array(id) })) });

export function canonicalJson(value: unknown): string {
  function normalize(v: unknown): unknown {
    if (v === null || typeof v === "boolean" || typeof v === "string") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map(normalize);
    if (typeof v !== "object") invalid("JSON", "unsupported value");
    return Object.fromEntries(Object.entries(record(v)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, item]) => [k, normalize(item)]));
  }
  try { return JSON.stringify(normalize(value)); } catch (error) {
    if (error instanceof KernelError) throw error;
    throw new KernelError("SCHEMA_INVALID", "Value is not finite acyclic JSON");
  }
}
export function assertRepositoryState(value: unknown): asserts value is RepositoryState {
  stateRule(value);
  const state = value as RepositoryState;
  const active = new Set<string>();
  for (const [workspace, claim] of Object.entries(state.claims)) {
    const key = JSON.stringify([claim.taskId, claim.assignmentId]);
    const task = state.tasks[claim.taskId];
    if (workspace !== claim.workspaceId || !task || claim.epoch < 1 || claim.epoch > (state.epochs[key] ?? -1)
      || claim.contractVersion < 1 || claim.contractVersion > task.contracts.length
      || (claim.assignmentId !== null && !task.assignments[claim.assignmentId])) invalid(workspace, "invalid claim reference");
    if (claim.state === "writer" || claim.state === "restore-target") {
      if (active.has(key) || claim.epoch !== state.epochs[key]) invalid(key, "multiple current writers or stale epoch");
      active.add(key);
    }
    if ((claim.state === "restore-target" && !claim.recovery)
      || (["writer", "released"].includes(claim.state) && claim.recovery)) invalid(workspace, "invalid recovery state");
    if (claim.recovery && !state.snapshots[claim.recovery.snapshotId]) invalid(workspace, "missing recovery snapshot");
  }
  for (const [key, task] of Object.entries(state.tasks)) {
    if (key !== task.id || !task.contracts.length || task.owner.epoch < 1) invalid(key, "invalid task identity");
    if (task.relatedTo && !state.tasks[task.relatedTo.taskId]?.deliveries[task.relatedTo.deliveryId]) invalid(key, "missing original delivery");
    task.contracts.forEach((c, i) => {
      if (c.version !== i + 1 || !c.acceptance.length || new Set(c.acceptance.map(a => a.id)).size !== c.acceptance.length) invalid(key, "invalid contract history");
    });
    if (task.workflow) {
      const { documents, authorizations } = task.workflow;
      if (new Set(documents.map(d => d.id)).size !== documents.length
        || new Set(authorizations.map(a => a.id)).size !== authorizations.length
        || new Set(authorizations.map(a => a.request.reference)).size !== authorizations.length) invalid(key, "duplicate workflow IDs or approval references");
      for (const d of documents) {
        if (d.contractVersion < 1 || d.contractVersion > task.contracts.length
          || d.path !== `tasks/${task.id}/planning/v${d.contractVersion}/${d.kind}-${d.sha256}.md`) invalid(key, "invalid planning artifact");
      }
      for (const a of authorizations) {
        if (a.contractVersion < 1 || a.contractVersion > task.contracts.length
          || !["implementation-request", "implementation-confirmation"].includes(a.request.kind)
          || (a.request.kind === "implementation-confirmation" && !a.request.action)
          || new Set(a.documentIds).size !== a.documentIds.length
          || a.documentIds.some(id => !documents.some(d => d.id === id && d.contractVersion === a.contractVersion))) invalid(key, "invalid execution authorization");
        const selected = documents.filter(d => a.documentIds.includes(d.id));
        if (new Set(selected.map(d => d.kind)).size !== selected.length
          || (task.workflow.planningRequired && !a.revoked && a.contractVersion === task.contracts.at(-1)!.version
            && selected.length !== 2)) invalid(key, "authorization has incomplete planning");
      }
    }
    const visit = (key: string, stack: Set<string>) => {
      if (stack.has(key) || !task.assignments[key]) invalid(key, "invalid assignment dependency");
      const next = new Set(stack).add(key);
      for (const dependency of task.assignments[key]!.dependsOn) visit(dependency, next);
    };
    for (const [name, assignment] of Object.entries(task.assignments)) {
      if (name !== assignment.id) invalid(name, "assignment ID mismatch");
      visit(name, new Set());
    }
    for (const [name, e] of Object.entries(task.evidence)) {
      if (name !== e.id || !state.snapshots[e.snapshotId] || e.contractVersion < 1 || e.contractVersion > task.contracts.length) invalid(name, "invalid evidence reference");
      if ((e.source === "command-runner") !== (e.artifactId !== null) || e.sequence < 1
        || (e.result === "pass" && e.exitCode !== null && e.exitCode !== 0)
        || (e.phase === "red" && (e.result !== "fail" || !e.exitCode))
        || (e.phase === "green" && (e.result !== "pass" || e.exitCode !== 0))) invalid(name, "invalid evidence provenance or result");
    }
    for (const [name, c] of Object.entries(task.contributions)) {
      if (name !== c.id || c.contractVersion < 1 || c.contractVersion > task.contracts.length
        || (c.assignmentId !== null && !task.assignments[c.assignmentId]) || c.evidenceIds.some(e => !task.evidence[e])
        || (c.snapshotId !== null && !state.snapshots[c.snapshotId])
        || (c.integrated && !state.snapshots[c.integrated.snapshotId])
        || (c.kind === "change" && (!c.snapshotId || !c.writeToken || c.writeToken.taskId !== task.id || c.writeToken.assignmentId !== c.assignmentId))) invalid(name, "invalid contribution reference");
    }
    for (const [name, c] of Object.entries(task.checks)) if (name !== c.id || !state.snapshots[c.snapshotId]
      || c.contractVersion < 1 || c.contractVersion > task.contracts.length
      || c.verification.some(v => !task.evidence[v.evidenceId]) || c.rows.some(r => r.evidenceIds.some(e => !task.evidence[e]))) invalid(name, "invalid check reference");
    for (const [name, d] of Object.entries(task.deliveries)) if (name !== d.id || !state.snapshots[d.snapshotId]
      || d.contractVersion < 1 || d.contractVersion > task.contracts.length || d.owner.epoch < 1
      || d.contributionIds.some(c => !task.contributions[c]) || d.checkSetIds.some(c => !task.checks[c])) invalid(name, "invalid delivery reference");
    if (task.diagnostics.some(d => d.evidenceIds.some(e => !task.evidence[e]))
      || task.userAcceptances.some(a => !task.deliveries[a.deliveryId])) invalid(key, "invalid task history reference");
  }
  for (const [key, s] of Object.entries(state.snapshots)) {
    if (key !== s.id || !s.scope.length || new Set(s.entries.map(e => e.path)).size !== s.entries.length) invalid(key, "snapshot identity mismatch");
    if (s.entries.some(e => !s.scope.some(root => e.path === root || e.path.startsWith(`${root}/`)))) invalid(key, "snapshot entry escapes selected scope");
    for (const e of s.entries) if (e.kind === "file" ? !e.sha256 || !e.mode : e.sha256 !== null || e.mode !== null) invalid(e.path, "snapshot entry mismatch");
  }
  for (const [key, receipt] of Object.entries(state.operations)) if (key !== receipt.operationId
    || receipt.revision < 1 || receipt.revision > state.revision) invalid(key, "invalid operation receipt");
}
