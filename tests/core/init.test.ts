import { access, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import { assertNoSymlink, resolveVineaPaths } from "../../src/core/paths.js";
import { createTempRepo, readJson, runCli } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("init creates the versioned Vinea workspace without touching root guidance", async () => {
  const cwd = await createTempRepo();
  await writeFile(join(cwd, ".gitignore"), "node_modules/\n", "utf8");
  await writeFile(join(cwd, "AGENTS.md"), "keep agents\n", "utf8");
  await writeFile(join(cwd, "CLAUDE.md"), "keep claude\n", "utf8");

  const result = await runCli(["init"], cwd);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(await readJson(join(cwd, ".vinea", "config.json"))).toEqual({
    schemaVersion: 1,
    riskRules: {
      medium: ["behavior", "bug", "cross-file", "external", "security", "data", "deploy"],
      high: ["production", "migration", "credential", "permission", "delete"],
    },
    context: { maxFiles: 12, maxEstimatedBytes: 80000 },
  });
  expect(await readFile(join(cwd, ".vinea", ".gitignore"), "utf8")).toBe(".runtime/\n");
  expect(await readFile(join(cwd, ".vinea", "specs", "index.md"), "utf8")).toContain("Indexed specs");
  expect(await listTree(join(cwd, ".vinea"))).toEqual([
    ".gitignore",
    ".runtime/",
    ".runtime/sessions/",
    "config.json",
    "specs/",
    "specs/index.md",
    "tasks/",
    "tasks/active/",
    "tasks/archive/",
  ]);
  expect(await readFile(join(cwd, ".gitignore"), "utf8")).toBe("node_modules/\n");
  expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe("keep agents\n");
  expect(await readFile(join(cwd, "CLAUDE.md"), "utf8")).toBe("keep claude\n");
});

test("init is idempotent and rejects malformed existing configuration", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const configPath = join(cwd, ".vinea", "config.json");
  const firstConfig = await readFile(configPath, "utf8");

  const repeat = await runCli(["init"], cwd);
  expect(repeat.exitCode).toBe(0);
  expect(await readFile(configPath, "utf8")).toBe(firstConfig);

  await writeFile(configPath, "{ broken", "utf8");
  const malformed = await runCli(["init"], cwd);
  expect(malformed.exitCode).toBe(1);
  expect(malformed.stderr).toContain("VINEA_SCHEMA_INVALID");
  await expect(access(configPath)).resolves.toBeUndefined();
});

test("init rejects future schemas with safe migration guidance and preserves configuration", async () => {
  const cwd = await createTempRepo();
  const configPath = join(cwd, ".vinea", "config.json");
  await mkdir(join(cwd, ".vinea"), { recursive: true });
  const contents = JSON.stringify({ schemaVersion: 2 });
  await writeFile(configPath, contents, "utf8");

  const result = await runCli(["init"], cwd);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("VINEA_SCHEMA_INVALID");
  expect(result.stderr).toContain("Upgrade Vinea before modifying the workspace");
  expect(result.stderr).toContain("do not recreate or overwrite it");
  expect(await readFile(configPath, "utf8")).toBe(contents);
});

test("init rejects a managed file that is a symbolic link", async () => {
  const cwd = await createTempRepo();
  const specs = join(cwd, ".vinea", "specs");
  await mkdir(specs, { recursive: true });
  await symlink(join(cwd, "outside.md"), join(specs, "index.md"));

  const result = await runCli(["init"], cwd);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("VINEA_SCHEMA_INVALID");
});

test("path checks reject a repository root reached through a symbolic link", async () => {
  const cwd = await createTempRepo();
  const linkedRoot = `${cwd}-link`;
  await symlink(cwd, linkedRoot);

  await expect(assertNoSymlink(linkedRoot, resolveVineaPaths(linkedRoot).vineaRoot)).rejects.toMatchObject({
    code: "VINEA_SCHEMA_INVALID",
  });
});

async function listTree(root: string, relativePath = ""): Promise<string[]> {
  const entries = await readdir(join(root, relativePath), { withFileTypes: true });
  const children = await Promise.all(entries.map(async (entry) => {
    const child = join(relativePath, entry.name);
    if (!entry.isDirectory()) return [child];
    return [`${child}/`, ...(await listTree(root, child))];
  }));
  return children.flat().sort();
}
