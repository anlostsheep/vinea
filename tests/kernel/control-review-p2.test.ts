import { expect, test } from "vitest";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { makeGoalFixture, testMeta, authorizeFixtureTask, git } from "../helpers/kernel-fixture.js";
import { controlInput } from "../helpers/task-control.js";
import { addAssignment, claimWork, assertWriteToken } from "../../src/kernel/ownership.js";
import { takeOverTask, cancelTask, reopenTask, pauseTask } from "../../src/kernel/task-control.js";
import { clearWorkspaceHold, handoffWork, takeoverWork, occupancyRef } from "../../src/kernel/continuation.js";
import { resumeWork } from "../../src/kernel/resumption.js";
import { readState } from "../../src/kernel/store.js";
import { discoverRepository, newActor } from "../../src/kernel/repository.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { createGoal } from "../../src/kernel/contracts.js";

async function fixture() {
  const f = await makeGoalFixture(), c = newActor("replacement"), d = newActor("next-owner");
  const bctx = await discoverRepository(f.linkedRoot);
  const old = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  await writeFile(join(f.root, "src/app.ts"), "preserved source\n");
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: old });
  return { ...f, get meta() { return testMeta(f.actorA); }, c, d, bctx, old, snapshot };
}

test.each(["takeover", "handoff"])("P2-1: revoked owner cannot return through legacy %s on another assignment", async mode => {
  const f = await fixture();
  const x = await addAssignment(f.context, f.meta, { taskId: f.task.id, ownerEpoch: 1,
    assignment: { outcome: "retain B", dependsOn: [], assignee: f.actorB.instanceId, businessWrite: true } });
  const btoken = await claimWork(f.bctx, testMeta(f.actorB), { taskId: f.task.id, assignmentId: x.id, contractVersion: 1 });
  await takeOverTask(f.context, testMeta(f.c), await controlInput(f.context, f.task.id, "takeover"));
  const before = await readState(f.context), task = before.tasks[f.task.id]!;
  const input = { from: occupancyRef(btoken), to: f.actorA, contractVersion: 1, transferOwner: true, ownerEpoch: task.owner.epoch,
    decision: { summary: "old control path", reference: null } };
  const attempt = mode === "handoff" ? handoffWork(f.bctx, testMeta(f.actorB), input)
    : takeoverWork(f.bctx, f.meta, { ...input, stopBasis: "user-declared-stop", stopReference: null, baselineSnapshotId: null });
  await expect(attempt).rejects.toMatchObject({ code: "EXECUTOR_REPLACED" });
  expect(await readState(f.context)).toEqual(before);
  await assertWriteToken(f.bctx, before, testMeta(f.actorB), btoken);
});

test.each(["other-task", "other-assignment"])("P2-2: inherited source reused by %s remains untouched and isolated recovery works", async reuse => {
  const f = await fixture(), occupant = newActor("unrelated-writer");
  await takeOverTask(f.bctx, testMeta(f.c), await controlInput(f.context, f.task.id, "takeover"));
  await clearWorkspaceHold(f.context, testMeta(f.c), { from: occupancyRef(f.old), stopBasis: "user-declared-stop", stopReference: "fixture:stopped",
    decision: { summary: "A stopped", reference: "fixture:stopped" } });
  let taskId = f.task.id, assignmentId: string | null = null;
  if (reuse === "other-task") {
    const { version: _, decision: __, ...contract } = f.task.contracts[0]!;
    const task = await createGoal(f.context, testMeta(occupant), { title: "other task", contract, decision: { summary: "separate work", reference: null } });
    taskId = task.id; await authorizeFixtureTask(f.context, occupant, taskId);
  } else {
    const task = (await readState(f.context)).tasks[taskId]!;
    const assignment = await addAssignment(f.context, testMeta(f.c), { taskId, ownerEpoch: task.owner.epoch,
      assignment: { outcome: "different work", dependsOn: [], assignee: occupant.instanceId, businessWrite: true } });
    assignmentId = assignment.id;
  }
  const unrelated = await claimWork(f.context, testMeta(occupant), { taskId, assignmentId, contractVersion: 1 });
  const before = (await readState(f.context)).claims[f.context.workspaceId];
  await takeOverTask(f.bctx, testMeta(f.d), await controlInput(f.context, f.task.id, "takeover"));
  expect((await readState(f.context)).claims[f.context.workspaceId]).toEqual(before);
  const task = (await readState(f.context)).tasks[f.task.id]!;
  const ticket = task.control!.recoveries.find(r => r.state === "pending")!;
  expect(ticket.from).toEqual(occupancyRef(f.old));
  await expect(resumeWork(f.context, testMeta(f.d), { taskId: f.task.id, contractVersion: 1, recoveryId: ticket.id,
    request: { action: "resume", userMessage: "Try to reuse the old directory", reference: "fixture:wrong-source" },
    mode: "existing", stopBasis: "user-declared-stop", stopReference: "fixture:A-stopped", snapshotId: null, baseCommit: null, abandonUncaptured: false }))
    .rejects.toMatchObject({ code: "OCCUPANCY_CHANGED" });
  const token = await resumeWork(f.bctx, testMeta(f.d), { taskId: f.task.id, contractVersion: 1, recoveryId: ticket.id,
    request: { action: "resume", userMessage: "Use the preserved snapshot in isolation", reference: "fixture:isolated-recovery" },
    mode: "snapshot", stopBasis: "unknown", stopReference: null, snapshotId: f.snapshot.id, baseCommit: null, abandonUncaptured: false });
  expect(await readFile(join(f.linkedRoot, "src/app.ts"), "utf8")).toBe("preserved source\n");
  expect((await readState(f.context)).claims[f.context.workspaceId]).toEqual(before);
  await assertWriteToken(f.context, await readState(f.context), testMeta(occupant), unrelated);
  await assertWriteToken(f.bctx, await readState(f.context), testMeta(f.d), token);
});

test.each(["cancel-reopen", "takeover-pause"])("P2-3: %s can create a fresh snapshot recovery without reviving old operations", async mode => {
  const f = await fixture();
  if (mode === "takeover-pause") {
    await takeOverTask(f.bctx, testMeta(f.c), await controlInput(f.context, f.task.id, "takeover"));
    await pauseTask(f.context, f.meta, await controlInput(f.context, f.task.id, "pause"));
  } else {
    await cancelTask(f.bctx, testMeta(f.c), await controlInput(f.context, f.task.id, "cancel"));
    await reopenTask(f.bctx, testMeta(f.c), await controlInput(f.context, f.task.id, "reopen"));
  }
  const task = (await readState(f.context)).tasks[f.task.id]!, version = task.contracts.at(-1)!.version;
  await authorizeFixtureTask(f.bctx, f.c, task.id, version, task.owner.epoch);
  const before = await readState(f.context);
  await expect(claimWork(f.bctx, testMeta(f.c), { taskId: task.id, assignmentId: null, contractVersion: version }))
    .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  const token = await resumeWork(f.bctx, testMeta(f.c), { taskId: task.id, contractVersion: version, recoveryId: null,
    from: occupancyRef(f.old), request: { action: "resume", userMessage: "Fresh recovery from this held source", reference: "fixture:fresh-recovery" },
    mode: "snapshot", stopBasis: "unknown", stopReference: null, snapshotId: f.snapshot.id, baseCommit: null, abandonUncaptured: false });
  const after = await readState(f.context);
  expect(after.claims[f.context.workspaceId]).toEqual(before.claims[f.context.workspaceId]);
  expect(after.tasks[task.id]!.control!.recoveries.filter(r => r.state === "aborted")).toEqual(task.control!.recoveries.filter(r => r.state === "aborted"));
  expect(await readFile(join(f.linkedRoot, "src/app.ts"), "utf8")).toBe("preserved source\n");
  await assertWriteToken(f.bctx, after, testMeta(f.c), token);
  expect(await claimWork(f.bctx, testMeta(f.c), { taskId: task.id, assignmentId: null, contractVersion: version })).toEqual(token);
});

test("P2-3: fresh baseline recovery after reopening still requires the user's explicit baseline choice", async () => {
  const f = await fixture();
  await cancelTask(f.bctx, testMeta(f.c), await controlInput(f.context, f.task.id, "cancel"));
  await reopenTask(f.bctx, testMeta(f.c), await controlInput(f.context, f.task.id, "reopen"));
  const task = (await readState(f.context)).tasks[f.task.id]!;
  await authorizeFixtureTask(f.bctx, f.c, task.id, 2, task.owner.epoch);
  const input = { taskId: task.id, contractVersion: 2, recoveryId: null, from: occupancyRef(f.old),
    request: { action: "resume" as const, userMessage: "Start from the selected isolated commit", reference: "fixture:reopen-baseline" },
    mode: "baseline" as const, stopBasis: "unknown" as const, stopReference: null, snapshotId: null,
    baseCommit: (await git(f.linkedRoot, "rev-parse", "HEAD")).trim(), abandonUncaptured: false };
  const before = await readState(f.context);
  await expect(resumeWork(f.bctx, testMeta(f.c), input)).rejects.toMatchObject({ code: "BASELINE_DECISION_REQUIRED" });
  expect(await readState(f.context)).toEqual(before);
  const next = await resumeWork(f.bctx, testMeta(f.c), { ...input, abandonUncaptured: true });
  await assertWriteToken(f.bctx, await readState(f.context), testMeta(f.c), next);
  expect(await readFile(join(f.root, "src/app.ts"), "utf8")).toBe("preserved source\n");
});
