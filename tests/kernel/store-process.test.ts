import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { build } from "esbuild";
import { test, expect, vi } from "vitest";
import { readState, mutateState } from "../../src/kernel/store.js";
import * as io from "../../src/kernel/io.js";
import { makeGoalFixture } from "../helpers/kernel-fixture.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { readdir } from "node:fs/promises";

test("separate processes publish one logical operation under contention", async () => {
  const f = await makeGoalFixture(), out = join(f.directory, "worker.mjs"), run = promisify(execFile);
  await build({ entryPoints: [join(process.cwd(), "tests/fixtures/kernel-store-worker.ts")], bundle: true, outfile: out,
    format: "esm", platform: "node", target: "node18", logLevel: "silent" });
  const meta = f.meta, before = (await readState(f.context)).revision;
  const invoke = () => run(process.execPath, [out, f.root, JSON.stringify(meta)]);
  const [a, b] = await Promise.all([invoke(), invoke()]);
  expect(JSON.parse(a.stdout)).toEqual(JSON.parse(b.stdout));
  expect((await readState(f.context)).revision).toBe(before + 1);
});
test("a publication failure preserves old state and an explicit retry publishes once", async () => {
  const f = await makeGoalFixture(), before = await readState(f.context), real = io.writeJson;
  const meta = f.meta;
  const failing = vi.spyOn(io, "writeJson").mockImplementation(async (...args) => {
    if (args[2] === "tasks/state.json") throw new Error("injected publish failure");
    return real(...args);
  });
  try { await expect(mutateState(f.context, meta, { fault: true }, () => [])).rejects.toThrow("injected publish failure"); }
  finally { failing.mockRestore(); }
  expect(await readState(f.context)).toEqual(before);
  await mutateState(f.context, meta, { fault: true }, () => []);
  expect((await readState(f.context)).revision).toBe(before.revision + 1);
});

test("lost acknowledgement after publication replays the durable receipt without applying again", async () => {
  const f = await makeGoalFixture(), before = await readState(f.context), real = io.writeJson, meta = f.meta;
  let calls = 0;
  const change = () => { calls++; return ["resource"]; };
  const failing = vi.spyOn(io, "writeJson").mockImplementation(async (...args) => {
    await real(...args);
    if (args[2] === "tasks/state.json") throw new Error("injected acknowledgement loss");
  });
  try { await expect(mutateState(f.context, meta, { acknowledgement: false }, change)).rejects.toThrow("acknowledgement loss"); }
  finally { failing.mockRestore(); }
  const receipt = await mutateState(f.context, meta, { acknowledgement: false }, change);
  expect(receipt.revision).toBe(before.revision + 1); expect(calls).toBe(1);
});

test("blobs published before failed admission are not mistaken for a recoverable snapshot", async () => {
  const f = await makeGoalFixture(), real = io.writeJson, meta = f.meta;
  const input = { taskId: f.task.id, paths: ["src"], token: null };
  const failing = vi.spyOn(io, "writeJson").mockImplementation(async (...args) => {
    if (args[2] === "tasks/state.json") throw new Error("injected admission failure");
    await real(...args);
  });
  try { await expect(captureSnapshot(f.context, meta, input)).rejects.toThrow("admission failure"); }
  finally { failing.mockRestore(); }
  expect(Object.keys((await readState(f.context)).snapshots)).toEqual([]);
  expect((await readdir(join(f.context.storeRoot, "blobs"))).length).toBeGreaterThan(0);
  const snapshot = await captureSnapshot(f.context, meta, input);
  expect(Object.keys((await readState(f.context)).snapshots)).toEqual([snapshot.id]);
});
