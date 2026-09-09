import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "vitest";
import { recordCheckSet, finishGoal } from "../../src/kernel/delivery.js";
import { runVerification } from "../../src/kernel/verification.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { makeGoalFixture, testEnvironment } from "../helpers/kernel-fixture.js";

test("uncommitted delivery uses current snapshot and refuses changed environment", async () => {
  const f = await makeGoalFixture();
  await writeFile(join(f.root, "src/app.ts"), "export const value = 2;\n");
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  const argv = [process.execPath, "-e", "process.exit(0)"], environment = testEnvironment();
  const e = await runVerification(f.context, f.meta, { taskId: f.task.id, snapshotId: snapshot.id, contractVersion: 1,
    argv, environment, phase: null, timeoutMs: 5000, commandAuthorization: { summary: "verify", reference: null } });
  const input = { taskId: f.task.id, snapshotId: snapshot.id, contractVersion: 1, independent: false,
    rows: [{ acceptanceId: "A1", result: "pass" as const, evidenceIds: [e.id], summary: "observed", gapDecision: null }],
    verification: [{ evidenceId: e.id, argv, environment }] };
  await expect(recordCheckSet(f.context, f.meta, { ...input, verification: [{ evidenceId: e.id, argv,
    environment: { ...environment, labels: { serviceRevision: "changed" } } }] })).rejects.toMatchObject({ code: "VERIFICATION_CONDITIONS_MISMATCH" });
  const checks = await recordCheckSet(f.context, f.meta, input);
  const result = await finishGoal(f.context, f.meta, { taskId: f.task.id, contractVersion: 1, ownerEpoch: 1, snapshotId: snapshot.id,
    checkSetIds: [checks.id], contributionIds: [], exclusions: [], verification: input.verification });
  expect(result.snapshotId).toBe(snapshot.id);
});
