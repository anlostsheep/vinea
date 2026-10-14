import { test, expect, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { makeGoalFixture, testMeta, fingerprintFixtureTree } from "../helpers/kernel-fixture.js";
import { readState } from "../../src/kernel/store.js";
import { previewUpgrade, upgradeStore } from "../../src/kernel/upgrade.js";
import { executeCommand } from "../../src/application.js";
import { claimWork } from "../../src/kernel/ownership.js";
import * as io from "../../src/kernel/io.js";

async function legacyFixture(claimed = false) {
  const f = await makeGoalFixture();
  if (claimed) await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const path = join(f.context.storeRoot, "tasks/state.json");
  const state = await readState(f.context); state.kernelSchemaVersion = 1;
  for (const task of Object.values(state.tasks)) delete task.control;
  await writeFile(path, JSON.stringify(state));
  const preview = await previewUpgrade(f.context);
  const input = { expectedRevision: preview.expectedRevision, expectedFingerprint: preview.expectedFingerprint,
    request: { action: "upgrade" as const, userMessage: "Upgrade this test store", reference: "fixture:upgrade" } };
  return { ...f, get meta() { return testMeta(f.actorA); }, path, state, preview, input };
}

test("schema 1 preview and reads are nonmutating; ordinary CLI mutations require explicit upgrade", async () => {
  const f = await legacyFixture(), before = await fingerprintFixtureTree(f.context.storeRoot);
  expect((await previewUpgrade(f.context)).ready).toBe(true);
  expect((await readState(f.context)).kernelSchemaVersion).toBe(1);
  const attempted = await executeCommand(f.context, "continue", { meta: testMeta(f.actorB, "continue"), payload: { taskId: f.task.id, assignmentId: null } });
  expect(attempted.error?.code).toBe("STORE_UPGRADE_REQUIRED");
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});

test("explicit upgrade saves exact source bytes, preserves authority and replays one receipt", async () => {
  const f = await legacyFixture(), bytes = await readFile(f.path), meta = f.meta;
  const result = await upgradeStore(f.context, meta, f.input);
  expect((await readFile(join(f.context.storeRoot, result.backup!))).equals(bytes)).toBe(true);
  const after = await readState(f.context);
  expect(after.kernelSchemaVersion).toBe(2);
  expect(after.tasks[f.task.id]!.workflow).toEqual(f.state.tasks[f.task.id]!.workflow);
  expect(after.tasks[f.task.id]!.control).toMatchObject({ revision: 0, round: 1, events: [] });
  expect((await upgradeStore(f.context, meta, f.input)).replayed).toBe(true);
  expect(await readState(f.context)).toEqual(after);
  await expect(upgradeStore(f.context, f.meta, f.input)).rejects.toMatchObject({ code: "STORE_ALREADY_UPGRADED" });
});

test("upgrade refuses active claims and changed source without modifying state", async () => {
  const f = await legacyFixture(true), before = await readFile(f.path);
  expect(f.preview.ready).toBe(false);
  await expect(upgradeStore(f.context, f.meta, f.input)).rejects.toMatchObject({ code: "WORKSPACE_OCCUPIED" });
  expect((await readFile(f.path)).equals(before)).toBe(true);
  await expect(upgradeStore(f.context, f.meta, { ...f.input, expectedFingerprint: "0".repeat(64) })).rejects.toMatchObject({ code: "UPGRADE_SOURCE_CHANGED" });
});

test("failed publication keeps the original format and allows the identical explicit retry", async () => {
  const f = await legacyFixture(), bytes = await readFile(f.path), meta = f.meta, real = io.writeJson;
  const failing = vi.spyOn(io, "writeJson").mockImplementation(async (...args) => {
    if (args[2] === "tasks/state.json") throw new Error("injected upgrade publication failure");
    return real(...args);
  });
  try { await expect(upgradeStore(f.context, meta, f.input)).rejects.toThrow("injected upgrade"); }
  finally { failing.mockRestore(); }
  expect((await readFile(f.path)).equals(bytes)).toBe(true);
  await upgradeStore(f.context, meta, f.input);
  expect((await readState(f.context)).kernelSchemaVersion).toBe(2);
});

test("upgrade does not fabricate execution protocol for historical tasks", async () => {
  const f = await legacyFixture();
  delete f.state.tasks[f.task.id]!.workflow;
  await writeFile(f.path, JSON.stringify(f.state));
  const p = await previewUpgrade(f.context);
  await upgradeStore(f.context, f.meta, { ...f.input, expectedFingerprint: p.expectedFingerprint });
  expect((await readState(f.context)).tasks[f.task.id]!.workflow).toBeUndefined();
  await expect(claimWork(f.context, f.meta, { taskId: f.task.id, contractVersion: 1, assignmentId: null })).rejects.toMatchObject({ code: "TASK_PROTOCOL_REQUIRED" });
});

test.skipIf(!process.env.VINEA_SCHEMA1_CLI)("pinned original schema-1 CLI rejects the new format without writing", async () => {
  const f = await legacyFixture(), run = promisify(execFile);
  expect(JSON.parse((await run(process.execPath, [process.env.VINEA_SCHEMA1_CLI!, "task", "list", "--json"], { cwd: f.root })).stdout).data.tasks).toHaveLength(1);
  await upgradeStore(f.context, f.meta, f.input);
  const before = await fingerprintFixtureTree(f.context.storeRoot);
  await expect(run(process.execPath, [process.env.VINEA_SCHEMA1_CLI!, "task", "list", "--json"], { cwd: f.root }))
    .rejects.toMatchObject({ code: 1, stdout: expect.stringContaining("STATE_INVALID") });
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});

test.skipIf(!process.env.VINEA_SCHEMA2_CLI)("a 3.0.0 receipt without an audit artifact remains replayable after this patch", async () => {
  const f = await legacyFixture(), run = promisify(execFile), meta = f.meta;
  await writeFile(join(f.root, "upgrade-input.json"), JSON.stringify({ meta, payload: f.input }));
  const child = await run(process.execPath, [process.env.VINEA_SCHEMA2_CLI!, "store", "upgrade", "--input", "upgrade-input.json", "--json"], { cwd: f.root });
  expect(JSON.parse(child.stdout).data.schemaVersion).toBe(2);
  const after = await readState(f.context);
  expect(after.operations[meta.operationId]!.resourceIds).toHaveLength(1);
  const replay = await upgradeStore(f.context, meta, f.input);
  expect(replay.replayed).toBe(true); expect(replay.receipt).toBeNull();
  expect(await readState(f.context)).toEqual(after);
});

test.skipIf(!process.env.VINEA_SCHEMA2_CLI)("3.0.0 can read stores with the new audit hash without mutating them", async () => {
  const f = await legacyFixture(), run = promisify(execFile);
  await upgradeStore(f.context, f.meta, f.input);
  const before = await fingerprintFixtureTree(f.context.storeRoot);
  const result = JSON.parse((await run(process.execPath, [process.env.VINEA_SCHEMA2_CLI!, "task", "list", "--json"], { cwd: f.root })).stdout);
  expect(result.data.tasks).toHaveLength(1);
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});
