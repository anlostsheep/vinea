import { randomUUID } from "node:crypto";
import { requireThat } from "./errors.js";
import { assertContract, currentContract, getTask } from "./policy.js";
import { assertControlRequest, controlView, matchesOccupancy } from "./control-policy.js";
import { actorRule, integer, text } from "./schema.js";
import { mutateState, readState } from "./store.js";
import { executionKey } from "./ownership.js";
import type { Actor, ControlAction, ControlEvent, ControlRequest, Decision, Meta, RepositoryContext, RepositoryState, Task } from "./types.js";

export interface ControlInput {
  taskId: string; contractVersion: number; expectedControlRevision: number; ownerEpoch: number;
  request: ControlRequest; reason: string;
}

// Revocation fences cooperating writers. It is never proof that a host process stopped.
export function revokeTaskExecution(ctx: RepositoryContext, state: RepositoryState, task: Task, meta: Meta, decision: Decision): void {
  for (const authorization of task.workflow?.authorizations ?? []) if (!authorization.revoked) authorization.revoked = structuredClone(decision);
  if (task.control) {
    task.control.paused = true;
    for (const recovery of task.control.recoveries) if (["pending", "reserved"].includes(recovery.state)) recovery.state = "aborted";
  }
  for (const claim of Object.values(state.claims).filter(c => c.taskId === task.id && ["writer", "restore-target"].includes(c.state))) {
    const key = executionKey(task.id, claim.assignmentId);
    state.epochs[key] = (state.epochs[key] ?? claim.epoch) + 1;
    state.claims[claim.workspaceId] = claim.instanceId === meta.actor.instanceId && claim.workspaceId === ctx.workspaceId
      ? { ...claim, state: "released", recovery: null } : { ...claim, state: "unknown-writer-hold" };
  }
}

function replaceActor(state: RepositoryState, task: Task, from: string, to: Actor): Array<string | null> {
  requireThat(from !== to.instanceId, "EXECUTOR_UNCHANGED", "Select a different receiving executor");
  const control = task.control!;
  const assignments = Object.values(task.assignments).filter(a => a.assignee === from && a.status !== "closed");
  const claims = Object.values(state.claims).filter(c => c.taskId === task.id && c.instanceId === from
    && (c.assignmentId === null ? task.owner.instanceId === from || ["writer", "restore-target"].includes(c.state)
      : task.assignments[c.assignmentId]?.assignee === from || (task.assignments[c.assignmentId]?.assignee === null && ["writer", "restore-target"].includes(c.state)))
    && !Object.values(state.claims).some(other => other.taskId === task.id && other.assignmentId === c.assignmentId
      && other.instanceId !== from && ["writer", "restore-target"].includes(other.state)));
  const inherited = control.recoveries.filter(r => r.toInstanceId === from && ["pending", "reserved"].includes(r.state));
  const work = new Set<string | null>([...assignments.map(a => a.id), ...inherited.map(r => r.assignmentId)]);
  for (const claim of claims) work.add(claim.assignmentId);
  if (task.owner.instanceId === from) work.add(null);
  requireThat(work.size, "EXECUTOR_NOT_ASSIGNED", "This actor has no current responsibility in the task");
  for (const assignmentId of work) {
    if (!control.revoked.some(r => r.instanceId === from && r.assignmentId === assignmentId)) control.revoked.push({ instanceId: from, assignmentId });
    control.revoked = control.revoked.filter(r => r.instanceId !== to.instanceId || r.assignmentId !== assignmentId);
    for (const ticket of control.recoveries) if (ticket.assignmentId === assignmentId && ["pending", "reserved"].includes(ticket.state)) ticket.state = "aborted";
    // Delivery responsibility can change while another, retained actor writes the main work.
    if (Object.values(state.claims).some(c => c.taskId === task.id && c.assignmentId === assignmentId
      && c.instanceId !== from && ["writer", "restore-target"].includes(c.state))) continue;
    const key = executionKey(task.id, assignmentId);
    state.epochs[key] = (state.epochs[key] ?? 0) + 1;
    const inheritedSource = inherited.find(r => r.assignmentId === assignmentId)?.from;
    const ownClaim = claims.filter(c => c.assignmentId === assignmentId).sort((a, b) => b.epoch - a.epoch)[0];
    const inheritedClaim = inheritedSource && matchesOccupancy(state.claims[inheritedSource.workspaceId], inheritedSource)
      ? state.claims[inheritedSource.workspaceId] : undefined;
    const claim = ownClaim ?? inheritedClaim;
    const source = ownClaim ? { taskId: ownClaim.taskId, assignmentId, workspaceId: ownClaim.workspaceId,
      instanceId: ownClaim.instanceId, epoch: ownClaim.epoch } : inheritedSource;
    if (source) {
      // The directory may already belong to unrelated work. Keep the historical
      // source for isolated recovery without fencing or rewriting its new claim.
      if (claim && ["writer", "restore-target"].includes(claim.state)) state.claims[claim.workspaceId] = { ...claim, state: "unknown-writer-hold" };
      control.recoveries.push({ id: randomUUID(), assignmentId, from: { ...source },
        toInstanceId: to.instanceId, contractVersion: currentContract(task).version, state: "pending", operationId: null, token: null });
    }
    if (assignmentId !== null) {
      const assignment = task.assignments[assignmentId]!;
      assignment.assignee = to.instanceId;
      // Cancelled assignments are reopened only by an explicit reassignment, never by task reopen.
      if (assignment.status === "cancelled") assignment.status = "open";
    }
  }
  if (task.owner.instanceId === from) task.owner = { instanceId: to.instanceId, epoch: task.owner.epoch + 1 };
  return [...work];
}

async function controlTask(ctx: RepositoryContext, meta: Meta, input: ControlInput, action: ControlAction, target?: { from: string; to: Actor }) {
  assertControlRequest(meta, input.request, action); text(input.reason); integer(input.expectedControlRevision); integer(input.ownerEpoch);
  if (target) actorRule(target.to);
  const receipt = await mutateState(ctx, meta, { command: `task.${action}`, input, target: target ?? null }, state => {
    const task = getTask(state, input.taskId, false);
    assertContract(task, input.contractVersion);
    requireThat(task.control, "TASK_CONTROL_REQUIRED", "Upgrade this store explicitly before task control");
    requireThat(task.control.revision === input.expectedControlRevision && task.owner.epoch === input.ownerEpoch,
      "CONTROL_CHANGED", "Task control changed; refresh task show before deciding again");
    requireThat(action === "reopen" ? task.status === "cancelled" : task.status === "active",
      "TASK_READ_ONLY", "Only cancelled tasks can reopen; delivered history uses a linked repair");
    const control = task.control, previousOwner = { ...task.owner }, previousStatus = task.status;
    let assignments: Array<string | null> = [], replaced: string | null = null;
    if (action === "takeover" || action === "replace-executor") {
      const from = action === "takeover" ? task.owner.instanceId : target!.from;
      const to = action === "takeover" ? meta.actor : target!.to;
      replaced = from; assignments = replaceActor(state, task, from, to);
    } else {
      revokeTaskExecution(ctx, state, task, meta, { summary: input.reason, reference: input.request.reference });
      if (action === "cancel") task.status = "cancelled";
      if (action === "reopen") {
        task.status = "active"; control.round++;
        task.owner = { instanceId: meta.actor.instanceId, epoch: task.owner.epoch + 1 };
        const contract = currentContract(task);
        task.contracts.push({ ...structuredClone(contract), version: contract.version + 1,
          decision: { summary: `Reopened: ${input.reason}`, reference: input.request.reference } });
        for (const assignment of Object.values(task.assignments)) if (assignment.status === "open") assignment.status = "cancelled";
        control.revoked = control.revoked.filter(r => r.instanceId !== meta.actor.instanceId || r.assignmentId !== null);
      }
    }
    const event: ControlEvent = { id: meta.operationId, revision: ++control.revision, round: control.round, action,
      actor: structuredClone(meta.actor), request: structuredClone(input.request), reason: input.reason, recordedAt: new Date().toISOString(),
      previousOwner, owner: { ...task.owner }, previousStatus, status: task.status, replacedInstanceId: replaced, assignmentIds: assignments };
    control.events.push(event);
    return [task.id, event.id];
  });
  const currentState = await readState(ctx), task = getTask(currentState, input.taskId, false);
  const event = task.control!.events.find(e => e.id === receipt.resourceIds[1])!;
  return { taskId: task.id, event, current: { owner: task.owner, contractVersion: currentContract(task).version, ...controlView(task, Object.values(currentState.claims)) },
    stillCurrent: task.control!.revision === event.revision && task.owner.epoch === event.owner.epoch && task.status === event.status };
}

export const takeOverTask = (ctx: RepositoryContext, meta: Meta, input: ControlInput) => controlTask(ctx, meta, input, "takeover");
export const replaceExecutor = (ctx: RepositoryContext, meta: Meta, input: ControlInput & { fromInstanceId: string; to: Actor }) =>
  controlTask(ctx, meta, input, "replace-executor", { from: input.fromInstanceId, to: input.to });
export const pauseTask = (ctx: RepositoryContext, meta: Meta, input: ControlInput) => controlTask(ctx, meta, input, "pause");
export const cancelTask = (ctx: RepositoryContext, meta: Meta, input: ControlInput) => controlTask(ctx, meta, input, "cancel");
export const reopenTask = (ctx: RepositoryContext, meta: Meta, input: ControlInput) => controlTask(ctx, meta, input, "reopen");
