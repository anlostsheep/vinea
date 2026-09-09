import { access, mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "vitest";
import { discoverRepository, newActor } from "../../src/kernel/repository.js";
import { initializeStore, readState, mutateState, inspectStore } from "../../src/kernel/store.js";
import { makeRepoFixture, testMeta, fingerprintFixtureTree } from "../helpers/kernel-fixture.js";

test("persist false refuses before creating the store or a lock", async () => {
  const f = await makeRepoFixture(), ctx = await discoverRepository(f.root);
  const meta = testMeta(newActor("codex")); meta.invocation.persist = false;
  await expect(initializeStore(ctx, meta, { summary: "init", reference: null })).rejects.toMatchObject({ code: "PERSISTENCE_DISABLED" });
  await expect(access(ctx.storeRoot)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await inspectStore(ctx)).status).toBe("missing");
});
test("one operation is applied once and conflicting retries do not mutate", async () => {
  const f = await makeRepoFixture(), ctx = await discoverRepository(f.root);
  const meta = testMeta(newActor("codex"));
  await initializeStore(ctx, meta, { summary: "init", reference: null });
  const op = { ...meta, operationId: "same-op" };
  let calls = 0;
  const mutate = () => { calls++; return ["receipt"]; };
  const [a, b] = await Promise.all([mutateState(ctx, op, { x: 1 }, mutate), mutateState(ctx, op, { x: 1 }, mutate)]);
  expect(a).toEqual(b); expect(calls).toBe(1);
  expect((await readState(ctx)).revision).toBe(1);
  const before = await fingerprintFixtureTree(ctx.storeRoot);
  await expect(mutateState(ctx, op, { x: 2 }, mutate)).rejects.toMatchObject({ code: "OPERATION_ID_REUSED" });
  expect(await fingerprintFixtureTree(ctx.storeRoot)).toBe(before);
});
test("failed mutation does not publish and damaged storage is not reinitialized", async () => {
  const f = await makeRepoFixture(), ctx = await discoverRepository(f.root);
  const meta = testMeta(newActor("claude"));
  await initializeStore(ctx, meta, { summary: "init", reference: null });
  await expect(mutateState(ctx, meta, {}, () => { throw new Error("stop"); })).rejects.toThrow("stop");
  expect((await readState(ctx)).revision).toBe(0);
  await writeFile(join(ctx.storeRoot, "tasks/state.json"), "{broken");
  await expect(initializeStore(ctx, meta, { summary: "init", reference: null })).rejects.toMatchObject({ code: "STATE_INVALID" });
  expect((await inspectStore(ctx)).status).toBe("invalid");
});
test("storage symlinks are rejected before files escape the common Git directory", async () => {
  const f = await makeRepoFixture(), ctx = await discoverRepository(f.root);
  const outside = join(f.directory, "outside"); await mkdir(outside);
  await symlink(outside, ctx.storeRoot);
  await expect(initializeStore(ctx, testMeta(newActor("codex")), { summary: "init", reference: null })).rejects.toMatchObject({ code: "UNSAFE_PATH" });
  await expect(access(join(outside, "tasks"))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await inspectStore(ctx)).status).toBe("invalid");
});

test("lock timeout does not steal ownership or publish a mutation", async () => {
  const f = await makeRepoFixture(), ctx = await discoverRepository(f.root), meta = testMeta(newActor("fixture"));
  await initializeStore(ctx, meta, { summary: "fixture", reference: null });
  await mkdir(join(ctx.storeRoot, "runtime/store.lock"), { recursive: true });
  const before = await fingerprintFixtureTree(ctx.storeRoot);
  let called = false;
  await expect(mutateState(ctx, meta, { locked: true }, () => { called = true; return []; })).rejects.toMatchObject({ code: "STORE_LOCKED" });
  expect(called).toBe(false); expect(await fingerprintFixtureTree(ctx.storeRoot)).toBe(before);
}, 10000);
