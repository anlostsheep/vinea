import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { continueGoal, takeoverWork } from "../../src/kernel/continuation.js";
import { claimWork } from "../../src/kernel/ownership.js";
import { discoverRepository } from "../../src/kernel/repository.js";
import { captureSnapshot, compareSnapshot } from "../../src/kernel/snapshots.js";
import { readState } from "../../src/kernel/store.js";
import { git, makeGoalFixture, testMeta } from "../helpers/kernel-fixture.js";

test.each(["unstaged", "git-rm", "add-A", "rename"])("snapshot restores deleted paths after %s", async mutation => {
  const f = await makeGoalFixture(), target = await discoverRepository(f.linkedRoot);
  const old = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  await writeFile(join(f.root, "src/new.ts"), "export const added = true;\n");
  if (mutation === "git-rm") await git(f.root, "rm", "--", "src/app.ts");
  else if (mutation === "rename") await git(f.root, "mv", "src/app.ts", "src/renamed.ts");
  else {
    await unlink(join(f.root, "src/app.ts"));
    if (mutation === "add-A") await git(f.root, "add", "-A", "--", "src");
  }
  const sourceStatus = await git(f.root, "status", "--porcelain=v1");
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: old });
  expect(snapshot.entries).toContainEqual({ path: "src/app.ts", kind: "deleted", sha256: null, mode: null });
  expect((await compareSnapshot(f.context, snapshot)).matches).toBe(true);
  const b = testMeta(f.actorB), view = await continueGoal(target, b, { taskId: f.task.id, assignmentId: null });
  const input = { from: view.occupiedWrites[0]!.ref, to: f.actorB, contractVersion: 1, transferOwner: true, ownerEpoch: 1,
    decision: { summary: "recover uncommitted changes", reference: null }, stopBasis: "unknown" as const,
    stopReference: null, baselineSnapshotId: snapshot.id };
  const restored = await takeoverWork(target, b, input);
  await expect(access(join(f.linkedRoot, "src/app.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(f.linkedRoot, "src/new.ts"), "utf8")).toBe("export const added = true;\n");
  if (mutation === "rename") expect(await readFile(join(f.linkedRoot, "src/renamed.ts"), "utf8")).toBe("export const value = 1;\n");
  expect((await compareSnapshot(target, snapshot)).matches).toBe(true);
  expect(await takeoverWork(target, b, input)).toEqual(restored);
  expect(await git(f.root, "status", "--porcelain=v1")).toBe(sourceStatus);
  const state = await readState(target);
  expect(state.claims[target.workspaceId]!.state).toBe("writer");
  expect(state.claims[f.context.workspaceId]!.state).toBe("unknown-writer-hold");
});

test("snapshot without HEAD still captures indexed files", async () => {
  const f = await makeGoalFixture();
  await git(f.root, "checkout", "--orphan", "unborn-fixture");
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null });
  expect(snapshot.baseCommit).toBeNull();
  expect(snapshot.entries.map(e => ({ path: e.path, kind: e.kind }))).toEqual([{ path: "src/app.ts", kind: "file" }]);
});

test("baseline deletions respect literal paths and do not expand snapshot scope", async () => {
  const f = await makeGoalFixture();
  await writeFile(join(f.root, "src/[ab].ts"), "literal\n");
  await writeFile(join(f.root, "src/a.ts"), "outside selected scope\n");
  await git(f.root, "--literal-pathspecs", "add", "--", "src/[ab].ts", "src/a.ts");
  await git(f.root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture literal paths");
  await git(f.root, "--literal-pathspecs", "rm", "--", "src/[ab].ts");
  const deleted = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src/[ab].ts"], token: null });
  expect(deleted.entries).toEqual([{ path: "src/[ab].ts", kind: "deleted", sha256: null, mode: null }]);
  const kept = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src/a.ts"], token: null });
  expect(kept.entries.map(e => e.path)).toEqual(["src/a.ts"]);
});

test("staged deletions count toward the snapshot file limit", async () => {
  const f = await makeGoalFixture();
  await writeFile(join(f.root, "src/new.ts"), "new\n");
  await git(f.root, "rm", "--", "src/app.ts");
  const before = await readState(f.context);
  await expect(captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: null,
    limits: { maxFiles: 1, maxFileBytes: 1024, maxTotalBytes: 1024 } })).rejects.toMatchObject({ code: "SNAPSHOT_LIMIT" });
  expect(await readState(f.context)).toEqual(before);
});
