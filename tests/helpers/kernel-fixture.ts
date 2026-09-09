import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readdir, readFile, lstat, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import type { Actor, Entry, Meta, VerificationEnvironment } from "../../src/kernel/types.js";
import { afterEach } from "vitest";

const execute = promisify(execFile);
const fixtures = new Set<string>();
afterEach(async () => {
  for (const directory of fixtures) {
    await rm(directory, { recursive: true, force: true });
    fixtures.delete(directory);
  }
});
export async function git(root: string, ...args: string[]): Promise<string> {
  return (await execute("git", args, { cwd: root })).stdout;
}
export async function makeRepoFixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "vinea-kernel-")));
  fixtures.add(directory);
  const root = join(directory, "main workspace");
  const linkedRoot = join(directory, "linked workspace");
  await mkdir(join(root, "src"), { recursive: true });
  await git(root, "init");
  await writeFile(join(root, "src/app.ts"), "export const value = 1;\n");
  await writeFile(join(root, ".gitignore"), "dist/\n.env\n");
  await git(root, "add", "src/app.ts", ".gitignore");
  await git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
  await git(root, "worktree", "add", "--detach", linkedRoot);
  return { directory, root, linkedRoot };
}
export function testMeta(actor: Actor, entry: Entry = "run", operationId: string = randomUUID()): Meta {
  return { operationId, actor, invocation: { entry, activation: "named-entry", analysisOnly: false, persist: true } };
}
export async function makeGoalFixture() {
  const f = await makeRepoFixture();
  const { discoverRepository, newActor } = await import("../../src/kernel/repository.js");
  const { initializeStore } = await import("../../src/kernel/store.js");
  const { createGoal } = await import("../../src/kernel/contracts.js");
  const context = await discoverRepository(f.root), actorA = newActor("codex"), actorB = newActor("claude");
  await initializeStore(context, testMeta(actorA), { summary: "fixture init", reference: null });
  const task = await createGoal(context, testMeta(actorA), {
    title: "Fixture goal", decision: { summary: "implement fixture", reference: null },
    contract: { goal: "Implement fixture", scope: ["src"], constraints: ["Do not commit"],
      acceptance: [{ id: "A1", text: "Expected behavior works" }], quality: "standard",
      grant: { businessWrite: true, delegate: true, commit: false, deploy: false, allowedPaths: ["src"] } },
  });
  return { ...f, context, actorA, actorB, task, get meta() { return testMeta(actorA); } };
}
export function testEnvironment(): VerificationEnvironment {
  return { runtime: process.version, platform: process.platform, labels: {} };
}
export async function fingerprintFixtureTree(root: string): Promise<string> {
  const digest = createHash("sha256");
  async function visit(path: string): Promise<void> {
    const info = await lstat(path);
    digest.update(relative(root, path));
    if (info.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) await visit(join(path, entry));
    } else digest.update(await readFile(path));
  }
  try { await visit(root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    digest.update("missing");
  }
  return digest.digest("hex");
}
