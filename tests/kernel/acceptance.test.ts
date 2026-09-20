import { test, expect } from "vitest";
import { makeGoalFixture, testEnvironment, fingerprintFixtureTree, authorizeFixtureTask } from "../helpers/kernel-fixture.js";
import { claimWork, assertWriteToken } from "../../src/kernel/ownership.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { reviseContract } from "../../src/kernel/contracts.js";
import { readState } from "../../src/kernel/store.js";
import { recordReportedEvidence } from "../../src/kernel/evidence.js";
import { recordCheckSet, finishGoal } from "../../src/kernel/delivery.js";
import { submitContribution, integrateContribution } from "../../src/kernel/contributions.js";

test("contract revision fences old write tokens and old passing evidence", async () => {
  const f = await makeGoalFixture();
  const token = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token });
  const environment = testEnvironment(), argv = ["test"];
  const evidence = await recordReportedEvidence(f.context, f.meta, { taskId: f.task.id, snapshotId: snapshot.id,
    contractVersion: 1, result: "pass", phase: null, argv, exitCode: 0, summary: "reported test", environment });
  const { version: _, decision, ...contract } = f.task.contracts[0]!;
  await reviseContract(f.context, f.meta, { taskId: f.task.id, expectedVersion: 1, ownerEpoch: 1, contract, decision });
  const state = await readState(f.context);
  await expect(assertWriteToken(f.context, state, f.meta, token)).rejects.toThrowError(/contract/i);
  await expect(recordCheckSet(f.context, f.meta, { taskId: f.task.id, contractVersion: 2, snapshotId: snapshot.id, independent: false,
    rows: [{ acceptanceId: "A1", result: "pass", evidenceIds: [evidence.id], summary: "old", gapDecision: null }],
    verification: [{ evidenceId: evidence.id, argv, environment }] })).rejects.toMatchObject({ code: "EVIDENCE_VERSION_MISMATCH" });
  await expect(claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 2 })).rejects.toMatchObject({ code: "EXECUTION_NOT_AUTHORIZED" });
  await authorizeFixtureTask(f.context, f.actorA, f.task.id, 2);
  expect((await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 2 })).epoch).toBeGreaterThan(token.epoch);
});

test("submitted changes are not integrated or user-accepted; gaps remain explicit", async () => {
  const f = await makeGoalFixture();
  const token = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token });
  const contribution = await submitContribution(f.context, f.meta, { taskId: f.task.id, contribution: {
    kind: "change", assignmentId: null, contractVersion: 1, snapshotId: snapshot.id, evidenceIds: [], summary: "changed inputs", writeToken: token } });
  expect(contribution.integrated).toBeNull();
  const input = { taskId: f.task.id, snapshotId: snapshot.id, contractVersion: 1, independent: false,
    rows: [{ acceptanceId: "A1", result: "accepted-gap" as const, evidenceIds: [], summary: "external service unavailable", gapDecision: null }], verification: [] };
  await expect(recordCheckSet(f.context, f.meta, input)).rejects.toMatchObject({ code: "GAP_REQUIRES_DECISION" });
  const checks = await recordCheckSet(f.context, f.meta, { ...input, rows: [{ ...input.rows[0]!, gapDecision: { summary: "accept local-only coverage", reference: null } }] });
  const finish = { taskId: f.task.id, contractVersion: 1, ownerEpoch: 1, snapshotId: snapshot.id, checkSetIds: [checks.id], contributionIds: [contribution.id], exclusions: [], verification: [] };
  await expect(finishGoal(f.context, f.meta, finish)).rejects.toMatchObject({ code: "CONTRIBUTION_NOT_INTEGRATED" });
  await integrateContribution(f.context, f.meta, { taskId: f.task.id, contributionId: contribution.id, contractVersion: 1, ownerEpoch: 1, snapshotId: snapshot.id, rationale: "reviewed selected inputs" });
  const delivery = await finishGoal(f.context, f.meta, finish);
  expect(delivery.acceptedGaps).toHaveLength(1);
  expect((await readState(f.context)).tasks[f.task.id]!.userAcceptances).toEqual([]);
});

test("nonactivated mutations are rejected before even creating runtime directories", async () => {
  const f = await makeGoalFixture(), before = await fingerprintFixtureTree(f.context.storeRoot);
  const meta = f.meta; meta.invocation.activation = "none";
  await expect(claimWork(f.context, meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 })).rejects.toMatchObject({ code: "ACTIVATION_REQUIRED" });
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});
