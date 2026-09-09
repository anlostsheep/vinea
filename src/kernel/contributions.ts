import { randomUUID } from "node:crypto";
import { requireThat } from "./errors.js";
import { mutateState, readState } from "./store.js";
import { assertEntry, assertContract, assertOwner, getTask } from "./policy.js";
import { assertWriteToken } from "./ownership.js";
import { compareSnapshot, loadSnapshot } from "./snapshots.js";
import type { Contribution, RepositoryContext, Meta, Id } from "./types.js";

export async function submitContribution(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; contribution: Omit<Contribution, "id" | "submittedBy" | "integrated">;
}): Promise<Contribution> {
  const c = input.contribution;
  if (c.kind === "change") {
    requireThat(c.snapshotId && c.writeToken, "CONTRIBUTION_INVALID", "Changes require a snapshot and write token");
    const snapshot = await loadSnapshot(ctx, c.snapshotId);
    requireThat(snapshot.workspaceId === ctx.workspaceId && (await compareSnapshot(ctx, snapshot)).matches,
      "SNAPSHOT_CHANGED", "Contribution must describe this workspace's current inputs");
  }
  const receipt = await mutateState(ctx, meta, { command: "contribution.submit", input }, state => {
    const task = getTask(state, input.taskId); assertEntry(meta, task, "state-write"); assertContract(task, c.contractVersion);
    if (c.kind === "change") {
      requireThat(c.writeToken && c.writeToken.taskId === task.id && c.writeToken.assignmentId === c.assignmentId, "CONTRIBUTION_INVALID", "Contribution and token refer to different work");
      assertWriteToken(ctx, state, meta, c.writeToken);
    }
    requireThat(c.evidenceIds.every(e => !!task.evidence[e]), "EVIDENCE_NOT_FOUND", "Contribution evidence is absent");
    const contribution = { ...structuredClone(c), id: randomUUID(), submittedBy: meta.actor.instanceId, integrated: null };
    task.contributions[contribution.id] = contribution; return [contribution.id];
  });
  return (await readState(ctx)).tasks[input.taskId]!.contributions[receipt.resourceIds[0]!]!;
}
export async function integrateContribution(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; contributionId: Id; contractVersion: number; ownerEpoch: number; snapshotId: Id; rationale: string;
}): Promise<Contribution> {
  const snapshot = await loadSnapshot(ctx, input.snapshotId);
  requireThat((await compareSnapshot(ctx, snapshot)).matches, "SNAPSHOT_CHANGED", "Integrated inputs have changed");
  await mutateState(ctx, meta, { command: "contribution.integrate", input }, state => {
    const task = getTask(state, input.taskId); assertEntry(meta, task, "state-write"); assertOwner(task, meta, input.ownerEpoch); assertContract(task, input.contractVersion);
    const c = task.contributions[input.contributionId];
    requireThat(c && c.contractVersion === input.contractVersion, "EVIDENCE_VERSION_MISMATCH", "Contribution is absent or uses an older contract");
    requireThat(input.rationale.trim(), "RATIONALE_REQUIRED", "Explain the integration decision");
    c.integrated = { snapshotId: snapshot.id, owner: { ...task.owner }, rationale: input.rationale };
    return [c.id];
  });
  return (await readState(ctx)).tasks[input.taskId]!.contributions[input.contributionId]!;
}
