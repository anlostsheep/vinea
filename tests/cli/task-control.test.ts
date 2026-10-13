import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { test, expect } from "vitest";
import { makeGoalFixture, git } from "../helpers/kernel-fixture.js";
import { controlInput } from "../helpers/task-control.js";
import { readState } from "../../src/kernel/store.js";
import type { Actor, Entry } from "../../src/kernel/types.js";

const cli = join(process.cwd(), "dist/vinea.mjs");
function call(cwd: string, command: string, actor?: Actor | { host: string; newInstance: boolean }, payload?: unknown, entry: Entry = "continue") {
  return new Promise<{ code: number | null; data: any; error?: { code: string } }>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...command.split(" "), ...(actor ? ["--input", "-"] : []), "--json"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; child.stdout.on("data", b => { out += b; }); child.stderr.resume(); child.on("error", reject);
    child.on("close", code => { try { resolve({ code, ...JSON.parse(out) }); } catch { reject(new Error(out)); } });
    child.stdin.end(actor ? JSON.stringify({ meta: { operationId: randomUUID(), actor,
      invocation: { entry, activation: "named-request", analysisOnly: false, persist: true } }, payload }) : "");
  });
}

test("new CLI processes take over, resume, cancel, reopen and reauthorize the same task", async () => {
  const f = await makeGoalFixture();
  const old = await call(f.root, "work claim", f.actorA, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  expect(old.code).toBe(0);
  const fresh = await call(f.linkedRoot, "session resolve", { host: "new-reviewer", newInstance: true }, {});
  const actor = fresh.data as Actor;
  const takeover = await call(f.linkedRoot, "task takeover", actor, await controlInput(f.context, f.task.id, "takeover"));
  expect(takeover.code, JSON.stringify(takeover)).toBe(0);
  expect(takeover.data.current.owner.instanceId).toBe(actor.instanceId);
  expect(takeover.data.current.nextActions.join(" ")).toContain("work resume");
  const resume = await call(f.linkedRoot, "work resume", actor, { taskId: f.task.id, contractVersion: 1,
    recoveryId: takeover.data.current.recoveries[0].id, request: { action: "resume", userMessage: "Start from this isolated commit", reference: "fixture:baseline" },
    mode: "baseline", stopBasis: "unknown", stopReference: null, snapshotId: null,
    baseCommit: (await git(f.linkedRoot, "rev-parse", "HEAD")).trim(), abandonUncaptured: true });
  expect(resume.code, JSON.stringify(resume)).toBe(0);
  expect(resume.data.taskId).toBe(f.task.id);
  const cancelled = await call(f.root, "task cancel", f.actorA, await controlInput(f.context, f.task.id, "cancel"));
  expect(cancelled.code).toBe(0); expect(cancelled.data.current.status).toBe("cancelled");
  expect((await call(f.root, "orient")).data.tasks).toHaveLength(0);
  expect((await call(f.root, "task list")).data.tasks[0].status).toBe("cancelled");
  const reopened = await call(f.linkedRoot, "task reopen", actor, await controlInput(f.context, f.task.id, "reopen"));
  expect(reopened.code).toBe(0); expect(reopened.data.current.authorized).toBe(false);
  const task = (await readState(f.context)).tasks[f.task.id]!;
  const authorized = await call(f.linkedRoot, "task authorize", actor, { taskId: task.id, contractVersion: 2, ownerEpoch: task.owner.epoch,
    request: { kind: "implementation-request", userMessage: "Implement reopened work", reference: "fixture:reopened", action: null } }, "run");
  expect(authorized.code, JSON.stringify(authorized)).toBe(0);
  // The old physical workspace remains held despite fresh authorization.
  const held = await call(f.linkedRoot, "work claim", actor, { taskId: task.id, assignmentId: null, contractVersion: 2 });
  expect(held.error?.code).toBe("WORKSPACE_OCCUPIED");
  const view = await call(f.linkedRoot, "continue", actor, { taskId: task.id, assignmentId: null });
  const from = view.data.occupiedWrites.find((c: any) => c.ref.instanceId === actor.instanceId).ref;
  expect((await call(f.linkedRoot, "work clear-hold", actor, { from, stopBasis: "holder-release", stopReference: null, decision: null })).code).toBe(0);
  const freshResume = await call(f.linkedRoot, "work resume", actor, { taskId: task.id, contractVersion: 2, recoveryId: null, from,
    request: { action: "resume", userMessage: "Resume my stopped files in this reopened task", reference: "fixture:fresh-after-reopen" },
    mode: "existing", stopBasis: "holder-release", stopReference: null, snapshotId: null, baseCommit: null, abandonUncaptured: false });
  expect(freshResume.code, JSON.stringify(freshResume)).toBe(0);
  expect(freshResume.data.taskId).toBe(task.id);
  expect((await call(f.root, "validate")).code).toBe(0);
});

test("two separate CLI actors race for control with exactly one winner", async () => {
  const f = await makeGoalFixture();
  const actor = (await call(f.linkedRoot, "session resolve", { host: "third", newInstance: true }, {})).data as Actor;
  const input = await controlInput(f.context, f.task.id, "takeover");
  const results = await Promise.all([call(f.root, "task takeover", f.actorB, input), call(f.linkedRoot, "task takeover", actor, input)]);
  expect(results.filter(r => r.code === 0)).toHaveLength(1);
  expect(results.find(r => r.code !== 0)?.error?.code).toBe("CONTROL_CHANGED");
});

test("CLI rejects missing user provenance and read-only entries", async () => {
  const f = await makeGoalFixture(), input = await controlInput(f.context, f.task.id, "cancel");
  const denied = await call(f.root, "task cancel", f.actorB, input, "check");
  expect(denied.error?.code).toBe("ENTRY_SCOPE_DENIED");
  const missing = await call(f.root, "task cancel", f.actorB, { ...input, request: { ...input.request, reference: "" } });
  expect(missing.error?.code).toBe("SCHEMA_INVALID");
  expect((await readState(f.context)).tasks[f.task.id]!.status).toBe("active");
});
