import { access, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "vitest";
import { captureSnapshot, compareSnapshot, loadSnapshot } from "../../src/kernel/snapshots.js";
import { claimWork } from "../../src/kernel/ownership.js";
import { makeGoalFixture, fingerprintFixtureTree } from "../helpers/kernel-fixture.js";

test("snapshot stores new and deleted contents and detects new files in the selected scope", async () => {
  const f = await makeGoalFixture();
  const token = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  await writeFile(join(f.root, "src/new.ts"), "new\n");
  await unlink(join(f.root, "src/app.ts"));
  const meta = f.meta;
  const snap = await captureSnapshot(f.context, meta, { taskId: f.task.id, paths: ["src"], token });
  expect(snap.entries.find(e => e.path === "src/app.ts")?.kind).toBe("deleted");
  const entry = snap.entries.find(e => e.path === "src/new.ts")!;
  expect((await readFile(join(f.context.storeRoot, "blobs", entry.sha256!))).toString()).toBe("new\n");
  expect((await compareSnapshot(f.context, snap)).matches).toBe(true);
  await writeFile(join(f.root, "src/later.ts"), "later\n");
  expect((await compareSnapshot(f.context, snap)).matches).toBe(false);
});
test("an admitted snapshot with a missing content blob is not recoverable", async () => {
  const f = await makeGoalFixture();
  const snap = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  await unlink(join(f.context.storeRoot, "blobs", snap.entries[0]!.sha256!));
  await expect(loadSnapshot(f.context, snap.id)).rejects.toMatchObject({ code: "SNAPSHOT_UNAVAILABLE" });
});
test("persist false writes no snapshot artifacts and secret paths are rejected", async () => {
  const f = await makeGoalFixture(), meta = f.meta;
  const before = await fingerprintFixtureTree(f.context.storeRoot);
  meta.invocation.persist = false;
  await expect(captureSnapshot(f.context, meta, { taskId: f.task.id, paths: ["src"], token: null })).rejects.toMatchObject({ code: "PERSISTENCE_DISABLED" });
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
  await writeFile(join(f.root, ".env"), "SECRET=private\n");
  await expect(captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: [".env"], token: null })).rejects.toMatchObject({ code: "SENSITIVE_INPUT" });
  await expect(access(join(f.context.storeRoot, "snapshots"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("snapshot scopes are literal file paths, not Git wildcard expressions", async () => {
  const f = await makeGoalFixture();
  await writeFile(join(f.root, "src/[ab].ts"), "literal\n");
  await writeFile(join(f.root, "src/a.ts"), "not selected\n");
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src/[ab].ts"], token: null });
  expect(snapshot.entries.map(e => e.path)).toEqual(["src/[ab].ts"]);
});
