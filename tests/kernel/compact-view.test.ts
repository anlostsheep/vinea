import { test, expect } from "vitest";
import { makeGoalFixture, testMeta, authorizeFixtureTask } from "../helpers/kernel-fixture.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { readState, mutateState } from "../../src/kernel/store.js";
import { continueGoal, clearWorkspaceHold, occupancyRef } from "../../src/kernel/continuation.js";
import { taskSummary, executeReadCommand } from "../../src/application.js";
import { createGoal } from "../../src/kernel/contracts.js";
import { controlView } from "../../src/kernel/control-policy.js";
import { claimWork } from "../../src/kernel/ownership.js";
import { pauseTask, takeOverTask } from "../../src/kernel/task-control.js";
import { controlInput } from "../helpers/task-control.js";
import { discoverRepository } from "../../src/kernel/repository.js";
import { resumeWork } from "../../src/kernel/resumption.js";

test("compact views select evidence by sequence, not random identifier order", async () => {
  const f = await makeGoalFixture();
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  await mutateState(f.context, f.meta, { fixture: "out-of-order-identifiers" }, state => {
    for (let i = 0; i < 25; i++) {
      const id = `e${String(25 - i).padStart(2, "0")}`;
      state.tasks[f.task.id]!.evidence[id] = { id, contractVersion: 1, snapshotId: snapshot.id, actor: f.actorA,
        source: "agent-report", result: "unverified", phase: null, argv: null, cwd: f.root,
        environment: { runtime: process.version, platform: process.platform, labels: {} }, exitCode: null,
        summary: "fixture", artifactId: null, sequence: i + 1 };
    }
    return [];
  });
  const summary = taskSummary((await readState(f.context)).tasks[f.task.id]!);
  const view = await continueGoal(f.context, f.meta, { taskId: f.task.id, assignmentId: null });
  expect(summary.evidenceIds).toHaveLength(20);
  expect(summary.evidenceIds.at(-1)).toBe("e01");
  expect(view.evidenceIds).toEqual(summary.evidenceIds);
});

test("task listing is bounded and advances with an explicit cursor", async () => {
  const f = await makeGoalFixture(), { version: _, decision, ...contract } = f.task.contracts[0]!;
  await createGoal(f.context, f.meta, { title: "second", contract, decision });
  const first = (await executeReadCommand(f.context, "task list", { limit: 1 })).data as { tasks: Array<{ id: string }>; nextAfter: string | null };
  expect(first.tasks).toHaveLength(1); expect(first.nextAfter).toBe(first.tasks[0]!.id);
  const second = (await executeReadCommand(f.context, "task list", { limit: 1, after: first.nextAfter! })).data as typeof first;
  expect(second.tasks).toHaveLength(1); expect(second.tasks[0]!.id).not.toBe(first.tasks[0]!.id);
  expect(second.nextAfter).toBeNull();
});

test("a task without retained work does not suggest recovery, and authorization names its actual entry", async () => {
  const f = await makeGoalFixture();
  const show = async () => (await executeReadCommand(f.context, "task show", { taskId: f.task.id })).data as ReturnType<typeof taskSummary>;
  expect((await show()).control.nextActions.join(" ")).not.toContain("work resume");
  await pauseTask(f.context, f.meta, await controlInput(f.context, f.task.id, "pause"));
  const before = await readState(f.context), summary = await show();
  expect(summary.control.nextActions.join(" ")).not.toContain("work resume");
  expect(summary.control.nextActions.join(" ")).toContain("task authorize through run/debug");
  expect(summary.control.nextActions.join(" ")).toContain("continue cannot create execution authority");
  expect(await readState(f.context)).toEqual(before);
});

test("show and read-only continuation expose the same held source and drop recovery guidance after its release", async () => {
  const f = await makeGoalFixture();
  const token = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  await pauseTask(f.context, testMeta(f.actorB), await controlInput(f.context, f.task.id, "pause"));
  const before = await readState(f.context);
  const summary = (await executeReadCommand(f.context, "task show", { taskId: f.task.id })).data as ReturnType<typeof taskSummary>;
  const meta = testMeta(f.actorB, "continue"); meta.invocation.persist = false;
  const continuation = await continueGoal(f.context, meta, { taskId: f.task.id, assignmentId: null });
  const control = continuation.control as ReturnType<typeof controlView>;
  expect(summary.control.recoverySources).toContainEqual(occupancyRef(token));
  expect(control.recoverySources).toEqual(summary.control.recoverySources);
  expect(summary.control.nextActions.join(" ")).toContain("recoveryId:null");
  expect(summary.control.nextActions.join(" ")).toContain("holder-release");
  expect(summary.control.nextActions.join(" ")).not.toContain("occupiedWrites");
  expect(await readState(f.context)).toEqual(before);
  await clearWorkspaceHold(f.context, f.meta, { from: occupancyRef(token), stopBasis: "holder-release", stopReference: null, decision: null });
  const released = (await executeReadCommand(f.context, "task show", { taskId: f.task.id })).data as ReturnType<typeof taskSummary>;
  expect(released.control.nextActions.join(" ")).not.toContain("work resume");
  expect(released.control.nextActions.join(" ")).not.toContain("work clear-hold");
  await authorizeFixtureTask(f.context, f.actorA, f.task.id);
  await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
});

test.each([true, false])("pending recovery guidance reflects hold release=%s, and a recovered writer is not told to recover again", async clearHold => {
  const f = await makeGoalFixture(), target = await discoverRepository(f.linkedRoot);
  const old = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: old });
  const takeover = await takeOverTask(target, testMeta(f.actorB), await controlInput(target, f.task.id, "takeover"));
  expect(takeover.current.nextActions.join(" ")).toContain("pending recoveries[].id");
  if (clearHold) await clearWorkspaceHold(f.context, f.meta, { from: occupancyRef(old), stopBasis: "holder-release", stopReference: null, decision: null });
  const summary = (await executeReadCommand(target, "task show", { taskId: f.task.id })).data as ReturnType<typeof taskSummary>;
  expect(summary.control.nextActions.join(" ")).toContain("pending recoveries[].id");
  expect(summary.control.nextActions.join(" ").includes("work clear-hold")).toBe(!clearHold);
  await expect(claimWork(target, testMeta(f.actorB), { taskId: f.task.id, assignmentId: null, contractVersion: 1 }))
    .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  await resumeWork(target, testMeta(f.actorB), { taskId: f.task.id, contractVersion: 1, recoveryId: summary.control.recoveries[0]!.id,
    request: { action: "resume", userMessage: "Restore the selected snapshot", reference: "fixture:view-resume" },
    mode: "snapshot", stopBasis: "unknown", stopReference: null, snapshotId: snapshot.id, baseCommit: null, abandonUncaptured: false });
  const after = await readState(target), task = after.tasks[f.task.id]!;
  const hint = controlView(task, Object.values(after.claims));
  expect(hint.recoverySources).toHaveLength(clearHold ? 0 : 1);
  expect(hint.nextActions.join(" ")).not.toContain("work resume");
});
