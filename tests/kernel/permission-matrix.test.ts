import { test, expect } from "vitest";
import { makeGoalFixture, testEnvironment, testMeta, fingerprintFixtureTree } from "../helpers/kernel-fixture.js";
import { claimWork, addAssignment } from "../../src/kernel/ownership.js";
import { handoffWork, continueGoal } from "../../src/kernel/continuation.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { reviseContract } from "../../src/kernel/contracts.js";
import { recordDiagnostic, openRepair } from "../../src/kernel/debug.js";
import { recordReportedEvidence } from "../../src/kernel/evidence.js";
import { recordCheckSet } from "../../src/kernel/delivery.js";
import { importLegacy } from "../../src/legacy/import.js";
import { readState } from "../../src/kernel/store.js";

test("persist false covers state, snapshots, bindings, diagnostics, checks and import", async () => {
  const f = await makeGoalFixture(), snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  const before = await fingerprintFixtureTree(f.context.storeRoot), meta = f.meta; meta.invocation.persist = false;
  const { version: _, decision, ...contract } = f.task.contracts[0]!;
  const actions = [
    () => claimWork(f.context, meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 }),
    () => captureSnapshot(f.context, meta, { taskId: f.task.id, paths: ["src"], token: null }),
    () => reviseContract(f.context, meta, { taskId: f.task.id, expectedVersion: 1, ownerEpoch: 1, contract, decision }),
    () => recordDiagnostic(f.context, meta, { taskId: f.task.id, kind: "hypothesis", text: "investigate", evidenceIds: [] }),
    () => openRepair(f.context, meta, { taskId: f.task.id, deliveryId: null, title: "repair", expected: "works", actual: "fails", decision }),
    () => recordReportedEvidence(f.context, meta, { taskId: f.task.id, snapshotId: snapshot.id, contractVersion: 1, result: "unverified", phase: null, argv: null, exitCode: null, summary: "pending", environment: testEnvironment() }),
    () => recordCheckSet(f.context, meta, { taskId: f.task.id, snapshotId: snapshot.id, contractVersion: 1, independent: false, rows: [], verification: [] }),
    () => importLegacy(f.context, meta, { sourceRoot: "absent", expectedFingerprint: "absent", decision }),
  ];
  for (const action of actions) await expect(action()).rejects.toMatchObject({ code: "PERSISTENCE_DISABLED" });
  expect((await continueGoal(f.context, meta, { taskId: f.task.id, assignmentId: null })).writeToken).toBeNull();
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});

test("a contributor cannot transfer the delivery owner's role without a decision", async () => {
  const f = await makeGoalFixture(), b = testMeta(f.actorB);
  const assignment = await addAssignment(f.context, f.meta, { taskId: f.task.id, ownerEpoch: 1,
    assignment: { outcome: "change", dependsOn: [], assignee: f.actorB.instanceId, businessWrite: true } });
  const token = await claimWork(f.context, b, { taskId: f.task.id, assignmentId: assignment.id, contractVersion: 1 });
  const { contractVersion: _, ...from } = token;
  await expect(handoffWork(f.context, testMeta(f.actorB), { from, to: f.actorB, contractVersion: 1, transferOwner: true, ownerEpoch: 1, decision: null })).rejects.toMatchObject({ code: "TRANSFER_DECISION_REQUIRED" });
  expect((await readState(f.context)).tasks[f.task.id]!.owner.instanceId).toBe(f.actorA.instanceId);
});

test("a handed-off writer can refresh its token after an owner-approved contract revision", async () => {
  const f = await makeGoalFixture();
  const token = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const { contractVersion: _, ...from } = token;
  const transferred = await handoffWork(f.context, f.meta, { from, to: f.actorB, contractVersion: 1, transferOwner: false, ownerEpoch: null, decision: null });
  const { version: __, decision, ...contract } = f.task.contracts[0]!;
  await reviseContract(f.context, f.meta, { taskId: f.task.id, expectedVersion: 1, ownerEpoch: 1, contract, decision });
  const next = await claimWork(f.context, testMeta(f.actorB), { taskId: f.task.id, assignmentId: null, contractVersion: 2 });
  expect(next.epoch).toBeGreaterThan(transferred.epoch);
  expect(next.instanceId).toBe(f.actorB.instanceId);
});
