import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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
    configSchemaVersion: 2,
    missingRequiredDirectories: [],
    supportedSchema: true,
    migrationGuidance: null,
    healthy: true,
    taskLocks: [],
    rework: [],
    migration: { status: "none" },
    gitStatus: {
      available: true,
      error: null,
    },
  });
});

test("doctor treats a workspace with no task locks as healthy", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);

  const result = await runCli(["doctor", "--json"], cwd);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ healthy: true, taskLocks: [] });
});

test.each([
  ["ownerless", undefined, "missing"],
  ["malformed", "{\"token\":42}\n", "malformed"],
  ["valid", "{\"token\":\"retained-owner\"}\n", "valid"],
] as const)("doctor reports a retained %s task lock without removing it", async (_kind, owner, ownerStatus) => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const taskId = "t-20260731-193000-lock-diagnostic";
  const lockDirectory = join(cwd, ".vinea", ".runtime", "task-locks", `${taskId}.lock`);
  await mkdir(lockDirectory, { recursive: true });
  if (owner !== undefined) await writeFile(join(lockDirectory, "owner.json"), owner, "utf8");
  const before = await stat(lockDirectory);

  const result = await runCli(["doctor", "--json"], cwd);
  const report = JSON.parse(result.stdout) as {
    healthy: boolean;
    taskLocks: Array<{
      path: string;
      taskId: string | null;
      ageMilliseconds: number;
      status: string;
      owner: { status: string; token?: string };
      recoveryInstruction: string;
    }>;
  };

  expect(result.exitCode).toBe(1);
  expect(report.healthy).toBe(false);
  expect(report.taskLocks).toEqual([{
    path: `.vinea/.runtime/task-locks/${taskId}.lock`,
    taskId,
    ageMilliseconds: expect.any(Number),
    status: ownerStatus === "valid" ? "retained" : `owner_${ownerStatus}`,
    owner: ownerStatus === "valid" ? { status: "valid", token: "retained-owner" } : { status: ownerStatus },
    recoveryInstruction: `Confirm no active process, then remove exact lock directory .vinea/.runtime/task-locks/${taskId}.lock.`,
  }]);
  expect(report.taskLocks[0]!.ageMilliseconds).toBeGreaterThanOrEqual(0);
  expect((await stat(lockDirectory)).mtimeMs).toBe(before.mtimeMs);
  if (owner !== undefined) expect(await readFile(join(lockDirectory, "owner.json"), "utf8")).toBe(owner);
});

test.each([
  ["ownerless", undefined, "missing"],
  ["malformed", "{\"token\":42}\n", "malformed"],
  ["valid", "{\"token\":\"promotion-owner\"}\n", "valid"],
] as const)("doctor reports a retained %s learning promotion lock without removing it", async (_kind, owner, ownerStatus) => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const lockDirectory = join(cwd, ".vinea", ".runtime", "learning-promotion.lock");
  await mkdir(lockDirectory, { recursive: true });
  if (owner !== undefined) await writeFile(join(lockDirectory, "owner.json"), owner, "utf8");
  const before = await stat(lockDirectory);

  const result = await runCli(["doctor", "--json"], cwd);
  const report = JSON.parse(result.stdout) as {
    healthy: boolean;
    taskLocks: Array<{
      path: string;
      taskId: string | null;
      ageMilliseconds: number;
      status: string;
      owner: { status: string; token?: string };
      recoveryInstruction: string;
    }>;
  };

  expect(result.exitCode).toBe(1);
  expect(report.healthy).toBe(false);
  expect(report.taskLocks).toEqual([{
    path: ".vinea/.runtime/learning-promotion.lock",
    taskId: null,
    ageMilliseconds: expect.any(Number),
    status: ownerStatus === "valid" ? "retained" : `owner_${ownerStatus}`,
    owner: ownerStatus === "valid" ? { status: "valid", token: "promotion-owner" } : { status: ownerStatus },
    recoveryInstruction: "Confirm no active process, then remove exact lock directory .vinea/.runtime/learning-promotion.lock.",
  }]);
  expect((await stat(lockDirectory)).mtimeMs).toBe(before.mtimeMs);
  if (owner !== undefined) expect(await readFile(join(lockDirectory, "owner.json"), "utf8")).toBe(owner);
});

test("doctor reports a symbolic-link learning promotion lock without following or removing it", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const lockDirectory = join(cwd, ".vinea", ".runtime", "learning-promotion.lock");
  const outsideLock = join(cwd, "outside-promotion-lock");
  await mkdir(outsideLock);
  await writeFile(join(outsideLock, "owner.json"), "{\"token\":\"outside\"}\n", "utf8");
  await symlink(outsideLock, lockDirectory);

  const result = await runCli(["doctor", "--json"], cwd);
  const report = JSON.parse(result.stdout) as { taskLocks: Array<{ status: string; owner: { status: string } }> };

  expect(result.exitCode).toBe(1);
  expect(report.taskLocks).toEqual([expect.objectContaining({
    path: ".vinea/.runtime/learning-promotion.lock",
    taskId: null,
    status: "directory_invalid",
    owner: { status: "unsafe" },
  })]);
  expect(await readFile(join(outsideLock, "owner.json"), "utf8")).toBe("{\"token\":\"outside\"}\n");
});

test("doctor reports an unsafe task-lock owner file without following it", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const taskId = "t-20260731-193100-unsafe-lock";
  const lockDirectory = join(cwd, ".vinea", ".runtime", "task-locks", `${taskId}.lock`);
  const outsideOwner = join(cwd, "outside-owner.json");
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(outsideOwner, "{\"token\":\"outside\"}\n", "utf8");
  await symlink(outsideOwner, join(lockDirectory, "owner.json"));

  const result = await runCli(["doctor", "--json"], cwd);
  const report = JSON.parse(result.stdout) as { taskLocks: Array<{ owner: { status: string } }> };

  expect(result.exitCode).toBe(1);
  expect(report.taskLocks[0]!.owner).toEqual({ status: "unsafe" });
  expect(await readFile(outsideOwner, "utf8")).toBe("{\"token\":\"outside\"}\n");
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
