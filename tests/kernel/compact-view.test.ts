import { test, expect } from "vitest";
import { makeGoalFixture } from "../helpers/kernel-fixture.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { readState, mutateState } from "../../src/kernel/store.js";
import { continueGoal } from "../../src/kernel/continuation.js";
import { taskSummary, executeReadCommand } from "../../src/application.js";
import { createGoal } from "../../src/kernel/contracts.js";

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
