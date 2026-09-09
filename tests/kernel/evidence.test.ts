import { access } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "vitest";
import { runVerification } from "../../src/kernel/verification.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { makeGoalFixture, testEnvironment, fingerprintFixtureTree } from "../helpers/kernel-fixture.js";

test("runner observes actual exit and persist false refuses before spawning", async () => {
  const f = await makeGoalFixture();
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  const input = { taskId: f.task.id, contractVersion: 1, snapshotId: snapshot.id, argv: [process.execPath, "-e", "process.exit(7)"],
    phase: "red" as const, timeoutMs: 5000, environment: testEnvironment(), commandAuthorization: { summary: "run fixture", reference: null } };
  const evidence = await runVerification(f.context, f.meta, input);
  expect(evidence).toMatchObject({ source: "command-runner", exitCode: 7, result: "fail" });
  const meta = f.meta; meta.invocation.persist = false;
  const before = await fingerprintFixtureTree(f.context.storeRoot), marker = join(f.root, "must-not-run");
  await expect(runVerification(f.context, meta, { ...input, argv: [process.execPath, "-e", "require('fs').writeFileSync(process.argv[1],'bad')", marker] })).rejects.toMatchObject({ code: "PERSISTENCE_DISABLED" });
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
  await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
});
