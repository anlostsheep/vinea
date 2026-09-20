import { afterEach, expect, test, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { makeGoalFixture, testMeta, testEnvironment, authorizeFixtureTask } from "../helpers/kernel-fixture.js";
import { claimWork, releaseWork } from "../../src/kernel/ownership.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { takeoverWork, continueGoal } from "../../src/kernel/continuation.js";
import { discoverRepository } from "../../src/kernel/repository.js";
import { readState, inspectStore } from "../../src/kernel/store.js";
import { reviseContract } from "../../src/kernel/contracts.js";
import { authorizeExecution, recordPlanningDocument, suspendExecution } from "../../src/kernel/workflow.js";
import { submitContribution } from "../../src/kernel/contributions.js";
import { recordReportedEvidence } from "../../src/kernel/evidence.js";
import { recordCheckSet, finishGoal } from "../../src/kernel/delivery.js";
import type { Meta } from "../../src/kernel/types.js";

const fault = vi.hoisted(() => ({ beforeRestoreRename: null as null | (() => Promise<void>), afterRestoreRename: null as null | (() => void) }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: async (from: string, to: string) => {
    if (from.endsWith(".vinea-restore")) {
      await fault.beforeRestoreRename?.();
      await actual.rename(from, to);
      fault.afterRestoreRename?.();
    } else await actual.rename(from, to);
  } };
});
afterEach(() => { fault.beforeRestoreRename = null; fault.afterRestoreRename = null; });

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function childCommand(cwd: string, command: string, meta: Meta, payload: unknown) {
  const ready = latch(), cli = pathToFileURL(join(process.cwd(), "dist/vinea.mjs")).href;
  const script = `import { main } from ${JSON.stringify(cli)}; process.stdout.write("ready\\n"); process.exitCode = await main(${JSON.stringify([...command.split(" "), "--input", "-", "--json"])});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd, stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  const result = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", chunk => { output += chunk; if (output.startsWith("ready\n")) ready.resolve(); });
    child.stderr.resume();
    child.on("error", error => { ready.resolve(); reject(error); });
    child.on("close", code => { ready.resolve(); if (code === 0) resolve(); else reject(new Error(output)); });
  });
  child.stdin.end(JSON.stringify({ meta, payload }));
  return { ready: ready.promise, result };
}
async function recoveryFixture() {
  const f = await makeGoalFixture(), peer = await discoverRepository(f.linkedRoot);
  const token = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  await writeFile(join(f.root, "src/app.ts"), "export const value = 2;\n");
  await writeFile(join(f.root, "src/new.ts"), "export const recovered = true;\n");
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token });
  const view = await continueGoal(peer, testMeta(f.actorB), { taskId: f.task.id, assignmentId: null });
  const input = { from: view.occupiedWrites[0]!.ref, to: f.actorB, contractVersion: 1, transferOwner: false, ownerEpoch: null,
    decision: { summary: "Recover in isolation", reference: "fixture:recover" }, stopBasis: "unknown" as const,
    stopReference: null, baselineSnapshotId: snapshot.id };
  return { ...f, get meta() { return testMeta(f.actorA); }, peer, input };
}

test.each([
  ["suspend", false], ["revise", false], ["suspend", true], ["revise", true],
] as const)("%s cannot become effective before in-flight restore finishes writing; separate process=%s", async (action, separateProcess) => {
  const f = await recoveryFixture(), entered = latch(), resume = latch();
  let effective = false, writesAfterChange = 0;
  fault.beforeRestoreRename = async () => { entered.resolve(); await resume.promise; };
  fault.afterRestoreRename = () => { if (effective) writesAfterChange++; };
  const restoring = takeoverWork(f.peer, testMeta(f.actorB), f.input).then(value => ({ value }), error => ({ error }));
  let changing: Promise<unknown> | undefined;
  try {
    await entered.promise;
    const { version: _, decision, ...contract } = f.task.contracts[0]!;
    const stop = { taskId: f.task.id, contractVersion: 1, ownerEpoch: 1, decision: { summary: "Stop", reference: "fixture:stop" } };
    const revision = { taskId: f.task.id, expectedVersion: 1, ownerEpoch: 1, contract, decision };
    if (separateProcess) {
      const child = childCommand(f.root, `task ${action}`, f.meta, action === "suspend" ? stop : revision);
      changing = child.result.then(() => { effective = true; });
      await child.ready;
    } else {
      changing = (action === "suspend" ? suspendExecution(f.context, f.meta, stop) : reviseContract(f.context, f.meta, revision))
        .then(() => { effective = true; });
    }
    await Promise.race([changing, delay(150)]);
  } finally {
    resume.resolve();
    await restoring;
    if (changing) await changing;
  }
  expect(writesAfterChange).toBe(0);
  const state = await readState(f.context);
  expect(state.claims[f.peer.workspaceId]!.state).not.toBe("restore-target");
  if (action === "revise") {
    await authorizeFixtureTask(f.context, f.actorA, f.task.id, 2);
    await expect(claimWork(f.peer, testMeta(f.actorB), { taskId: f.task.id, assignmentId: null, contractVersion: 2 }))
      .resolves.toMatchObject({ contractVersion: 2 });
  } else expect(state.claims[f.peer.workspaceId]!.state).toBe("unknown-writer-hold");
}, 10000);

test("contract revision cannot strand a partially restored reservation", async () => {
  const f = await recoveryFixture(), meta = testMeta(f.actorB);
  let count = 0;
  fault.beforeRestoreRename = async () => { if (++count === 2) throw new Error("fixture interrupted restore"); };
  await expect(takeoverWork(f.peer, meta, f.input)).rejects.toThrow("fixture interrupted restore");
  const before = await readState(f.context), { version: _, decision, ...contract } = f.task.contracts[0]!;
  await expect(reviseContract(f.context, f.meta, { taskId: f.task.id, expectedVersion: 1, ownerEpoch: 1, contract, decision }))
    .rejects.toMatchObject({ code: "RESTORE_IN_PROGRESS" });
  expect(await readState(f.context)).toEqual(before);
  fault.beforeRestoreRename = null;
  await expect(takeoverWork(f.peer, meta, f.input)).resolves.toMatchObject({ contractVersion: 1 });
});

test("suspending a partial recovery aborts its old reservation without more file writes", async () => {
  const f = await recoveryFixture(), meta = testMeta(f.actorB);
  let count = 0;
  fault.beforeRestoreRename = async () => { if (++count === 2) throw new Error("fixture interrupted restore"); };
  await expect(takeoverWork(f.peer, meta, f.input)).rejects.toThrow("fixture interrupted restore");
  await suspendExecution(f.context, f.meta, { taskId: f.task.id, contractVersion: 1, ownerEpoch: 1,
    decision: { summary: "Abort recovery", reference: "fixture:abort-recovery" } });
  fault.beforeRestoreRename = null;
  const before = await readState(f.context), contents = await readFile(join(f.linkedRoot, "src/app.ts"), "utf8");
  await expect(takeoverWork(f.peer, meta, f.input)).rejects.toMatchObject({ code: "RECOVERY_ABORTED" });
  expect(await readState(f.context)).toEqual(before);
  await authorizeFixtureTask(f.context, f.actorA, f.task.id);
  await expect(takeoverWork(f.peer, meta, f.input)).rejects.toMatchObject({ code: "RECOVERY_ABORTED" });
  expect(await readFile(join(f.linkedRoot, "src/app.ts"), "utf8")).toBe(contents);
});

async function plannedFixture() {
  const f = await makeGoalFixture(), input = { taskId: f.task.id, contractVersion: 1, ownerEpoch: 1 };
  await suspendExecution(f.context, f.meta, { ...input, decision: { summary: "Plan first", reference: "fixture:plan" } });
  await recordPlanningDocument(f.context, f.meta, { ...input, kind: "brief", content: "# Brief\nFixture scope" });
  const plan = await recordPlanningDocument(f.context, f.meta, { ...input, kind: "plan", content: "# Plan\nImplement and test" });
  await authorizeFixtureTask(f.context, f.actorA, f.task.id);
  const token = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token });
  const environment = testEnvironment(), argv = ["fixture-test"];
  const version = { taskId: f.task.id, contractVersion: 1 };
  const evidence = await recordReportedEvidence(f.context, f.meta, { ...version, snapshotId: snapshot.id, environment, argv,
    result: "pass", phase: null, exitCode: 0, summary: "Fixture-only reported evidence" });
  const verification = [{ evidenceId: evidence.id, environment, argv }];
  const check = await recordCheckSet(f.context, f.meta, { ...version, snapshotId: snapshot.id, independent: false,
    rows: [{ acceptanceId: "A1", result: "pass", evidenceIds: [evidence.id], summary: "Fixture checks", gapDecision: null }], verification });
  return { ...f, get meta() { return testMeta(f.actorA); }, input, plan, token, snapshot, check, verification };
}

test.each(["snapshot", "contribution", "finish", "finish-after-release"])("damaged planning rejects cached-token %s", async operation => {
  const f = await plannedFixture();
  if (operation === "finish-after-release") await releaseWork(f.context, f.meta, f.token);
  await writeFile(join(f.context.storeRoot, f.plan.path), "changed planning after claim");
  const before = await readState(f.context);
  const action = operation === "snapshot"
    ? captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: f.token })
    : operation === "contribution"
      ? submitContribution(f.context, f.meta, { taskId: f.task.id, contribution: { kind: "change", assignmentId: null,
        contractVersion: 1, snapshotId: f.snapshot.id, evidenceIds: [], summary: "Change", writeToken: f.token } })
      : finishGoal(f.context, testMeta(f.actorA, "finish"), { ...f.input, snapshotId: f.snapshot.id,
        checkSetIds: [f.check.id], contributionIds: [], exclusions: [], verification: f.verification });
  await expect(action).rejects.toMatchObject({ code: "PLANNING_ARTIFACT_INVALID" });
  expect(await readState(f.context)).toEqual(before);
});

test.each(["snapshot", "contribution"])("damaged planning also rejects a successful %s operation replay", async operation => {
  const f = await plannedFixture(), meta = f.meta;
  const action = () => operation === "snapshot"
    ? captureSnapshot(f.context, meta, { taskId: f.task.id, paths: ["src"], token: f.token })
    : submitContribution(f.context, meta, { taskId: f.task.id, contribution: { kind: "change", assignmentId: null,
      contractVersion: 1, snapshotId: f.snapshot.id, evidenceIds: [], summary: "Change", writeToken: f.token } });
  await action();
  await writeFile(join(f.context.storeRoot, f.plan.path), "changed after successful operation");
  const before = await readState(f.context);
  await expect(action()).rejects.toMatchObject({ code: "PLANNING_ARTIFACT_INVALID" });
  expect(await readState(f.context)).toEqual(before);
});

test("a revoked authorization retry fails instead of returning successful revoked data", async () => {
  const f = await makeGoalFixture(), input = { taskId: f.task.id, contractVersion: 1, ownerEpoch: 1 };
  await suspendExecution(f.context, f.meta, { ...input, decision: { summary: "Stop", reference: "fixture:stop:1" } });
  const meta = f.meta, request = { kind: "implementation-request" as const, userMessage: "Implement", reference: "fixture:resume", action: null };
  await authorizeExecution(f.context, meta, { ...input, request });
  await suspendExecution(f.context, f.meta, { ...input, decision: { summary: "Stop again", reference: "fixture:stop:2" } });
  const before = await readState(f.context);
  await expect(authorizeExecution(f.context, meta, { ...input, request })).rejects.toMatchObject({ code: "EXECUTION_NOT_AUTHORIZED" });
  expect(await readState(f.context)).toEqual(before);
  await authorizeFixtureTask(f.context, f.actorA, f.task.id);
  await expect(authorizeExecution(f.context, meta, { ...input, request })).rejects.toMatchObject({ code: "EXECUTION_NOT_AUTHORIZED" });
});

test("an active pre-protocol task is not reported ready", async () => {
  const f = await makeGoalFixture(), state = await readState(f.context);
  delete state.tasks[f.task.id]!.workflow;
  const path = join(f.context.storeRoot, "tasks/state.json");
  await writeFile(path, JSON.stringify(state));
  const before = await readFile(path, "utf8"), report = await inspectStore(f.context);
  expect(report.status).not.toBe("ready");
  expect(report.issues.map(issue => issue.code)).toContain("TASK_PROTOCOL_REQUIRED");
  expect(await readFile(path, "utf8")).toBe(before);
});
