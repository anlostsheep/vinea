import { randomUUID } from "node:crypto";
import { requireThat } from "./errors.js";
import { readState, mutateState } from "./store.js";
import { getTask, currentContract, assertContract, assertEntry, assertOwner } from "./policy.js";
import { tokenRule } from "./schema.js";
import type { RepositoryContext, RepositoryState, Meta, Id, WriteToken, Assignment } from "./types.js";
import { assertExecution } from "./workflow-policy.js";
import { validatePlanningArtifacts } from "./workflow.js";

export function executionKey(taskId: Id, assignmentId: Id | null): string { return JSON.stringify([taskId, assignmentId]); }
export function assertWorkspaceClaimable(state: RepositoryState, workspaceId: Id): void {
  requireThat(!state.claims[workspaceId] || state.claims[workspaceId]!.state === "released", "WORKSPACE_OCCUPIED", "Workspace is written, restoring, or held by an unknown writer");
}
export async function assertCurrentToken(ctx: RepositoryContext, state: RepositoryState, meta: Meta, token: WriteToken): Promise<void> {
  tokenRule(token);
  const claim = state.claims[ctx.workspaceId], task = getTask(state, token.taskId);
  requireThat(claim?.state === "writer" && token.workspaceId === ctx.workspaceId && claim.instanceId === meta.actor.instanceId
    && token.instanceId === claim.instanceId && token.epoch === claim.epoch && token.taskId === claim.taskId
    && token.assignmentId === claim.assignmentId && token.epoch === state.epochs[executionKey(token.taskId, token.assignmentId)],
    "STALE_WRITE_TOKEN", "Write ownership is absent, stale, held, or restoring");
  assertContract(task, token.contractVersion); assertContract(task, claim.contractVersion);
  assertExecution(task);
  await validatePlanningArtifacts(ctx, task);
}
export async function assertWriteToken(ctx: RepositoryContext, state: RepositoryState, meta: Meta, token: WriteToken): Promise<void> {
  await assertCurrentToken(ctx, state, meta, token);
  assertEntry(meta, getTask(state, token.taskId), "business-write");
}
export async function addAssignment(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; ownerEpoch: number; assignment: Omit<Assignment, "id" | "status">;
}): Promise<Assignment> {
  const result = await mutateState(ctx, meta, { command: "assignment.add", input }, async state => {
    const task = getTask(state, input.taskId);
    assertEntry(meta, task, "delegate"); assertOwner(task, meta, input.ownerEpoch);
    await validatePlanningArtifacts(ctx, task);
    const assignment = { ...structuredClone(input.assignment), id: randomUUID(), status: "open" as const };
    task.assignments[assignment.id] = assignment;
    return [assignment.id];
  });
  return (await readState(ctx)).tasks[input.taskId]!.assignments[result.resourceIds[0]!]!;
}
export async function claimWork(ctx: RepositoryContext, meta: Meta, input: { taskId: Id; assignmentId: Id | null; contractVersion: number }): Promise<WriteToken> {
  const receipt = await mutateState(ctx, meta, { command: "work.claim", input, workspaceId: ctx.workspaceId }, async state => {
    const task = getTask(state, input.taskId);
    assertEntry(meta, task, "business-write"); assertContract(task, input.contractVersion);
    await validatePlanningArtifacts(ctx, task);
    const assignment = input.assignmentId === null ? null : task.assignments[input.assignmentId];
    const previous = state.claims[ctx.workspaceId];
    const key = executionKey(input.taskId, input.assignmentId);
    const same = previous?.state === "writer" && previous.instanceId === meta.actor.instanceId && previous.taskId === input.taskId
      && previous.assignmentId === input.assignmentId && previous.epoch === state.epochs[key];
    if (same && previous.contractVersion === input.contractVersion) return [ctx.workspaceId, String(previous.epoch)];
    if (!same) assertWorkspaceClaimable(state, ctx.workspaceId);
    if (input.assignmentId !== null) requireThat(assignment?.status === "open" && assignment.businessWrite
      && (assignment.assignee === null || assignment.assignee === meta.actor.instanceId), "ASSIGNMENT_NOT_GRANTED", "Assignment is not granted to this writer");
    else requireThat(same || task.owner.instanceId === meta.actor.instanceId, "ASSIGNMENT_NOT_GRANTED", "Only the owner or current handed-off writer can claim unassigned implementation");
    requireThat(!Object.values(state.claims).some(c => c.workspaceId !== ctx.workspaceId && c.taskId === input.taskId && c.assignmentId === input.assignmentId
      && ["writer", "restore-target"].includes(c.state)), "WORKSPACE_OCCUPIED", "Execution is occupied in another workspace");
    const epoch = (state.epochs[key] ?? 0) + 1;
    state.epochs[key] = epoch;
    state.claims[ctx.workspaceId] = { ...input, workspaceId: ctx.workspaceId, instanceId: meta.actor.instanceId, epoch, state: "writer", recovery: null };
    return [ctx.workspaceId, String(epoch)];
  });
  const token = { ...input, workspaceId: ctx.workspaceId, instanceId: meta.actor.instanceId, epoch: Number(receipt.resourceIds[1]) };
  await assertWriteToken(ctx, await readState(ctx), meta, token);
  return token;
}
export function toWriteToken(claim: WriteToken): WriteToken {
  const { taskId, assignmentId, workspaceId, instanceId, epoch, contractVersion } = claim;
  return { taskId, assignmentId, workspaceId, instanceId, epoch, contractVersion };
}
export async function releaseWork(ctx: RepositoryContext, meta: Meta, token: WriteToken): Promise<void> {
  tokenRule(token);
  await mutateState(ctx, meta, { command: "work.release", token }, state => {
    assertEntry(meta, getTask(state, token.taskId, false), "state-write");
    const claim = state.claims[ctx.workspaceId];
    requireThat(claim?.state === "writer" && claim.instanceId === meta.actor.instanceId && claim.instanceId === token.instanceId
      && token.workspaceId === ctx.workspaceId && claim.taskId === token.taskId && claim.assignmentId === token.assignmentId && claim.epoch === token.epoch,
      "STALE_WRITE_TOKEN", "Cannot release a different, held, or restoring writer");
    state.claims[ctx.workspaceId] = { ...claim, state: "released", recovery: null };
    return [ctx.workspaceId];
  });
}
