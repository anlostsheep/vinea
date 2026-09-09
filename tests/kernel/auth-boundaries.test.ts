import { access } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "vitest";
import { claimWork } from "../../src/kernel/ownership.js";
import { handoffWork, occupancyRef } from "../../src/kernel/continuation.js";
import { runVerification } from "../../src/kernel/verification.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { readState } from "../../src/kernel/store.js";
import { makeGoalFixture, testMeta, testEnvironment, fingerprintFixtureTree } from "../helpers/kernel-fixture.js";

test("a different actor cannot use normal handoff to bypass unknown-writer isolation", async () => {
  const f = await makeGoalFixture();
  await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const from = occupancyRef((await readState(f.context)).claims[f.context.workspaceId]!);
  await expect(handoffWork(f.context, testMeta(f.actorB), { from, to: f.actorB, contractVersion: 1,
    transferOwner: false, ownerEpoch: null, decision: { summary: "take over", reference: null } }))
    .rejects.toMatchObject({ code: "HOLDER_RELEASE_REQUIRED" });
});
test("invalid verification phase is rejected before reserving or running the command", async () => {
  const f = await makeGoalFixture();
  const snap = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  const marker = join(f.root, "should-not-run"), before = await fingerprintFixtureTree(f.context.storeRoot);
  await expect(runVerification(f.context, f.meta, { taskId: f.task.id, contractVersion: 1, snapshotId: snap.id,
    argv: [process.execPath, "-e", "require('fs').writeFileSync(process.argv[1],'bad')", marker],
    phase: "invalid" as never, timeoutMs: 5000, environment: testEnvironment(), commandAuthorization: { summary: "fixture", reference: null } }))
    .rejects.toMatchObject({ code: "SCHEMA_INVALID" });
  await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});
