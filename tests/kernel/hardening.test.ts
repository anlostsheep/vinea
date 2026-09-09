import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "vitest";
import { object, id } from "../../src/kernel/schema.js";
import { runVerification } from "../../src/kernel/verification.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { recordCheckSet, finishGoal } from "../../src/kernel/delivery.js";
import { openRepair } from "../../src/kernel/debug.js";
import { readState } from "../../src/kernel/store.js";
import { makeGoalFixture, testEnvironment } from "../helpers/kernel-fixture.js";

test("unknown inherited property names cannot bypass exact object and identifier validation", () => {
  expect(() => object({})({ toString: "shadow" })).toThrow();
  expect(() => id("toString")).toThrow();
});
test("retrying verification with the same operation does not execute the command twice", async () => {
  const f = await makeGoalFixture(), marker = join(f.root, "counter.txt");
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  const meta = f.meta;
  const input = { taskId: f.task.id, contractVersion: 1, snapshotId: snapshot.id, phase: null,
    argv: [process.execPath, "-e", "require('node:fs').appendFileSync(process.argv[1], 'x')", marker], timeoutMs: 5000,
    environment: testEnvironment(), commandAuthorization: { summary: "count one fixture invocation", reference: null } };
  const first = await runVerification(f.context, meta, input);
  expect((await runVerification(f.context, meta, input)).id).toBe(first.id);
  expect(await readFile(marker, "utf8")).toBe("x");
});
test("a repair links to the immutable delivered result rather than editing it", async () => {
  const f = await makeGoalFixture(), environment = testEnvironment(), argv = [process.execPath, "-e", "process.exit(0)"];
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  const evidence = await runVerification(f.context, f.meta, { taskId: f.task.id, contractVersion: 1, snapshotId: snapshot.id,
    argv, environment, phase: null, timeoutMs: 5000, commandAuthorization: { summary: "verify", reference: null } });
  const verification = [{ evidenceId: evidence.id, argv, environment }];
  const checks = await recordCheckSet(f.context, f.meta, { taskId: f.task.id, contractVersion: 1, snapshotId: snapshot.id, independent: false,
    verification, rows: [{ acceptanceId: "A1", result: "pass", evidenceIds: [evidence.id], summary: "verified", gapDecision: null }] });
  const delivery = await finishGoal(f.context, f.meta, { taskId: f.task.id, contractVersion: 1, ownerEpoch: 1, snapshotId: snapshot.id,
    contributionIds: [], exclusions: [], checkSetIds: [checks.id], verification });
  const before = JSON.stringify((await readState(f.context)).tasks[f.task.id]);
  const meta = f.meta; meta.invocation.entry = "debug";
  const repair = await openRepair(f.context, meta, { taskId: f.task.id, deliveryId: delivery.id, title: "Fix observed defect",
    expected: "one request", actual: "two requests", decision: { summary: "repair only", reference: null } });
  expect(repair.id).not.toBe(f.task.id);
  expect(repair.relatedTo).toEqual({ taskId: f.task.id, deliveryId: delivery.id });
  expect(JSON.stringify((await readState(f.context)).tasks[f.task.id])).toBe(before);
});
