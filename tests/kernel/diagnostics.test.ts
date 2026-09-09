import { test, expect } from "vitest";
import { writeFile, readFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { makeGoalFixture, fingerprintFixtureTree } from "../helpers/kernel-fixture.js";
import { inspectStore, readState } from "../../src/kernel/store.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";

test("unsupported state schemas are diagnosed without repair", async () => {
  const f = await makeGoalFixture(), path = join(f.context.storeRoot, "tasks/state.json");
  const state = JSON.parse(await readFile(path, "utf8")); state.kernelSchemaVersion = 99;
  await writeFile(path, JSON.stringify(state));
  const before = await fingerprintFixtureTree(f.context.storeRoot);
  expect((await inspectStore(f.context)).status).toBe("invalid");
  await expect(readState(f.context)).rejects.toMatchObject({ code: "STATE_INVALID" });
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});

test("diagnostics distinguish a lock and never remove it", async () => {
  const f = await makeGoalFixture(), lock = join(f.context.storeRoot, "runtime/store.lock");
  await mkdir(lock); await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: 99999999 }));
  const before = await fingerprintFixtureTree(f.context.storeRoot);
  expect((await inspectStore(f.context)).status).toBe("locked");
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});

test("diagnostics report missing admitted content rather than calling the store healthy", async () => {
  const f = await makeGoalFixture();
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  await unlink(join(f.context.storeRoot, "blobs", snapshot.entries[0]!.sha256!));
  const before = await fingerprintFixtureTree(f.context.storeRoot), report = await inspectStore(f.context);
  expect(report.status).toBe("invalid");
  expect(report.issues.some(i => i.code === "SNAPSHOT_UNAVAILABLE")).toBe(true);
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});
