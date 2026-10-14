import { test, expect } from "vitest";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeGoalFixture } from "../helpers/kernel-fixture.js";
import { claimWork, executionKey } from "../../src/kernel/ownership.js";
import { readState } from "../../src/kernel/store.js";
import type { Actor } from "../../src/kernel/types.js";

const cli = join(process.cwd(), "dist/vinea.mjs");
function call(cwd: string, command: string, actor?: Actor | { host: string; newInstance: true }, payload?: unknown, operationId = randomUUID()) {
  return new Promise<{ code: number | null; data: any; error?: { code: string } }>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...command.split(" "), ...(actor ? ["--input", "-"] : []), "--json"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; child.stdout.on("data", bytes => { stdout += bytes; }); child.stderr.resume(); child.on("error", reject);
    child.on("close", code => { try { resolve({ code, ...JSON.parse(stdout) }); } catch { reject(new Error(stdout)); } });
    child.stdin.end(actor ? JSON.stringify({ meta: { actor, operationId,
      invocation: { entry: "continue", activation: "named-request", analysisOnly: false, persist: true } }, payload }) : "");
  });
}

async function fixture() {
  const f = await makeGoalFixture();
  const old = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const state = await readState(f.context); state.kernelSchemaVersion = 1;
  delete state.tasks[f.task.id]!.workflow; delete state.tasks[f.task.id]!.control;
  const path = join(f.context.storeRoot, "tasks/state.json"); await writeFile(path, JSON.stringify(state));
  const actor = (await call(f.linkedRoot, "session resolve", { host: "new-executor", newInstance: true }, {})).data as Actor;
  const preview = (await call(f.linkedRoot, "store preview-upgrade")).data;
  const stop = { from: preview.occupied[0].ref, stopBasis: "user-declared-stop", userMessage: "The old writer is stopped", stopReference: "fixture:user:stop" };
  const payload = { expectedRevision: preview.expectedRevision, expectedFingerprint: preview.expectedFingerprint,
    request: { action: "upgrade", userMessage: "Upgrade with this explicitly stopped old writer", reference: "fixture:user:upgrade" }, stoppedLegacyWriters: [stop] };
  return { ...f, path, actor, payload, state, old };
}

test.each(["user-declared-stop", "host-stop-receipt"])("new unbound CLI actor upgrades from another worktree with %s and preserves the old task", async stopBasis => {
  const f = await fixture(), operationId = randomUUID(), before = await readFile(f.path);
  f.payload.stoppedLegacyWriters[0]!.stopBasis = stopBasis;
  const omitted = { expectedRevision: f.payload.expectedRevision, expectedFingerprint: f.payload.expectedFingerprint, request: f.payload.request };
  expect((await call(f.linkedRoot, "store upgrade", f.actor, omitted)).error?.code).toBe("WORKSPACE_OCCUPIED");
  expect((await readFile(f.path)).equals(before)).toBe(true);
  const upgraded = await call(f.linkedRoot, "store upgrade", f.actor, f.payload, operationId);
  expect(upgraded.code, JSON.stringify(upgraded)).toBe(0);
  expect(upgraded.data.retainedLegacyTaskIds).toEqual([f.task.id]);
  const audit = JSON.parse(await readFile(join(f.context.storeRoot, upgraded.data.receipt), "utf8"));
  expect(audit.actor).toEqual(f.actor); expect(audit.resolvedLegacyWriters[0].stopBasis).toBe(stopBasis);
  const after = await readState(f.context);
  expect(after.tasks[f.task.id]!.owner.instanceId).toBe(f.actorA.instanceId);
  expect(after.tasks[f.task.id]!.workflow).toBeUndefined();
  expect(after.claims[f.context.workspaceId]!.state).toBe("released");
  const replay = await call(f.root, "store upgrade", f.actor, f.payload, operationId);
  expect(replay.code).toBe(0); expect(replay.data.replayed).toBe(true);
  expect(await readState(f.context)).toEqual(after);
  const doctor = await call(f.linkedRoot, "doctor");
  expect(doctor.data.issues.some((i: { code: string }) => i.code === "TASK_PROTOCOL_REQUIRED")).toBe(true);
});

test("two concurrent CLI upgrades release the old writer once", async () => {
  const f = await fixture();
  const results = await Promise.all([call(f.root, "store upgrade", f.actor, f.payload), call(f.linkedRoot, "store upgrade", f.actor, f.payload)]);
  expect(results.filter(r => r.code === 0)).toHaveLength(1);
  expect(results.find(r => r.code !== 0)?.error?.code).toBe("STORE_ALREADY_UPGRADED");
  const after = await readState(f.context);
  expect(after.revision).toBe(f.state.revision + 1);
  expect(after.epochs[executionKey(f.task.id, null)]).toBe(f.old.epoch + 1);
});
