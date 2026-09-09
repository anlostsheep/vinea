import { test, expect } from "vitest";
import { recordDiagnostic, openRepair } from "../../src/kernel/debug.js";
import { readState, mutateState } from "../../src/kernel/store.js";
import { continueGoal } from "../../src/kernel/continuation.js";
import { makeGoalFixture, fingerprintFixtureTree } from "../helpers/kernel-fixture.js";

test("debug hypotheses stay hypotheses and analysis-only does not gain write authorization", async () => {
  const f = await makeGoalFixture();
  await recordDiagnostic(f.context, f.meta, { taskId: f.task.id, kind: "hypothesis", text: "possible reentrancy", evidenceIds: [] });
  const view = await continueGoal(f.context, { ...f.meta, actor: f.actorB }, { taskId: f.task.id, assignmentId: null });
  expect(view.diagnostics[0]?.kind).toBe("hypothesis");
  const before = await fingerprintFixtureTree(f.context.storeRoot), meta = f.meta; meta.invocation.persist = false;
  await expect(recordDiagnostic(f.context, meta, { taskId: f.task.id, kind: "fact", text: "not persisted", evidenceIds: [] })).rejects.toMatchObject({ code: "PERSISTENCE_DISABLED" });
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});
