import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createGoal } from "../../src/kernel/contracts.js";
import { continueGoal, takeoverWork } from "../../src/kernel/continuation.js";
import { finishGoal, recordCheckSet } from "../../src/kernel/delivery.js";
import { addAssignment, claimWork, releaseWork } from "../../src/kernel/ownership.js";
import { discoverRepository, newActor } from "../../src/kernel/repository.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { readState } from "../../src/kernel/store.js";
import type { Actor, RepositoryContext } from "../../src/kernel/types.js";
import { runVerification } from "../../src/kernel/verification.js";
import { authorizeFixtureTask } from "../helpers/kernel-fixture.js";
import { git, makeGoalFixture, testEnvironment, testMeta } from "../helpers/kernel-fixture.js";

const fault = vi.hoisted(() => ({ enabled: false }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: async (from: string, to: string) => {
    if (fault.enabled && from.endsWith(".vinea-restore")) {
      fault.enabled = false; throw new Error("injected restore interruption");
    }
    return actual.rename(from, to);
  } };
});
afterEach(() => { fault.enabled = false; });

async function deliveryInput(ctx: RepositoryContext, actor: Actor, taskId: string) {
  const snapshot = await captureSnapshot(ctx, testMeta(actor), { taskId, paths: ["src"], token: null });
  const argv = [process.execPath, "-e", "process.exit(0)"], environment = testEnvironment();
  const evidence = await runVerification(ctx, testMeta(actor), { taskId, contractVersion: 1, snapshotId: snapshot.id,
    argv, environment, phase: null, timeoutMs: 5000, commandAuthorization: { summary: "verify fixture", reference: null } });
  const verification = [{ evidenceId: evidence.id, argv, environment }];
  const checks = await recordCheckSet(ctx, testMeta(actor), { taskId, contractVersion: 1, snapshotId: snapshot.id, independent: false,
    rows: [{ acceptanceId: "A1", result: "pass", evidenceIds: [evidence.id], summary: "observed pass", gapDecision: null }], verification });
  return { taskId, contractVersion: 1, ownerEpoch: 1, snapshotId: snapshot.id, checkSetIds: [checks.id],
    contributionIds: [], exclusions: [], verification };
}

test.each([true, false])("finish waits for a remote writer without changing state; owner claimed=%s", async ownerClaimed => {
  const f = await makeGoalFixture(), peer = await discoverRepository(f.linkedRoot);
  const assignment = await addAssignment(f.context, f.meta, { taskId: f.task.id, ownerEpoch: 1,
    assignment: { outcome: "peer change", dependsOn: [], assignee: f.actorB.instanceId, businessWrite: true } });
  if (ownerClaimed) await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const token = await claimWork(peer, testMeta(f.actorB), { taskId: f.task.id, assignmentId: assignment.id, contractVersion: 1 });
  const input = await deliveryInput(f.context, f.actorA, f.task.id), meta = f.meta;
  const before = await readState(f.context);
  await expect(finishGoal(f.context, meta, input)).rejects.toMatchObject({ code: "WORKSPACE_OCCUPIED" });
  expect(await readState(f.context)).toEqual(before);
  await releaseWork(peer, testMeta(f.actorB), token);
  expect((await finishGoal(f.context, meta, input)).snapshotId).toBe(input.snapshotId);
  const after = await readState(f.context);
  expect(after.tasks[f.task.id]!.status).toBe("delivered");
  expect(after.claims[peer.workspaceId]!.state).toBe("released");
  if (ownerClaimed) expect(after.claims[f.context.workspaceId]!.state).toBe("released");
});

test("finish preserves pending remote recovery and allows its retained source hold after release", async () => {
  const f = await makeGoalFixture(), peer = await discoverRepository(f.linkedRoot), actorC = newActor("codex");
  const recoveryRoot = join(f.directory, "recovery workspace");
  await git(f.root, "worktree", "add", "--detach", recoveryRoot);
  const target = await discoverRepository(recoveryRoot);
  const assignment = await addAssignment(f.context, f.meta, { taskId: f.task.id, ownerEpoch: 1,
    assignment: { outcome: "peer recovery", dependsOn: [], assignee: f.actorB.instanceId, businessWrite: true } });
  await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const old = await claimWork(peer, testMeta(f.actorB), { taskId: f.task.id, assignmentId: assignment.id, contractVersion: 1 });
  await writeFile(join(f.linkedRoot, "src/app.ts"), "export const value = 2;\n");
  const snapshot = await captureSnapshot(peer, testMeta(f.actorB), { taskId: f.task.id, paths: ["src"], token: old });
  const recoveryMeta = testMeta(actorC), view = await continueGoal(target, recoveryMeta, { taskId: f.task.id, assignmentId: assignment.id });
  const transfer = { from: view.occupiedWrites.find(w => w.ref.workspaceId === peer.workspaceId)!.ref,
    to: actorC, contractVersion: 1, transferOwner: false, ownerEpoch: null,
    decision: { summary: "recover peer in isolation", reference: null }, stopBasis: "unknown" as const,
    stopReference: null, baselineSnapshotId: snapshot.id };
  fault.enabled = true;
  await expect(takeoverWork(target, recoveryMeta, transfer)).rejects.toThrow("injected restore interruption");
  const input = await deliveryInput(f.context, f.actorA, f.task.id), finishMeta = f.meta;
  const before = await readState(f.context);
  expect(before.claims[target.workspaceId]!.state).toBe("restore-target");
  await expect(finishGoal(f.context, finishMeta, input)).rejects.toMatchObject({ code: "WORKSPACE_OCCUPIED" });
  expect(await readState(f.context)).toEqual(before);
  const restored = await takeoverWork(target, recoveryMeta, transfer);
  expect(await readFile(join(recoveryRoot, "src/app.ts"), "utf8")).toBe("export const value = 2;\n");
  await releaseWork(target, testMeta(actorC), restored);
  await finishGoal(f.context, finishMeta, input);
  const after = await readState(f.context);
  expect(after.tasks[f.task.id]!.status).toBe("delivered");
  expect(after.claims[peer.workspaceId]!.state).toBe("unknown-writer-hold");
  expect(after.claims[target.workspaceId]!.state).toBe("released");
});

test("finish leaves another task's remote writer untouched", async () => {
  const f = await makeGoalFixture(), peer = await discoverRepository(f.linkedRoot);
  const { version: _, decision, ...contract } = f.task.contracts[0]!;
  const other = await createGoal(peer, testMeta(f.actorB), { title: "unrelated task", contract, decision });
  await authorizeFixtureTask(peer, f.actorB, other.id);
  await claimWork(peer, testMeta(f.actorB), { taskId: other.id, assignmentId: null, contractVersion: 1 });
  const peerClaim = (await readState(f.context)).claims[peer.workspaceId];
  const input = await deliveryInput(f.context, f.actorA, f.task.id);
  await finishGoal(f.context, f.meta, input);
  const after = await readState(f.context);
  expect(after.tasks[f.task.id]!.status).toBe("delivered");
  expect(after.claims[peer.workspaceId]).toEqual(peerClaim);
});
