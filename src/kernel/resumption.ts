import { createHash, randomUUID } from "node:crypto";
import { requireThat } from "./errors.js";
import { assertControlRequest, assertActorWork, matchesOccupancy } from "./control-policy.js";
import { assertContract, assertEntry, assertWritablePath, currentContract, getTask } from "./policy.js";
import { mutateState, readState } from "./store.js";
import { assertWorkspaceClaimable, assertWriteToken, executionKey, toWriteToken } from "./ownership.js";
import { loadSnapshot, restoreSnapshot } from "./snapshots.js";
import { validatePlanningArtifacts } from "./workflow.js";
import { canonicalJson } from "./schema.js";
import { gitOutput } from "./repository.js";
import type { ControlRequest, Meta, OccupancyRef, RepositoryContext, WriteToken } from "./types.js";

export interface ResumeInput {
  taskId: string; recoveryId: string | null; from?: OccupancyRef; contractVersion: number; request: ControlRequest;
  mode: "existing" | "snapshot" | "baseline";
  stopBasis: "unknown" | "holder-release" | "host-stop-receipt" | "user-declared-stop";
  stopReference: string | null; snapshotId: string | null; baseCommit: string | null;
  abandonUncaptured: boolean;
}

export async function resumeWork(ctx: RepositoryContext, meta: Meta, input: ResumeInput): Promise<WriteToken> {
  assertControlRequest(meta, input.request, "resume");
  requireThat(input.recoveryId === null ? !!input.from : input.from === undefined,
    "RECOVERY_SOURCE_REQUIRED", "Select either an existing recoveryId or null recoveryId with an explicit source reference");
  const receipt = await mutateState(ctx, meta, { command: "work.resume", input, workspaceId: ctx.workspaceId }, async state => {
    const task = getTask(state, input.taskId);
    assertEntry(meta, task, "business-write"); assertContract(task, input.contractVersion);
    await validatePlanningArtifacts(ctx, task);
    let ticket = task.control?.recoveries.find(r => r.id === input.recoveryId);
    if (input.recoveryId === null) {
      const from = input.from!, source = state.claims[from.workspaceId];
      requireThat(task.control && from.taskId === task.id, "RECOVERY_SOURCE_REQUIRED", "Source must belong to this task");
      const historical = task.control.recoveries.some(r => canonicalJson(r.from) === canonicalJson(from));
      requireThat(matchesOccupancy(source, from) ? ["unknown-writer-hold", "released"].includes(source!.state) : historical,
        "OCCUPANCY_CHANGED", "Source is not a retained occupancy or a recorded historical recovery source");
      requireThat(!task.control.recoveries.some(r => r.assignmentId === from.assignmentId && ["pending", "reserved"].includes(r.state)),
        "RECOVERY_REQUIRED", "Use the existing current recovery ticket instead of replacing it implicitly");
      ticket = { id: randomUUID(), assignmentId: from.assignmentId, from: { ...from }, toInstanceId: meta.actor.instanceId,
        contractVersion: input.contractVersion, state: "pending", operationId: null, token: null };
      task.control.recoveries.push(ticket);
    }
    requireThat(ticket?.state === "pending" && ticket.toInstanceId === meta.actor.instanceId,
      "RECOVERY_ABORTED", "Recovery ticket was consumed, revoked or assigned to another executor");
    // Contract revisions require fresh recovery decisions, but do not erase the retained source directory.
    assertActorWork(task, meta.actor.instanceId, ticket.assignmentId);
    requireThat(ticket.assignmentId === null ? input.recoveryId !== null || task.owner.instanceId === meta.actor.instanceId
      : task.assignments[ticket.assignmentId]?.businessWrite && task.assignments[ticket.assignmentId]?.status === "open"
        && [null, meta.actor.instanceId].includes(task.assignments[ticket.assignmentId]!.assignee),
      "ASSIGNMENT_NOT_GRANTED", "Recovery is no longer assigned to this executor");
    const source = state.claims[ticket.from.workspaceId];
    const sameSource = matchesOccupancy(source, ticket.from);
    requireThat(!sameSource || ["unknown-writer-hold", "released"].includes(source!.state), "OCCUPANCY_CHANGED", "Original source is still active");
    const isolated = ticket.from.workspaceId !== ctx.workspaceId;
    if (input.stopBasis === "host-stop-receipt" || input.stopBasis === "user-declared-stop") {
      requireThat(input.stopReference?.trim(), "STOP_EVIDENCE_REQUIRED", "Identify the actual host receipt or user stop declaration");
    }
    if (input.stopBasis === "holder-release") requireThat(sameSource && source!.state === "released", "STOP_EVIDENCE_REQUIRED", "Holder release does not describe the current source");
    if (input.mode === "existing") {
      requireThat(sameSource, "OCCUPANCY_CHANGED", "The source directory was reused; select isolated snapshot or baseline recovery without touching its new occupant");
      requireThat(sameSource && !isolated && input.stopBasis !== "unknown" && input.snapshotId === null && input.baseCommit === null && !input.abandonUncaptured,
        "STOP_EVIDENCE_REQUIRED", "Existing files need a confirmed stopped source in this workspace");
    } else {
      requireThat(isolated, "ISOLATED_RECOVERY_REQUIRED", "Snapshot or baseline continuation needs another physical worktree");
      assertWorkspaceClaimable(state, ctx.workspaceId);
      requireThat(!(await gitOutput(ctx.worktreeRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])), "RECOVERY_CONFLICT", "Target has unconfirmed changes");
      const base = (await gitOutput(ctx.worktreeRoot, ["rev-parse", "--verify", "HEAD"])).trim();
      if (input.mode === "snapshot") {
        requireThat(input.snapshotId && !input.abandonUncaptured && input.baseCommit === null, "SNAPSHOT_UNAVAILABLE", "Select a complete recovery snapshot");
        const snapshot = await loadSnapshot(ctx, input.snapshotId);
        requireThat(snapshot.workspaceId === ticket.from.workspaceId && snapshot.baseCommit === base, "SNAPSHOT_UNAVAILABLE", "Snapshot source or target baseline differs");
        requireThat(currentContract(task).grant.allowedPaths.every(path => snapshot.scope.some(root => path === root || path.startsWith(`${root}/`))),
          "SNAPSHOT_UNAVAILABLE", "Recovery snapshot must cover every granted business path");
        snapshot.entries.forEach(e => assertWritablePath(task, e.path));
      } else {
        requireThat(input.mode === "baseline" && input.abandonUncaptured && input.snapshotId === null && input.baseCommit === base,
          "BASELINE_DECISION_REQUIRED", "Explicitly choose this exact clean Git commit and decline uncaptured source changes");
      }
    }
    requireThat(!Object.values(state.claims).some(c => c.taskId === task.id && c.assignmentId === ticket.assignmentId
      && ["writer", "restore-target"].includes(c.state)), "WORKSPACE_OCCUPIED", "A current executor already exists");
    const key = executionKey(task.id, ticket.assignmentId), epoch = (state.epochs[key] ?? 0) + 1;
    state.epochs[key] = epoch;
    if (input.stopBasis !== "unknown" && sameSource) state.claims[source!.workspaceId] = { ...source!, state: "released", recovery: null };
    const token: WriteToken = { taskId: task.id, assignmentId: ticket.assignmentId, workspaceId: ctx.workspaceId,
      instanceId: meta.actor.instanceId, contractVersion: input.contractVersion, epoch };
    state.claims[ctx.workspaceId] = input.mode === "snapshot"
      ? { ...token, state: "restore-target", recovery: { snapshotId: input.snapshotId!, operationId: meta.operationId } }
      : { ...token, state: "writer", recovery: null };
    ticket.state = "reserved"; ticket.operationId = meta.operationId; ticket.token = token;
    return [ticket.id, String(epoch)];
  });
  const state = await readState(ctx), task = getTask(state, input.taskId);
  const ticket = task.control?.recoveries.find(r => r.id === receipt.resourceIds[0]);
  requireThat(ticket && ["reserved", "completed"].includes(ticket.state) && ticket.operationId === meta.operationId
    && ticket.token?.epoch === Number(receipt.resourceIds[1]), "RECOVERY_ABORTED", "This recovery was revoked; old requests cannot restart it");
  const claim = state.claims[ctx.workspaceId];
  requireThat(claim && claim.instanceId === meta.actor.instanceId && claim.epoch === ticket.token.epoch,
    "STALE_WRITE_TOKEN", "Recovery target is no longer current");
  if (claim.state === "restore-target") {
    const snapshot = await loadSnapshot(ctx, claim.recovery.snapshotId);
    await restoreSnapshot(ctx, meta, { taskId: task.id, snapshotId: snapshot.id, token: ticket.token, expectedTargetBase: snapshot.baseCommit });
  }
  const token = ticket.token;
  const completeMeta = { ...meta, operationId: `resume-complete-${createHash("sha256").update(meta.operationId).digest("hex")}` };
  await mutateState(ctx, completeMeta, { command: "work.resume.complete", token }, async current => {
    await assertWriteToken(ctx, current, meta, token);
    const active = getTask(current, input.taskId).control!.recoveries.find(r => r.id === ticket.id)!;
    requireThat(active.state === "reserved", "RECOVERY_ABORTED", "Recovery no longer reserved");
    active.state = "completed"; return [ticket.id];
  });
  await assertWriteToken(ctx, await readState(ctx), meta, token);
  return toWriteToken(token);
}
