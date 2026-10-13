import { requireThat } from "./errors.js";
import { assertEntry, currentContract } from "./policy.js";
import { canonicalJson, controlRequestRule } from "./schema.js";
import type { Claim, OccupancyRef, ControlRequest, Meta, Task, TaskControl } from "./types.js";

export function matchesOccupancy(claim: Claim | undefined, from: OccupancyRef): boolean {
  return !!claim && claim.taskId === from.taskId && claim.assignmentId === from.assignmentId
    && claim.workspaceId === from.workspaceId && claim.instanceId === from.instanceId && claim.epoch === from.epoch;
}

export function newTaskControl(): TaskControl {
  return { revision: 0, round: 1, paused: false, events: [], revoked: [], recoveries: [] };
}

export function assertControlRequest(meta: Meta, request: ControlRequest, action: ControlRequest["action"]): void {
  controlRequestRule(request);
  assertEntry(meta, null, "state-write");
  requireThat(["run", "continue", "debug"].includes(meta.invocation.entry) && !meta.invocation.analysisOnly,
    "ENTRY_SCOPE_DENIED", "Task control requires an explicit run, continue or debug request");
  requireThat(["named-entry", "named-request"].includes(meta.invocation.activation),
    "CONTROL_REQUEST_REQUIRED", "A bound follow-up cannot supply a new user control decision");
  requireThat(request.action === action, "CONTROL_REQUEST_REQUIRED", "User control request names another action");
}

export function assertActorWork(task: Task, instanceId: string, assignmentId: string | null): void {
  requireThat(!task.control?.revoked.some(r => r.instanceId === instanceId && r.assignmentId === assignmentId),
    "EXECUTOR_REPLACED", "This work was revoked; inspect task control and obtain an explicit reassignment");
}

export function controlView(task: Task, claims: readonly Claim[] = []) {
  const control = task.control;
  const authorization = task.workflow?.authorizations.at(-1);
  const authorized = task.status === "active" && !control?.paused && !!authorization && !authorization.revoked
    && authorization.contractVersion === currentContract(task).version;
  const recoveries = control?.recoveries.filter(r => ["pending", "reserved"].includes(r.state)) ?? [];
  const taskClaims = claims.filter(c => c.taskId === task.id);
  const holds = taskClaims.filter(c => c.state === "unknown-writer-hold");
  const currentSources = holds.map(({ taskId, assignmentId, workspaceId, instanceId, epoch }) => ({ taskId, assignmentId, workspaceId, instanceId, epoch }));
  const recoverySources = [...new Map([...currentSources, ...(control?.recoveries ?? []).filter(r => r.state === "aborted").map(r => r.from)]
    .map(from => [canonicalJson(from), from])).values()];
  const needsFreshRecovery = holds.some(hold => !recoveries.some(r => r.assignmentId === hold.assignmentId)
    && !taskClaims.some(c => c.assignmentId === hold.assignmentId && ["writer", "released", "restore-target"].includes(c.state) && c.epoch > hold.epoch));
  const nextActions = task.status === "cancelled" ? ["task reopen: requires an explicit user request; does not authorize implementation"]
    : task.status !== "active" ? ["debug open: preserve the original delivery"]
    : ["task takeover / task replace-executor: explicit user request; no previous owner cooperation needed",
      ...(!authorized ? ["Review current planning; after an explicit implementation request the current owner uses task authorize through run/debug with named-entry/named-request. continue cannot create execution authority"] : []),
      ...(recoveries.some(r => r.state === "pending") ? ["work resume: use a pending recoveries[].id in this control summary; prove the source stopped, restore an isolated snapshot, or explicitly choose an isolated Git baseline"] : []),
      ...(recoveries.some(r => r.state === "reserved") ? ["Retry the original work resume operation for the reserved recovery only while its authorization and contract remain current; do not create a new reservation"] : []),
      ...(needsFreshRecovery ? ["For unresolved retained work, use a fresh work resume with recoveryId:null and a relevant from reference in this control summary's recoverySources; old aborted operations remain invalid"] : []),
      ...(holds.length ? ["work clear-hold: only after actual stopping. The original holder may use holder-release; otherwise provide real stop evidence. Clearing a source hold does not cancel a pending/reserved recovery; without one, normal work claim rules still apply"] : []),
      "task pause / task cancel: explicit user request; host process stopping is separate"];
  return { status: task.status, protocol: control ? "task-control-v1" : null, revision: control?.revision ?? null, round: control?.round ?? null,
    paused: control?.paused ?? false, authorized, executableCandidate: task.status === "active" && authorized,
    events: control?.events.slice(-20) ?? [], recoveries, recoverySources, nextActions };
}

export function verificationFence(task: Task, instanceId: string): string {
  const event = task.control?.events.filter(e => ["pause", "cancel", "reopen"].includes(e.action) || e.replacedInstanceId === instanceId).at(-1);
  const authorization = task.workflow?.authorizations.at(-1);
  return JSON.stringify([task.status, task.control?.paused ?? false, authorization?.id ?? null, authorization?.revoked ?? null, event?.id ?? null]);
}
