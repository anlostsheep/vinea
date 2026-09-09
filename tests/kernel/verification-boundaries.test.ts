import { test, expect } from "vitest";
import { makeGoalFixture, testEnvironment } from "../helpers/kernel-fixture.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { runVerification } from "../../src/kernel/verification.js";
import { recordReportedEvidence } from "../../src/kernel/evidence.js";
import { reviseContract } from "../../src/kernel/contracts.js";
import { recordCheckSet, finishGoal } from "../../src/kernel/delivery.js";

test("timeout and command-mutated inputs are unverified, not passes", async () => {
  const f = await makeGoalFixture();
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  const common = { taskId: f.task.id, contractVersion: 1, snapshotId: snapshot.id, phase: null, environment: testEnvironment(), commandAuthorization: { summary: "fixture verification", reference: null } };
  const timed = await runVerification(f.context, f.meta, { ...common, timeoutMs: 30, argv: [process.execPath, "-e", "setInterval(()=>{},1000)"] });
  expect(timed.result).toBe("unverified");
  const changed = await runVerification(f.context, f.meta, { ...common, timeoutMs: 5000, argv: [process.execPath, "-e", "require('fs').writeFileSync('src/app.ts','changed')"] });
  expect(changed.result).toBe("unverified");
});

test("TDD cannot accept a baseline GREEN without a preceding RED", async () => {
  const f = await makeGoalFixture(), { version: _, decision, ...draft } = f.task.contracts[0]!;
  await reviseContract(f.context, f.meta, { taskId: f.task.id, expectedVersion: 1, ownerEpoch: 1, contract: { ...draft, quality: "tdd" }, decision });
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  const common = { taskId: f.task.id, snapshotId: snapshot.id, contractVersion: 2, argv: ["test"], environment: testEnvironment(), summary: "observed fixture result" };
  async function greenCheck() {
    const e = await recordReportedEvidence(f.context, f.meta, { ...common, phase: "green", result: "pass", exitCode: 0 });
    const verification = [{ evidenceId: e.id, argv: common.argv, environment: common.environment }];
    const check = await recordCheckSet(f.context, f.meta, { taskId: f.task.id, contractVersion: 2, snapshotId: snapshot.id, independent: false,
      rows: [{ acceptanceId: "A1", result: "pass", evidenceIds: [e.id], summary: "reported pass", gapDecision: null }], verification });
    return { taskId: f.task.id, contractVersion: 2, ownerEpoch: 1, snapshotId: snapshot.id, checkSetIds: [check.id], contributionIds: [], exclusions: [], verification };
  }
  await expect(finishGoal(f.context, f.meta, await greenCheck())).rejects.toMatchObject({ code: "TDD_EVIDENCE_REQUIRED" });
  await recordReportedEvidence(f.context, f.meta, { ...common, phase: "red", result: "fail", exitCode: 1 });
  expect((await finishGoal(f.context, f.meta, await greenCheck())).contractVersion).toBe(2);
});
