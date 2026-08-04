import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import { SCHEMA_VERSION, type TaskRecord } from "../../src/core/types.js";
import { createTempRepo, readJson, runCli, writeJson } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("an unconfirmed high-risk proposal emits clean JSON and creates no task", async () => {
  const cwd = await initializedRepo();

  const result = await runCli([
    "propose",
    "--title", "Production migration",
    "--description", "Move production data",
    "--risk", "auto",
    "--quality", "tdd",
    "--execution", "single-agent",
    "--json",
  ], cwd);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    title: "Production migration",
    description: "Move production data",
    risk: { level: "high", reasons: ["production", "migration", "data"] },
    qualityMode: "tdd",
    executionMode: "single-agent",
  });
  expect(await readdir(join(cwd, ".vinea", "tasks", "active"))).toEqual([]);
});

test("a low-risk proposal remains inline until explicitly confirmed", async () => {
  const cwd = await initializedRepo();

  const proposal = await runCli([
    "propose",
    "--title", "Fix typo",
    "--description", "Correct one label",
    "--risk", "auto",
    "--quality", "standard",
    "--execution", "single-agent",
  ], cwd);

  expect(proposal.exitCode).toBe(0);
  expect(proposal.stdout).toContain("risk: low");
  expect(proposal.stdout).toContain("confirmation required");
  expect(await readdir(join(cwd, ".vinea", "tasks", "active"))).toEqual([]);
});

test("an explicit inline skip appends one versioned audit record and no active task", async () => {
  const cwd = await initializedRepo();

  const result = await runCli([
    "propose",
    "--title", "Fix typo",
    "--description", "Correct one label",
    "--risk", "auto",
    "--quality", "standard",
    "--execution", "single-agent",
    "--inline-skip-reason", "User chose a tiny inline edit",
    "--json",
  ], cwd);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  expect(output).toEqual({
    schemaVersion: SCHEMA_VERSION,
    timestamp: expect.any(String),
    requestSummary: "Fix typo: Correct one label",
    proposedRisk: { level: "low", reasons: [] },
    reason: "User chose a tiny inline edit",
  });
  const lines = (await readFile(join(cwd, ".vinea", "inline-audit.jsonl"), "utf8")).trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toEqual(output);
  expect(await readdir(join(cwd, ".vinea", "tasks", "active"))).toEqual([]);
});

test("inline skip and confirmation are mutually exclusive", async () => {
  const cwd = await initializedRepo();

  const result = await runCli([
    "propose",
    "--title", "Fix typo",
    "--description", "Correct one label",
    "--risk", "low",
    "--quality", "standard",
    "--execution", "single-agent",
    "--confirmed",
    "--inline-skip-reason", "Do it inline",
    "--json",
  ], cwd);

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    error: {
      code: "VINEA_VALIDATION_INVALID",
      message: "--confirmed cannot be combined with --inline-skip-reason.",
    },
  });
  expect(await readdir(join(cwd, ".vinea", "tasks", "active"))).toEqual([]);
});

test("confirmed proposal creates the task and records user confirmation", async () => {
  const cwd = await initializedRepo();

  const result = await runCli([
    "propose",
    "--title", "Cross-file behavior change",
    "--description", "Update behavior in two files",
    "--risk", "auto",
    "--quality", "tdd",
    "--execution", "delegated",
    "--confirmed",
    "--json",
  ], cwd);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const task = JSON.parse(result.stdout) as TaskRecord;
  expect(task.id).toMatch(/^t-\d{8}-\d{6}-cross-file-behavior-change$/);
  expect(task.status).toBe("planning");
  expect(task.risk).toEqual({ level: "medium", reasons: ["behavior", "cross-file"] });
  const taskDirectory = join(cwd, ".vinea", "tasks", "active", task.id);
  expect((await readdir(taskDirectory)).sort()).toEqual([
    "brief.md",
    "check-history.jsonl",
    "check.md",
    "context.jsonl",
    "evidence.jsonl",
    "journal.md",
    "plan.md",
    "task.json",
  ]);
  const firstJournal = JSON.parse((await readFile(join(taskDirectory, "journal.md"), "utf8")).trim());
  expect(firstJournal.confirmation).toBe("user");
});

test("task list and show provide parseable JSON and human gate details", async () => {
  const cwd = await initializedRepo();
  const task = await createConfirmedTask(cwd, "Listable task");

  const listResult = await runCli(["task", "list", "--status", "active", "--json"], cwd);
  expect(listResult.exitCode).toBe(0);
  expect(listResult.stderr).toBe("");
  expect(JSON.parse(listResult.stdout)).toEqual([task]);

  const showResult = await runCli(["task", "show", task.id, "--json"], cwd);
  expect(showResult.exitCode).toBe(0);
  expect(showResult.stderr).toBe("");
  expect(JSON.parse(showResult.stdout)).toMatchObject({
    ...task,
    failedOrUncoveredIds: [],
    reworkEligible: false,
    nextAction: "ready",
  });

  const human = await runCli(["task", "show", task.id], cwd);
  expect(human.stdout).toContain(`task ID: ${task.id}`);
  expect(human.stdout).toContain("status: planning");
  expect(human.stdout).toContain("quality mode: standard");
  expect(human.stdout).toContain("execution mode: single-agent");
  expect(human.stdout).toContain("risk reasons: none");
  expect(human.stdout).toContain("incomplete requirements: none");
  expect(human.stdout).toContain("next gate: ready");
});

test("task transition rejects skips and task unblock is the only blocked exit", async () => {
  const cwd = await initializedRepo();
  const task = await createConfirmedTask(cwd, "Guarded CLI task");

  const skipped = await runCli([
    "task", "transition", task.id,
    "--to", "checking",
    "--reason", "Skip ahead",
    "--json",
  ], cwd);
  expect(skipped.exitCode).toBe(1);
  expect(skipped.stderr).toBe("");
  expect(JSON.parse(skipped.stdout)).toMatchObject({
    error: { code: "VINEA_TRANSITION_INVALID" },
  });

  const blocked = await runCli([
    "task", "transition", task.id,
    "--to", "blocked",
    "--reason", "Waiting for access",
    "--json",
  ], cwd);
  expect((JSON.parse(blocked.stdout) as TaskRecord).status).toBe("blocked");

  const taskDirectory = join(cwd, ".vinea", "tasks", "active", task.id);
  const stored = await readJson<TaskRecord>(join(taskDirectory, "task.json"));
  stored.requirements.push({
    schemaVersion: SCHEMA_VERSION,
    id: "R1",
    text: "Access is available",
    createdAt: new Date().toISOString(),
  });
  await writeJson(join(taskDirectory, "task.json"), stored);
  await writeFile(join(taskDirectory, "brief.md"), "# Brief\n\nUse access.\n", "utf8");
  await writeFile(join(taskDirectory, "plan.md"), "# Plan\n\n1. Proceed.\n", "utf8");

  const ordinaryExit = await runCli([
    "task", "transition", task.id,
    "--to", "ready",
    "--reason", "Access arrived",
    "--json",
  ], cwd);
  expect(ordinaryExit.exitCode).toBe(1);
  expect(JSON.parse(ordinaryExit.stdout)).toMatchObject({
    error: { code: "VINEA_TRANSITION_INVALID" },
  });

  const unblocked = await runCli([
    "task", "unblock", task.id,
    "--to", "ready",
    "--reason", "Access arrived",
    "--json",
  ], cwd);
  expect(unblocked.exitCode).toBe(0);
  expect((JSON.parse(unblocked.stdout) as TaskRecord).status).toBe("ready");
  const journal = (await readFile(join(taskDirectory, "journal.md"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(journal.slice(-2)).toMatchObject([
    {
      type: "transition_intent",
      operationId: expect.any(String),
      oldStatus: "planning",
      newStatus: "blocked",
      actor: "cli",
      reason: "Waiting for access",
    },
    {
      type: "transition_intent",
      operationId: expect.any(String),
      oldStatus: "blocked",
      newStatus: "ready",
      actor: "cli",
      reason: "Access arrived",
    },
  ]);
});

async function initializedRepo(): Promise<string> {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  return cwd;
}

async function createConfirmedTask(cwd: string, title: string): Promise<TaskRecord> {
  const result = await runCli([
    "propose",
    "--title", title,
    "--description", "A small local change",
    "--risk", "auto",
    "--quality", "standard",
    "--execution", "single-agent",
    "--confirmed",
    "--json",
  ], cwd);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as TaskRecord;
}
