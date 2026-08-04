import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import { createTempRepo, runCli } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("doctor JSON reports a supported initialized workspace as healthy", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);

  const result = await runCli(["doctor", "--json"], cwd);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    initialized: true,
    configSchemaVersion: 2,
    missingRequiredDirectories: [],
    supportedSchema: true,
    migrationGuidance: null,
    healthy: true,
    taskLocks: [],
    rework: [],
    migration: {
      status: "none",
    },
    gitStatus: {
      available: true,
      error: null,
    },
  });
});

test("doctor identifies a version 1 workspace as requiring explicit migration", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);

  const configPath = join(cwd, ".vinea", "config.json");
  const legacyConfig = JSON.stringify({
    schemaVersion: 1,
    riskRules: {
      medium: ["behavior"],
      high: ["migration"],
    },
    context: { maxFiles: 12, maxEstimatedBytes: 80000 },
  });
  await writeFile(configPath, legacyConfig, "utf8");

  const result = await runCli(["doctor", "--json"], cwd);
  const diagnostic = JSON.parse(result.stdout) as Record<string, unknown>;

  expect(result.exitCode).toBe(1);
  expect(diagnostic.configSchemaVersion).toBe(1);
  expect(diagnostic.supportedSchema).toBe(false);
  expect(diagnostic.migrationGuidance).toContain("vinea migrate");
  expect(await (await import("node:fs/promises")).readFile(configPath, "utf8")).toBe(legacyConfig);
});

test("doctor identifies future schemas without changing the workspace", async () => {
  const cwd = await createTempRepo();
  await mkdir(join(cwd, ".vinea"), { recursive: true });
  const configPath = join(cwd, ".vinea", "config.json");
  const contents = JSON.stringify({ schemaVersion: 3 });
  await writeFile(configPath, contents, "utf8");

  const result = await runCli(["doctor", "--json"], cwd);
  const diagnostic = JSON.parse(result.stdout) as Record<string, unknown>;

  expect(result.exitCode).toBe(1);
  expect(diagnostic.initialized).toBe(true);
  expect(diagnostic.supportedSchema).toBe(false);
  expect(diagnostic.migrationGuidance).toContain("newer");
  expect(await (await import("node:fs/promises")).readFile(configPath, "utf8")).toBe(contents);
});
