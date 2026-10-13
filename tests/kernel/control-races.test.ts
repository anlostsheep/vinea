import { test, expect } from "vitest";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { makeGoalFixture, testMeta, testEnvironment, authorizeFixtureTask } from "../helpers/kernel-fixture.js";
import { controlInput } from "../helpers/task-control.js";
import { pauseTask, cancelTask } from "../../src/kernel/task-control.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { recordReportedEvidence } from "../../src/kernel/evidence.js";
import { recordCheckSet, finishGoal } from "../../src/kernel/delivery.js";
import { runVerification } from "../../src/kernel/verification.js";
import { readState } from "../../src/kernel/store.js";

test("cancellation and delivery cannot both commit", async () => {
  const f = await makeGoalFixture();
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  const e = await recordReportedEvidence(f.context, f.meta, { taskId: f.task.id, snapshotId: snapshot.id, contractVersion: 1,
    result: "pass", phase: null, argv: null, exitCode: null, environment: testEnvironment(), summary: "fixture verification" });
  const verification = [{ evidenceId: e.id, argv: null, environment: e.environment }];
  const check = await recordCheckSet(f.context, f.meta, { taskId: f.task.id, snapshotId: snapshot.id, contractVersion: 1, independent: false,
    rows: [{ acceptanceId: "A1", result: "pass", evidenceIds: [e.id], summary: "verified", gapDecision: null }], verification });
  const results = await Promise.allSettled([
    finishGoal(f.context, f.meta, { taskId: f.task.id, snapshotId: snapshot.id, contractVersion: 1, ownerEpoch: 1,
      checkSetIds: [check.id], contributionIds: [], exclusions: [], verification }),
    cancelTask(f.context, testMeta(f.actorB), await controlInput(f.context, f.task.id, "cancel"))
  ]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const task = (await readState(f.context)).tasks[f.task.id]!;
  expect(Object.keys(task.deliveries)).toHaveLength(task.status === "delivered" ? 1 : 0);
});

test("a command started before pause cannot pass after reauthorization of the same contract", async () => {
  const f = await makeGoalFixture();
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  const started = join(f.directory, "started"), done = join(f.directory, "done");
  const argv = [process.execPath, "-e", "const fs=require('fs');fs.writeFileSync(process.argv[1],'started');const timer=setInterval(()=>{if(fs.existsSync(process.argv[2])){clearInterval(timer);process.exit(0)}},10)", started, done];
  const run = runVerification(f.context, f.meta, { taskId: f.task.id, snapshotId: snapshot.id, contractVersion: 1,
    argv, phase: null, timeoutMs: 5000, environment: testEnvironment(), commandAuthorization: { summary: "fixture command", reference: null } });
  const result = run.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  let running = false;
  for (let i = 0; i < 200; i++) {
    running = await access(started).then(() => true, () => false);
    if (running) break;
    await delay(10);
  }
  expect(running).toBe(true);
  await pauseTask(f.context, testMeta(f.actorB), await controlInput(f.context, f.task.id, "pause"));
  await authorizeFixtureTask(f.context, f.actorA, f.task.id);
  await writeFile(done, "finish");
  expect((await result).error).toMatchObject({ code: "VERIFICATION_REVOKED" });
  expect(Object.values((await readState(f.context)).tasks[f.task.id]!.evidence)).toHaveLength(0);
});
