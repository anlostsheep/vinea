import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "vitest";
import { makeRepoFixture } from "../helpers/kernel-fixture.js";

const cli = join(process.cwd(), "dist/vinea.mjs");
function run(cwd: string, args: string[], input?: unknown): Promise<{ code: number | null; output: any }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; child.stdout.on("data", b => { out += b; });
    child.stderr.resume(); child.on("error", reject);
    child.on("close", code => { try { resolve({ code, output: JSON.parse(out) }); } catch { reject(new Error(out)); } });
    child.stdin.end(input === undefined ? "" : JSON.stringify(input));
  });
}
const invocation = { entry: "run", activation: "named-entry", analysisOnly: false, persist: true };
function envelope(actor: unknown, payload: unknown, entry = "run") {
  return { meta: { operationId: randomUUID(), actor, invocation: { ...invocation, entry } }, payload };
}
test("public CLI resolves an instance and reuses it across separate processes", async () => {
  const f = await makeRepoFixture();
  const opened = await run(f.root, ["session", "resolve", "--input", "-", "--json"], envelope({ host: "codex", newInstance: true }, {}));
  expect(opened.code).toBe(0);
  const actor = opened.output.actor;
  expect(typeof actor.instanceId).toBe("string");
  await expect(access(join(f.root, ".git/vinea"))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await run(f.root, ["init", "--input", "-", "--json"], envelope(actor, { summary: "init", reference: null }))).code).toBe(0);
  const created = await run(f.root, ["task", "create", "--input", "-", "--json"], envelope(actor, {
    title: "CLI goal", decision: { summary: "implement", reference: null }, contract: {
      goal: "CLI goal", scope: ["src"], constraints: [], acceptance: [{ id: "A1", text: "Works" }], quality: "standard",
      grant: { businessWrite: true, delegate: false, commit: false, deploy: false, allowedPaths: ["src"] },
    },
  }));
  expect(created.code).toBe(0);
  const taskId = created.output.data.id;
  const claimed = await run(f.root, ["work", "claim", "--input", "-", "--json"], envelope(actor, { taskId, assignmentId: null, contractVersion: 1 }));
  expect(claimed.code).toBe(0);
  const resumed = await run(f.root, ["continue", "--input", "-", "--json"], envelope(actor, { taskId, assignmentId: null }, "continue"));
  expect(resumed.code).toBe(0);
  expect(resumed.output.actor.instanceId).toBe(actor.instanceId);
  expect(resumed.output.data.writeToken.epoch).toBe(claimed.output.data.epoch);
  const missing = await run(f.root, ["continue", "--input", "-", "--json"], envelope({ host: "codex" }, { taskId, assignmentId: null }, "continue"));
  expect(missing.output.error.code).toBe("ACTOR_RESOLUTION_REQUIRED");
});
test("removed transition returns migration guidance without falling back to the old writer", async () => {
  const f = await makeRepoFixture();
  const result = await run(f.root, ["task", "transition", "old-id", "--to", "checking", "--json"]);
  expect(result.output.error.code).toBe("LEGACY_COMMAND_REMOVED");
  await expect(access(join(f.root, ".vinea"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(join(f.root, ".git/vinea"))).rejects.toMatchObject({ code: "ENOENT" });
});
test("validate returns a failing exit status for missing state without initializing", async () => {
  const f = await makeRepoFixture();
  const result = await run(f.root, ["validate", "--json"]);
  expect(result.code).toBe(1);
  expect(result.output.data.status).toBe("missing");
  await expect(access(join(f.root, ".git/vinea"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("two worktrees recover through public occupancy references across CLI processes", async () => {
  const f = await makeRepoFixture();
  async function call(root: string, command: string, actor: unknown, payload: unknown, entry = "run") {
    return run(root, [...command.split(" "), "--input", "-", "--json"], envelope(actor, payload, entry));
  }
  const a = (await call(f.root, "session resolve", { host: "fixture-a", newInstance: true }, {})).output.actor;
  const b = (await call(f.linkedRoot, "session resolve", { host: "fixture-b", newInstance: true }, {})).output.actor;
  await call(f.root, "init", a, { summary: "fixture init", reference: null });
  const task = (await call(f.root, "task create", a, { title: "recovery", decision: { summary: "implement", reference: null },
    contract: { goal: "recover uncommitted work", scope: ["src"], constraints: [], acceptance: [{ id: "A1", text: "restored" }], quality: "standard",
      grant: { businessWrite: true, delegate: true, commit: false, deploy: false, allowedPaths: ["src"] } } })).output.data;
  const token = (await call(f.root, "work claim", a, { taskId: task.id, assignmentId: null, contractVersion: 1 })).output.data;
  await writeFile(join(f.root, "src/app.ts"), "export const value = 9;\n");
  await writeFile(join(f.root, "src/new.ts"), "export const pending = true;\n");
  const snapshot = (await call(f.root, "snapshot capture", a, { taskId: task.id, paths: ["src"], token })).output.data;
  const view = (await call(f.linkedRoot, "continue", b, { taskId: task.id, assignmentId: null }, "continue")).output.data;
  expect(view.writeToken).toBeNull();
  const transfer = { from: view.occupiedWrites[0].ref, to: b, contractVersion: 1, transferOwner: true, ownerEpoch: 1,
    decision: { summary: "recover in isolated directory", reference: null }, stopBasis: "unknown", stopReference: null, baselineSnapshotId: snapshot.id };
  const transferred = await call(f.linkedRoot, "work takeover", b, transfer, "continue");
  expect(transferred.code, JSON.stringify(transferred.output)).toBe(0);
  expect(transferred.output.data.epoch).toBeGreaterThan(token.epoch);
  expect(await readFile(join(f.linkedRoot, "src/new.ts"), "utf8")).toContain("pending");
  const refused = await call(f.root, "work claim", a, { taskId: task.id, assignmentId: null, contractVersion: 1 });
  expect(refused.output.error.code).toBe("WORKSPACE_OCCUPIED");
  const late = await call(f.root, "contribution submit", a, { taskId: task.id, contribution: { kind: "change", assignmentId: null,
    contractVersion: 1, snapshotId: snapshot.id, evidenceIds: [], summary: "late result", writeToken: token } });
  expect(late.output.error.code).toBe("STALE_WRITE_TOKEN");
  const { version: _, decision: __, ...contract } = task.contract;
  const otherTask = (await call(f.root, "task create", a, { title: "different task", decision: { summary: "separate goal", reference: null }, contract })).output.data;
  expect((await call(f.root, "work claim", a, { taskId: otherTask.id, assignmentId: null, contractVersion: 1 })).output.error.code).toBe("WORKSPACE_OCCUPIED");
  await rm(join(f.root, ".git/vinea/runtime/bindings"), { recursive: true, force: true });
  const resumed = await call(f.linkedRoot, "continue", b, { taskId: task.id, assignmentId: null }, "continue");
  expect(resumed.output.actor.instanceId).toBe(b.instanceId);
  expect(resumed.output.data.writeToken.epoch).toBe(transferred.output.data.epoch);
  const manifest = await run(f.linkedRoot, ["snapshot", "show", "--id", snapshot.id, "--json"]);
  expect(manifest.code, JSON.stringify(manifest.output)).toBe(0);
  expect(manifest.output.data.entries).toHaveLength(2);
}, 15000);

test("public CLI delivers observed uncommitted work and opens a linked repair", async () => {
  const f = await makeRepoFixture();
  const owner = (await run(f.root, ["session", "resolve", "--input", "-", "--json"], envelope({ host: "fixture-owner", newInstance: true }, {}))).output.actor;
  const checker = (await run(f.root, ["session", "resolve", "--input", "-", "--json"], envelope({ host: "fixture-checker", newInstance: true }, {}))).output.actor;
  async function call(command: string, payload: unknown, actor = owner, entry = "run") {
    const result = await run(f.root, [...command.split(" "), "--input", "-", "--json"], envelope(actor, payload, entry));
    expect(result.code, JSON.stringify(result.output)).toBe(0); return result.output.data;
  }
  await call("init", { summary: "init fixture", reference: null });
  const task = await call("task create", { title: "delivery", decision: { summary: "implement fixture", reference: null }, contract: {
    goal: "value is 2", scope: ["src"], constraints: [], acceptance: [{ id: "A1", text: "value is 2" }], quality: "standard",
    grant: { businessWrite: true, delegate: false, commit: false, deploy: false, allowedPaths: ["src"] } } });
  const token = await call("work claim", { taskId: task.id, assignmentId: null, contractVersion: 1 });
  await writeFile(join(f.root, "src/app.ts"), "export const value = 2;\n");
  const snapshot = await call("snapshot capture", { taskId: task.id, paths: ["src"], token });
  const input = { taskId: task.id, contractVersion: 1, snapshotId: snapshot.id };
  const environment = { runtime: process.version, platform: process.platform, labels: {} };
  const argv = [process.execPath, "-e", "require('assert').match(require('fs').readFileSync('src/app.ts','utf8'), /value = 2/)"];
  const evidence = await call("verify", { ...input, environment, argv, phase: null, timeoutMs: 5000,
    commandAuthorization: { summary: "read-only fixture check", reference: null } }, checker, "check");
  expect(evidence.source).toBe("command-runner");
  const verification = [{ evidenceId: evidence.id, argv, environment }];
  const checks = await call("check record", { ...input, independent: true,
    rows: [{ acceptanceId: "A1", result: "pass", evidenceIds: [evidence.id], summary: "observed value", gapDecision: null }], verification }, checker, "check");
  const contribution = await call("contribution submit", { taskId: task.id, contribution: { kind: "change", assignmentId: null,
    contractVersion: 1, snapshotId: snapshot.id, evidenceIds: [evidence.id], summary: "value change", writeToken: token } });
  await call("contribution integrate", { ...input, contributionId: contribution.id, ownerEpoch: 1, rationale: "reviewed current change" });
  const delivery = await call("finish", { ...input, ownerEpoch: 1, checkSetIds: [checks.id], contributionIds: [contribution.id], exclusions: [], verification }, owner, "finish");
  const before = (await run(f.root, ["task", "show", "--task", task.id, "--json"])).output.data;
  expect(before.status).toBe("delivered"); expect(before.userAcceptances).toEqual([]);
  const repair = await call("debug open", { taskId: task.id, deliveryId: delivery.id, title: "repair", expected: "value is 3", actual: "value is 2",
    decision: { summary: "repair the accepted behavior", reference: null } }, owner, "debug");
  expect(repair.relatedTo).toEqual({ taskId: task.id, deliveryId: delivery.id });
  expect((await run(f.root, ["task", "show", "--task", task.id, "--json"])).output.data).toEqual(before);
  expect(await readFile(join(f.root, "src/app.ts"), "utf8")).toBe("export const value = 2;\n");
}, 15000);

test("resolved command errors preserve caller identity and reject provenance spoofing", async () => {
  const f = await makeRepoFixture();
  const actor = (await run(f.root, ["session", "resolve", "--input", "-", "--json"], envelope({ host: "fixture", newInstance: true }, {}))).output.actor;
  const request = envelope(actor, { taskId: "absent", snapshotId: "absent", contractVersion: 1, source: "command-runner",
    result: "pass", phase: null, argv: null, exitCode: null, summary: "invented", environment: { runtime: process.version, platform: process.platform, labels: {} } });
  const result = await run(f.root, ["evidence", "report", "--input", "-", "--json"], request);
  expect(result.code).toBe(1);
  expect(result.output.error.code).toBe("SCHEMA_INVALID");
  expect(result.output.actor).toEqual(actor);
  expect(result.output.operationId).toBe(request.meta.operationId);
});
