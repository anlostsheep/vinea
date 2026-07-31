import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import { createTempRepo, runCli } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("doctor reports Git availability and treats missing local runtime as recoverable", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  await rm(join(cwd, ".vinea", ".runtime"), { recursive: true });

  const result = await runCli(["doctor", "--json"], cwd);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    initialized: true,
    configSchemaVersion: 1,
    missingRequiredDirectories: [],
    supportedSchema: true,
    migrationGuidance: null,
    healthy: true,
    gitStatus: {
      available: true,
      error: null,
    },
  });
});

test("doctor gives upgrade guidance for a future schema without changing it", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const configPath = join(cwd, ".vinea", "config.json");
  const futureConfig = `${JSON.stringify({ schemaVersion: 99 })}\n`;
  await writeFile(configPath, futureConfig, "utf8");

  const result = await runCli(["doctor", "--json"], cwd);
  const report = JSON.parse(result.stdout) as {
    configSchemaVersion: number;
    migrationGuidance: string;
    gitStatus: { available: boolean };
  };

  expect(result.exitCode).toBe(1);
  expect(report.configSchemaVersion).toBe(99);
  expect(report.migrationGuidance).toContain("newer");
  expect(report.migrationGuidance).toContain("Upgrade Vinea");
  expect(report.gitStatus.available).toBe(true);
  expect(await readFile(configPath, "utf8")).toBe(futureConfig);
});

test.each(["file", "symbolic link"] as const)(
  "doctor fails when runtime session storage is an existing %s",
  async (kind) => {
    const cwd = await createTempRepo();
    expect((await runCli(["init"], cwd)).exitCode).toBe(0);
    const sessions = join(cwd, ".vinea", ".runtime", "sessions");
    await rm(sessions, { recursive: true });
    if (kind === "file") {
      await writeFile(sessions, "not a directory\n", "utf8");
    } else {
      await symlink(join(cwd, ".vinea", "tasks", "active"), sessions);
    }

    const result = await runCli(["doctor", "--json"], cwd);
    const report = JSON.parse(result.stdout) as {
      healthy: boolean;
      missingRequiredDirectories: string[];
    };

    expect(result.exitCode).toBe(1);
    expect(report.healthy).toBe(false);
    expect(report.missingRequiredDirectories).toContain(".runtime/sessions");
  },
);

test("doctor's Git diagnostic remains available when the repository index is locked", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  await writeFile(join(cwd, ".git", "index.lock"), "held by another process\n", "utf8");

  const result = await runCli(["doctor", "--json"], cwd);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    gitStatus: { available: true, error: null },
  });
});
