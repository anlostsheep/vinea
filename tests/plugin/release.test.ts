import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const releaseScript = join(repositoryRoot, "scripts", "release.mjs");

test("creates a scoped local release commit and annotated tag while preserving dirty Vinea state", async () => {
  const fixtureRoot = await createReleaseFixture();
  try {
    await writeFile(join(fixtureRoot, ".vinea", "task.json"), "{\"status\":\"in_progress\"}\n", "utf8");

    const released = await execFileAsync(process.execPath, [releaseScript, "0.3.0"], {
      cwd: fixtureRoot,
      encoding: "utf8",
    });

    expect(released.stdout).toContain("Created local Vinea release 0.3.0");
    expect(released.stdout).toContain("> vinea@0.3.0 check");
    expect(JSON.parse(await readFile(join(fixtureRoot, "package.json"), "utf8"))).toMatchObject({
      name: "vinea",
      version: "0.3.0",
    });
    expect((await git(fixtureRoot, ["log", "-1", "--pretty=%s"])).trim()).toBe("chore: release Vinea 0.3.0");
    expect((await git(fixtureRoot, ["cat-file", "-t", "v0.3.0"])).trim()).toBe("tag");
    expect((await git(fixtureRoot, ["diff", "HEAD^", "HEAD", "--name-only"])).trim().split("\n").sort()).toEqual([
      ".agents/plugins/marketplace.json",
      ".claude-plugin/marketplace.json",
      "package.json",
      "plugins/vinea/.claude-plugin/plugin.json",
      "plugins/vinea/.codex-plugin/plugin.json",
    ]);
    expect((await git(fixtureRoot, ["status", "--short", "--", ".vinea/task.json"])).trim()).toBe("M .vinea/task.json");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("accepts a semantic bump keyword and resolves it before creating the release", async () => {
  const fixtureRoot = await createReleaseFixture();
  try {
    const released = await execFileAsync(process.execPath, [releaseScript, "minor"], {
      cwd: fixtureRoot,
      encoding: "utf8",
    });

    expect(released.stdout).toContain("Created local Vinea release 0.3.0");
    expect(JSON.parse(await readFile(join(fixtureRoot, "package.json"), "utf8"))).toMatchObject({
      version: "0.3.0",
    });
    expect((await git(fixtureRoot, ["cat-file", "-t", "v0.3.0"])).trim()).toBe("tag");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("reports partial local state when validation fails without committing, tagging, or pushing", async () => {
  const fixtureRoot = await createReleaseFixture();
  try {
    const failed = spawnSync(process.execPath, [releaseScript, "0.3.0"], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: { ...process.env, VINEA_RELEASE_TEST_FAIL: "1" },
    });

    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("Local commit: not created; local tag: not created; push: not attempted.");
    expect(JSON.parse(await readFile(join(fixtureRoot, "package.json"), "utf8"))).toMatchObject({ version: "0.3.0" });
    expect((await git(fixtureRoot, ["log", "-1", "--pretty=%s"])).trim()).toBe("test: seed release fixture");
    expect((await git(fixtureRoot, ["tag", "--list", "v0.3.0"])).trim()).toBe("");
    expect((await git(fixtureRoot, ["status", "--short", "--", "package.json"])).trim()).toBe("M package.json");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("rejects a dirty non-Vinea worktree before changing the version", async () => {
  const fixtureRoot = await createReleaseFixture();
  try {
    await writeFile(join(fixtureRoot, "README.md"), "uncommitted work\n", "utf8");
    const failed = spawnSync(process.execPath, [releaseScript, "0.3.0"], {
      cwd: fixtureRoot,
      encoding: "utf8",
    });

    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("clean non-.vinea worktree");
    expect(JSON.parse(await readFile(join(fixtureRoot, "package.json"), "utf8"))).toMatchObject({ version: "0.2.0" });
    expect((await git(fixtureRoot, ["tag", "--list", "v0.3.0"])).trim()).toBe("");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("rejects staged Vinea task state before changing the version", async () => {
  const fixtureRoot = await createReleaseFixture();
  try {
    await writeFile(join(fixtureRoot, ".vinea", "task.json"), "{\"status\":\"in_progress\"}\n", "utf8");
    await git(fixtureRoot, ["add", "--", ".vinea/task.json"]);
    const failed = spawnSync(process.execPath, [releaseScript, "0.3.0"], {
      cwd: fixtureRoot,
      encoding: "utf8",
    });

    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("Vinea task state must not be staged for release");
    expect(JSON.parse(await readFile(join(fixtureRoot, "package.json"), "utf8"))).toMatchObject({ version: "0.2.0" });
    expect((await git(fixtureRoot, ["tag", "--list", "v0.3.0"])).trim()).toBe("");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("rejects a non-SemVer current package version before running release checks", async () => {
  const fixtureRoot = await createReleaseFixture("development");
  try {
    const failed = spawnSync(process.execPath, [releaseScript, "patch"], {
      cwd: fixtureRoot,
      encoding: "utf8",
    });

    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("Current package.json version must be MAJOR.MINOR.PATCH");
    expect((await git(fixtureRoot, ["log", "-1", "--pretty=%s"])).trim()).toBe("test: seed release fixture");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

async function createReleaseFixture(version = "0.2.0"): Promise<string> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "vinea-release-"));
  await mkdir(join(fixtureRoot, ".vinea"), { recursive: true });
  await writeFile(join(fixtureRoot, "package.json"), `${JSON.stringify({
    name: "vinea",
    version,
    private: true,
    type: "module",
    scripts: { check: "node check.mjs" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(fixtureRoot, "check.mjs"), `
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (process.env.VINEA_RELEASE_TEST_FAIL === "1") throw new Error("intentional release validation failure");
for (const path of [
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  "plugins/vinea/.codex-plugin/plugin.json",
  "plugins/vinea/.claude-plugin/plugin.json",
]) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ version }) + "\\n", "utf8");
}
`, "utf8");
  await writeFile(join(fixtureRoot, ".vinea", "task.json"), "{\"status\":\"ready\"}\n", "utf8");
  await execFileAsync("npm", ["run", "check"], { cwd: fixtureRoot });
  await git(fixtureRoot, ["init", "-b", "main"]);
  await git(fixtureRoot, ["config", "user.name", "Vinea Test"]);
  await git(fixtureRoot, ["config", "user.email", "vinea-test@example.invalid"]);
  await git(fixtureRoot, ["add", "."]);
  await git(fixtureRoot, ["commit", "-m", "test: seed release fixture"]);
  return fixtureRoot;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd, encoding: "utf8" })).stdout;
}
