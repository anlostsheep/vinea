import { randomUUID } from "node:crypto";
import { requireThat } from "./errors.js";
import { assertEntry, assertOwner, assertContract, currentContract, getTask } from "./policy.js";
import { mutateState, readState } from "./store.js";
import { assertPersistence } from "./io.js";
import { canonicalJson, array, checkRowRule, verificationRule, decisionRule } from "./schema.js";
import { loadSnapshot, compareSnapshot } from "./snapshots.js";
import { assertCurrentToken, toWriteToken } from "./ownership.js";
import type { RepositoryContext, Meta, Id, Task, CheckRow, VerificationRequirement, CheckSet, Delivery, Decision } from "./types.js";

function verifyRows(task: Task, version: number, snapshotId: Id, rows: CheckRow[], verification: VerificationRequirement[]): void {
  assertContract(task, version); array(checkRowRule)(rows); array(verificationRule)(verification);
  const criteria = new Set(currentContract(task).acceptance.map(c => c.id));
  requireThat(new Set(rows.map(r => r.acceptanceId)).size === rows.length, "CHECK_INVALID", "Duplicate acceptance rows");
  requireThat(new Set(verification.map(v => v.evidenceId)).size === verification.length, "CHECK_INVALID", "Duplicate verification requirements");
  const expected = new Map(verification.map(v => [v.evidenceId, v]));
  for (const row of rows) {
    requireThat(criteria.has(row.acceptanceId), "CHECK_INVALID", "Unknown acceptance criterion");
    if (row.result === "accepted-gap") requireThat(row.gapDecision, "GAP_REQUIRES_DECISION", "Accepted gap needs a user decision");
    if (row.result === "pass") requireThat(row.evidenceIds.length > 0, "PASS_REQUIRES_EVIDENCE", "Passing rows need evidence");
    for (const id of row.evidenceIds) {
      const e = task.evidence[id]; requireThat(e, "EVIDENCE_NOT_FOUND", "Evidence is absent");
      if (row.result !== "pass") continue;
      requireThat(e.contractVersion === version && e.snapshotId === snapshotId, "EVIDENCE_VERSION_MISMATCH", "Evidence describes a different contract or snapshot");
      requireThat(e.result === "pass", "EVIDENCE_NOT_PASSING", "Nonpassing evidence cannot support a pass");
      const basis = expected.get(id);
      requireThat(basis && canonicalJson(basis.argv) === canonicalJson(e.argv) && canonicalJson(basis.environment) === canonicalJson(e.environment),
        "VERIFICATION_CONDITIONS_MISMATCH", "Current command or environment differs from the evidence");
    }
  }
}
export async function recordCheckSet(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; contractVersion: number; snapshotId: Id; independent: boolean; rows: CheckRow[]; verification: VerificationRequirement[];
}): Promise<CheckSet> {
  assertPersistence(meta);
  const snapshot = await loadSnapshot(ctx, input.snapshotId);
  requireThat((await compareSnapshot(ctx, snapshot)).matches, "SNAPSHOT_CHANGED", "Check inputs changed");
  const receipt = await mutateState(ctx, meta, { command: "check.record", input }, state => {
    const task = getTask(state, input.taskId); assertEntry(meta, task, "state-write");
    verifyRows(task, input.contractVersion, input.snapshotId, input.rows, input.verification);
    if (input.independent) {
      requireThat(meta.invocation.entry === "check", "CHECK_INVALID", "Independent check requires the explicit check entry");
      requireThat(input.rows.every(r => r.evidenceIds.every(e => task.evidence[e]!.actor.instanceId === meta.actor.instanceId)), "CHECK_INVALID", "Do not relabel another assessor's evidence as your own check");
    }
    const { taskId: _, ...fields } = input;
    const checks: CheckSet = { ...structuredClone(fields), id: randomUUID(), assessor: meta.actor };
    task.checks[checks.id] = checks; return [checks.id];
  });
  return (await readState(ctx)).tasks[input.taskId]!.checks[receipt.resourceIds[0]!]!;
}
export async function finishGoal(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; contractVersion: number; ownerEpoch: number; snapshotId: Id; checkSetIds: Id[];
  contributionIds: Id[]; exclusions: string[]; verification: VerificationRequirement[];
}): Promise<Delivery> {
  assertPersistence(meta);
  requireThat(["run", "continue", "debug", "finish"].includes(meta.invocation.entry) && !meta.invocation.analysisOnly, "ENTRY_SCOPE_DENIED", "This entry cannot finalize delivery");
  const snapshot = await loadSnapshot(ctx, input.snapshotId);
  requireThat((await compareSnapshot(ctx, snapshot)).matches, "SNAPSHOT_CHANGED", "Delivery inputs changed");
  const receipt = await mutateState(ctx, meta, { command: "finish", input }, state => {
    const task = getTask(state, input.taskId); assertEntry(meta, task, "state-write"); assertOwner(task, meta, input.ownerEpoch); assertContract(task, input.contractVersion);
    const rows: CheckRow[] = [];
    for (const id of input.checkSetIds) {
      const checks = task.checks[id]; requireThat(checks && checks.snapshotId === input.snapshotId, "CHECK_INVALID", "A selected check describes different inputs");
      verifyRows(task, input.contractVersion, snapshot.id, checks.rows, input.verification); rows.push(...checks.rows);
    }
    requireThat(currentContract(task).acceptance.every(a => rows.some(r => r.acceptanceId === a.id)), "COVERAGE_MISSING", "Acceptance criteria are not covered");
    requireThat(rows.every(r => ["pass", "accepted-gap"].includes(r.result)), "CHECK_NOT_PASSING", "Unresolved failures or unverified results remain");
    for (const checks of Object.values(task.checks)) if (!input.checkSetIds.includes(checks.id) && checks.snapshotId === snapshot.id && checks.contractVersion === input.contractVersion
      && checks.rows.some(r => r.result === "fail" || r.result === "unverified")) {
      requireThat(input.exclusions.some(reason => reason.includes(checks.id)), "UNRESOLVED_CHECK", "Explain why a current unsuccessful check is not used");
    }
    for (const id of input.contributionIds) requireThat(task.contributions[id]?.integrated?.snapshotId === snapshot.id,
      "CONTRIBUTION_NOT_INTEGRATED", "Contribution is not integrated into this snapshot");
    requireThat(!Object.values(state.claims).some(c => c.taskId === task.id && c.workspaceId !== ctx.workspaceId
      && ["writer", "restore-target"].includes(c.state)), "WORKSPACE_OCCUPIED", "Another executor is still active for this task");
    const claim = state.claims[ctx.workspaceId];
    if (claim && claim.state !== "released") {
      assertCurrentToken(ctx, state, meta, toWriteToken(claim));
      requireThat(claim.taskId === task.id, "WORKSPACE_OCCUPIED", "Another task still owns this workspace");
      state.claims[ctx.workspaceId] = { ...claim, state: "released", recovery: null };
    }
    if (currentContract(task).quality === "tdd") {
      const evidence = Object.values(task.evidence).filter(e => e.contractVersion === input.contractVersion).sort((a, b) => a.sequence - b.sequence);
      const red = evidence.find(e => e.phase === "red" && e.result === "fail" && e.exitCode !== null && e.exitCode > 0);
      requireThat(red && evidence.some(e => e.phase === "green" && e.result === "pass" && e.exitCode === 0 && e.sequence > red.sequence && e.snapshotId === snapshot.id), "TDD_EVIDENCE_REQUIRED", "Current TDD evidence needs RED before GREEN");
    }
    const delivery: Delivery = { id: randomUUID(), contractVersion: input.contractVersion, snapshotId: snapshot.id, checkSetIds: input.checkSetIds,
      contributionIds: input.contributionIds, exclusions: input.exclusions, owner: { ...task.owner },
      acceptedGaps: rows.filter(r => r.result === "accepted-gap").map(r => ({ acceptanceId: r.acceptanceId, decision: r.gapDecision! })), createdAt: new Date().toISOString() };
    task.deliveries[delivery.id] = delivery; task.status = "delivered"; return [delivery.id];
  });
  return (await readState(ctx)).tasks[input.taskId]!.deliveries[receipt.resourceIds[0]!]!;
}
export async function acceptDelivery(ctx: RepositoryContext, meta: Meta, input: { taskId: Id; deliveryId: Id; decision: Decision }): Promise<void> {
  decisionRule(input.decision);
  await mutateState(ctx, meta, { command: "delivery.accept", input }, state => {
    const task = getTask(state, input.taskId, false); assertEntry(meta, task, "state-write");
    requireThat(task.deliveries[input.deliveryId], "DELIVERY_NOT_FOUND", "Delivery is absent");
    task.userAcceptances.push({ deliveryId: input.deliveryId, decision: input.decision, actor: meta.actor, recordedAt: new Date().toISOString() }); return [input.deliveryId];
  });
}
export async function archiveGoal(ctx: RepositoryContext, meta: Meta, input: { taskId: Id; decision: Decision }): Promise<void> {
  decisionRule(input.decision);
  await mutateState(ctx, meta, { command: "archive", input }, state => {
    const task = getTask(state, input.taskId, false); assertEntry(meta, task, "state-write");
    requireThat(task.owner.instanceId === meta.actor.instanceId && task.status === "delivered", "ARCHIVE_NOT_READY", "Only the owner can archive a delivered task");
    requireThat(!Object.values(state.claims).some(c => c.taskId === task.id && ["writer", "restore-target"].includes(c.state)), "WORKSPACE_OCCUPIED", "An executor is still active");
    task.status = "archived"; return [task.id];
  });
}
