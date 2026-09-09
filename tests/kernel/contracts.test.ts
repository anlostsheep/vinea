import { test, expect } from "vitest";
import { createGoal, reviseContract } from "../../src/kernel/contracts.js";
import { assertEntry } from "../../src/kernel/policy.js";
import { readState } from "../../src/kernel/store.js";
import { makeGoalFixture, fingerprintFixtureTree } from "../helpers/kernel-fixture.js";

test("analysis and check entries cannot acquire business write despite the task grant", async () => {
  const f = await makeGoalFixture();
  for (const entry of ["brainstorm", "plan", "check"] as const) {
    const meta = f.meta; meta.invocation.entry = entry;
    expect(() => assertEntry(meta, f.task, "business-write")).toThrow();
  }
});
test("contract history is appended with explicit decisions and stale revisions are rejected", async () => {
  const f = await makeGoalFixture(), previous = f.task.contracts[0]!;
  const { version: _, decision: __, ...draft } = previous;
  const revised = await reviseContract(f.context, f.meta, { taskId: f.task.id, expectedVersion: 1,
    ownerEpoch: 1, contract: { ...draft, constraints: ["Do not commit", "Frozen API"] }, decision: { summary: "freeze API", reference: null } });
  expect(revised.version).toBe(2);
  expect((await readState(f.context)).tasks[f.task.id]?.contracts[0]).toEqual(previous);
  await expect(reviseContract(f.context, f.meta, { taskId: f.task.id, expectedVersion: 1, ownerEpoch: 1,
    contract: draft, decision: { summary: "stale", reference: null } })).rejects.toMatchObject({ code: "CONTRACT_VERSION_CHANGED" });
});
test("none activation and persist false leave the whole shared store unchanged", async () => {
  const f = await makeGoalFixture(), { version: _, decision, ...contract } = f.task.contracts[0]!;
  const before = await fingerprintFixtureTree(f.context.storeRoot);
  const meta = f.meta; meta.invocation.activation = "none";
  await expect(createGoal(f.context, meta, { title: "unauthorized", contract, decision })).rejects.toMatchObject({ code: "ACTIVATION_REQUIRED" });
  meta.invocation.activation = "named-entry"; meta.invocation.persist = false;
  await expect(createGoal(f.context, meta, { title: "unpersisted", contract, decision })).rejects.toMatchObject({ code: "PERSISTENCE_DISABLED" });
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});

test("discussion does not create an execution task even with a zero-grant payload", async () => {
  const f = await makeGoalFixture(), { version: _, decision, ...contract } = f.task.contracts[0]!;
  const meta = f.meta; meta.invocation.entry = "brainstorm";
  await expect(createGoal(f.context, meta, { title: "discuss", decision, contract: { ...contract,
    grant: { businessWrite: false, delegate: false, commit: false, deploy: false, allowedPaths: [] } } })).rejects.toMatchObject({ code: "ENTRY_SCOPE_DENIED" });
});

test("planning cannot widen writable paths and no revision can erase acceptance", async () => {
  const f = await makeGoalFixture(), { version: _, decision, ...contract } = f.task.contracts[0]!;
  const meta = f.meta; meta.invocation.entry = "plan";
  await expect(reviseContract(f.context, meta, { taskId: f.task.id, expectedVersion: 1, ownerEpoch: 1, decision,
    contract: { ...contract, grant: { ...contract.grant, allowedPaths: ["src", "production"] } } })).rejects.toMatchObject({ code: "ENTRY_SCOPE_DENIED" });
  await expect(reviseContract(f.context, f.meta, { taskId: f.task.id, expectedVersion: 1, ownerEpoch: 1, decision,
    contract: { ...contract, acceptance: [] } })).rejects.toMatchObject({ code: "ACCEPTANCE_REQUIRED" });
});
