import { test, expect } from "vitest";
import { makeGoalFixture } from "../helpers/kernel-fixture.js";
import { assertRepositoryState, canonicalJson } from "../../src/kernel/schema.js";
import { readState } from "../../src/kernel/store.js";

test("canonical data rejects non-JSON values and cyclic graphs", () => {
  expect(canonicalJson({ b: [2, 1], a: 1 })).toBe('{"a":1,"b":[2,1]}');
  for (const value of [NaN, Infinity, undefined, () => 1]) expect(() => canonicalJson({ value })).toThrow();
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  expect(() => canonicalJson(cycle)).toThrow();
});

test("state validation rejects dangling contribution and repair references", async () => {
  const f = await makeGoalFixture(), state = await readState(f.context);
  const badContribution = structuredClone(state);
  badContribution.tasks[f.task.id]!.contributions.bad = { id: "bad", kind: "analysis", assignmentId: null,
    contractVersion: 1, submittedBy: f.actorA.instanceId, snapshotId: null, evidenceIds: ["absent"], summary: "bad", writeToken: null, integrated: null };
  expect(() => assertRepositoryState(badContribution)).toThrow();
  const badRepair = structuredClone(state);
  badRepair.tasks[f.task.id]!.relatedTo = { taskId: "absent", deliveryId: "absent" };
  expect(() => assertRepositoryState(badRepair)).toThrow();
});

test("cyclic assignments and broken receipt identity are rejected", async () => {
  const f = await makeGoalFixture(), state = await readState(f.context);
  const cycle = structuredClone(state);
  cycle.tasks[f.task.id]!.assignments.a = { id: "a", outcome: "cycle", dependsOn: ["a"], assignee: null, businessWrite: false, status: "open" };
  expect(() => assertRepositoryState(cycle)).toThrow();
  const broken = structuredClone(state);
  Object.values(broken.operations)[0]!.operationId = "mismatch";
  expect(() => assertRepositoryState(broken)).toThrow();
});
