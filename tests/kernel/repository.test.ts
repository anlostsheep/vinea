import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect } from "vitest";
import { discoverRepository, newActor } from "../../src/kernel/repository.js";
import { canonicalJson, assertRepositoryState } from "../../src/kernel/schema.js";
import { makeRepoFixture, git } from "../helpers/kernel-fixture.js";

test("linked worktrees resolve one store without creating it", async () => {
  const f = await makeRepoFixture();
  const a = await discoverRepository(f.root), b = await discoverRepository(f.linkedRoot);
  expect(a.storeRoot).toBe(join(f.root, ".git", "vinea"));
  expect(b.storeRoot).toBe(a.storeRoot);
  expect(a.workspaceId).not.toBe(b.workspaceId);
  await expect(access(a.storeRoot)).rejects.toMatchObject({ code: "ENOENT" });
});
test("non Git discovery is read-only and rejects rather than initializing", async () => {
  const root = await mkdtemp(join(tmpdir(), "vinea-not-git-"));
  await expect(discoverRepository(root)).rejects.toMatchObject({ code: "NOT_GIT_REPOSITORY" });
  await expect(access(join(root, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
});
test("unborn repositories are supported and clones have a separate identity", async () => {
  const f = await makeRepoFixture();
  const unborn = join(f.directory, "unborn\nworkspace");
  await mkdir(unborn); await git(unborn, "init");
  expect((await discoverRepository(unborn)).worktreeRoot).toBe(unborn);
  const clone = join(f.directory, "clone");
  await git(f.directory, "clone", f.root, clone);
  expect((await discoverRepository(clone)).storeRoot).not.toBe((await discoverRepository(f.root)).storeRoot);
});
test("identity does not invent host session IDs and canonical JSON rejects unsafe data", () => {
  expect(newActor("claude")).not.toHaveProperty("hostSessionId");
  expect(newActor("codex", "real-session").hostSessionId).toBe("real-session");
  expect(canonicalJson({ z: 1, a: [2, 1] })).toBe('{"a":[2,1],"z":1}');
  expect(() => canonicalJson({ value: NaN })).toThrow();
  expect(() => canonicalJson({ value: undefined })).toThrow();
  expect(() => assertRepositoryState({ kernelSchemaVersion: 999 })).toThrow();
});
