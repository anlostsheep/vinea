import { actorRule, decisionRule, metaRule, canonicalJson, one } from "./schema.js";
import { requireThat, KernelError } from "./errors.js";
import { currentContract, getTask, assertContract, assertEntry, assertWritablePath } from "./policy.js";
import { readState, mutateState, lookupOperation, inspectLegacyCoexistence } from "./store.js";
import { executionKey, assertWorkspaceClaimable, assertWriteToken, toWriteToken } from "./ownership.js";
import { bindSession } from "./sessions.js";
import { loadSnapshot, restoreSnapshot } from "./snapshots.js";
import { gitOutput } from "./repository.js";
import type { RepositoryContext, Meta, Id, OccupancyRef, Claim, Actor, Decision, WriteToken, ContinuationView, RepositoryState } from "./types.js";
import { assertExecution } from "./workflow-policy.js";
import { validatePlanningArtifacts } from "./workflow.js";

export function occupancyRef(claim: Claim): OccupancyRef {
  const { taskId, assignmentId, workspaceId, instanceId, epoch } = claim;
  return { taskId, assignmentId, workspaceId, instanceId, epoch };
}
function sourceClaim(state: RepositoryState, from: OccupancyRef): Claim {
  const claim = state.claims[from.workspaceId];
  requireThat(claim && canonicalJson(occupancyRef(claim)) === canonicalJson(from), "OCCUPANCY_CHANGED", "Source occupancy changed; refresh its public reference");
  return claim;
}
export async function continueGoal(ctx: RepositoryContext, meta: Meta, input: { taskId: Id; assignmentId: Id | null; afterRevision?: number }): Promise<ContinuationView> {
  metaRule(meta);
  requireThat(meta.invocation.activation !== "none", "ACTIVATION_REQUIRED", "Continuation must be explicitly requested or bound");
  const state = await readState(ctx), task = getTask(state, input.taskId);
  const binding = await bindSession(ctx, meta, input), missing: string[] = [];
  let writeToken: WriteToken | null = null;
  const mine = state.claims[ctx.workspaceId];
  if (mine?.instanceId === meta.actor.instanceId && mine.taskId === input.taskId && mine.assignmentId === input.assignmentId) {
    try { await assertWriteToken(ctx, state, meta, toWriteToken(mine)); writeToken = toWriteToken(mine); }
    catch (error) { missing.push((error as KernelError).code); }
  }
  const occupiedWrites = Object.values(state.claims).filter(c => c.state !== "released" && (c.taskId === task.id || c.workspaceId === ctx.workspaceId))
    .map(c => ({ ref: occupancyRef(c), state: c.state, contractVersion: c.contractVersion }));
  if (occupiedWrites.some(c => c.state === "unknown-writer-hold")) missing.push("UNKNOWN_WRITER_HOLD");
  if (await inspectLegacyCoexistence(ctx)) missing.push("LEGACY_ACTIVE_STATE_PRESENT");
  try { assertExecution(task); await validatePlanningArtifacts(ctx, task); }
  catch (error) { if (!missing.includes((error as KernelError).code)) missing.push((error as KernelError).code); }
  return { taskId: task.id, contract: currentContract(task), owner: task.owner, binding, writeToken, workflow: task.workflow ?? null,
    assignment: input.assignmentId ? task.assignments[input.assignmentId]! : null,
    occupiedWrites, diagnostics: task.diagnostics.slice(-20), pendingContributionIds: Object.values(task.contributions).filter(c => !c.integrated).map(c => c.id),
    evidenceIds: Object.values(task.evidence).sort((a, b) => a.sequence - b.sequence).slice(-20).map(e => e.id),
    missing, nextCursor: state.revision, unchanged: input.afterRevision === state.revision };
}
type Transfer = { from: OccupancyRef; to: Actor; contractVersion: number; transferOwner: boolean; ownerEpoch: number | null; decision: Decision | null };
function transferAuthority(state: RepositoryState, meta: Meta, input: Transfer) {
  const task = getTask(state, input.from.taskId);
  assertEntry(meta, task, "business-write"); assertContract(task, input.contractVersion); actorRule(input.to);
  if (input.decision) decisionRule(input.decision);
  requireThat(input.decision || input.from.instanceId === meta.actor.instanceId, "TRANSFER_DECISION_REQUIRED", "Transferring another instance requires a user decision");
  if (input.to.instanceId !== meta.actor.instanceId) requireThat(input.decision || currentContract(task).grant.delegate,
    "TRANSFER_DECISION_REQUIRED", "Handing work to another actor requires authorized collaboration or a user decision");
  if (input.transferOwner) {
    requireThat(input.ownerEpoch === task.owner.epoch, "OWNER_CHANGED", "Delivery owner changed");
    requireThat(task.owner.instanceId === meta.actor.instanceId || input.decision, "TRANSFER_DECISION_REQUIRED", "A contributor cannot transfer delivery responsibility without its owner or a user decision");
  }
  else requireThat(input.ownerEpoch === null, "OWNER_CHANGED", "Owner epoch is only used when transferring ownership");
  return task;
}
export async function handoffWork(ctx: RepositoryContext, meta: Meta, input: Transfer): Promise<WriteToken> {
  requireThat(ctx.workspaceId === input.from.workspaceId, "ISOLATED_RECOVERY_REQUIRED", "Cross-workspace transfers use snapshot recovery");
  const receipt = await mutateState(ctx, meta, { command: "work.handoff", input }, async state => {
    const task = transferAuthority(state, meta, input), old = sourceClaim(state, input.from);
    await validatePlanningArtifacts(ctx, task);
    requireThat(["writer", "released"].includes(old.state), "OCCUPANCY_CHANGED", "A held or restoring workspace cannot be directly handed off");
    requireThat(old.state === "released" || old.instanceId === meta.actor.instanceId, "HOLDER_RELEASE_REQUIRED", "An active writer must hand off itself; other actors use the controlled takeover path");
    const key = executionKey(old.taskId, old.assignmentId);
    requireThat(old.epoch === state.epochs[key], "OCCUPANCY_CHANGED", "A newer executor exists");
    const epoch = old.epoch + 1; state.epochs[key] = epoch;
    state.claims[ctx.workspaceId] = { ...old, instanceId: input.to.instanceId, epoch, contractVersion: input.contractVersion, state: "writer", recovery: null };
    if (old.assignmentId) task.assignments[old.assignmentId]!.assignee = input.to.instanceId;
    if (input.transferOwner) task.owner = { instanceId: input.to.instanceId, epoch: task.owner.epoch + 1 };
    return [ctx.workspaceId, String(epoch)];
  });
  const token = { ...input.from, instanceId: input.to.instanceId, epoch: Number(receipt.resourceIds[1]), contractVersion: input.contractVersion };
  await assertWriteToken(ctx, await readState(ctx), { ...meta, actor: input.to }, token);
  return token;
}
export async function takeoverWork(ctx: RepositoryContext, meta: Meta, input: Transfer & {
  decision: Decision; stopBasis: "holder-release" | "host-stop-receipt" | "user-declared-stop" | "unknown";
  stopReference: string | null; baselineSnapshotId: Id | null;
}): Promise<WriteToken> {
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
      const snapshot = await loadSnapshot(ctx, input.baselineSnapshotId);
      const task = getTask(await readState(ctx), input.from.taskId);
      snapshot.entries.forEach(e => assertWritablePath(task, e.path));
      requireThat(!(await gitOutput(ctx.worktreeRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])), "RECOVERY_CONFLICT", "Target has unconfirmed changes");
      const base = await gitOutput(ctx.worktreeRoot, ["rev-parse", "--verify", "HEAD"]).then(s => s.trim(), () => null);
      requireThat(base === snapshot.baseCommit, "SNAPSHOT_UNAVAILABLE", "Target baseline differs");
    }
    await mutateState(ctx, meta, request, async state => {
      const task = transferAuthority(state, meta, input), old = sourceClaim(state, input.from);
      await validatePlanningArtifacts(ctx, task);
      requireThat(["writer", "restore-target", "released"].includes(old.state), "OCCUPANCY_CHANGED", "Only the current executor can be replaced");
      const key = executionKey(old.taskId, old.assignmentId);
      requireThat(old.epoch === state.epochs[key], "OCCUPANCY_CHANGED", "Executor changed before takeover");
      if (isolated) assertWorkspaceClaimable(state, ctx.workspaceId);
      if (input.stopBasis === "holder-release") requireThat(old.state === "released", "STOP_EVIDENCE_REQUIRED", "Holder has not released the workspace");
      const epoch = old.epoch + 1; state.epochs[key] = epoch;
      state.claims[old.workspaceId] = input.stopBasis === "unknown"
        ? { ...old, state: "unknown-writer-hold" }
        : { ...old, state: "released", recovery: null };
      const token: WriteToken = { ...toWriteToken(old), workspaceId: ctx.workspaceId, instanceId: input.to.instanceId, epoch, contractVersion: input.contractVersion };
      state.claims[ctx.workspaceId] = isolated
        ? { ...token, state: "restore-target", recovery: { snapshotId: input.baselineSnapshotId!, operationId: meta.operationId } }
        : { ...token, state: "writer", recovery: null };
      if (old.assignmentId) task.assignments[old.assignmentId]!.assignee = input.to.instanceId;
      if (input.transferOwner) task.owner = { instanceId: input.to.instanceId, epoch: task.owner.epoch + 1 };
      return [ctx.workspaceId, String(epoch)];
    });
  }
  const state = await readState(ctx), claim = state.claims[ctx.workspaceId];
  const receipt = state.operations[meta.operationId]!;
  requireThat(!(claim?.instanceId === meta.actor.instanceId && claim.epoch === Number(receipt.resourceIds[1])
    && ["released", "unknown-writer-hold"].includes(claim.state)), "RECOVERY_ABORTED",
    "This reservation was revoked or released; inspect partial files and holds before an explicitly authorized recovery");
  requireThat(claim && claim.instanceId === meta.actor.instanceId && claim.epoch === Number(receipt.resourceIds[1])
    && ["writer", "restore-target"].includes(claim.state), "OCCUPANCY_CHANGED", "Recovery target changed");
  if (claim.state === "restore-target") {
    const snapshot = await loadSnapshot(ctx, claim.recovery.snapshotId);
    await restoreSnapshot(ctx, meta, { taskId: claim.taskId, snapshotId: snapshot.id, token: toWriteToken(claim), expectedTargetBase: snapshot.baseCommit });
  }
  const token = toWriteToken(claim);
  await assertWriteToken(ctx, await readState(ctx), meta, token);
  return token;
}
export async function clearWorkspaceHold(ctx: RepositoryContext, meta: Meta, input: {
  from: OccupancyRef; stopBasis: "holder-release" | "host-stop-receipt" | "user-declared-stop";
  stopReference: string | null; decision: Decision | null;
}): Promise<void> {
  one("holder-release", "host-stop-receipt", "user-declared-stop")(input.stopBasis);
  await mutateState(ctx, meta, { command: "work.clear-hold", input }, state => {
    const task = getTask(state, input.from.taskId, false), claim = sourceClaim(state, input.from);
    assertEntry(meta, task, "state-write");
    requireThat(claim.state === "unknown-writer-hold", "OCCUPANCY_CHANGED", "Workspace is not an unknown writer hold");
    if (input.stopBasis === "holder-release") requireThat(meta.actor.instanceId === claim.instanceId, "STOP_EVIDENCE_REQUIRED", "Only the original holder may declare its release");
    else {
      requireThat(task.owner.instanceId === meta.actor.instanceId || input.decision, "STOP_EVIDENCE_REQUIRED", "Current owner or user decision required");
      if (input.stopBasis === "host-stop-receipt") requireThat(input.stopReference, "STOP_EVIDENCE_REQUIRED", "Host stop receipt required");
      else { requireThat(input.decision, "STOP_EVIDENCE_REQUIRED", "Explicit stop decision required"); decisionRule(input.decision); }
    }
    state.claims[claim.workspaceId] = { ...claim, state: "released", recovery: null }; return [claim.workspaceId];
  });
}
