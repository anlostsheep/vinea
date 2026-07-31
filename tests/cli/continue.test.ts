import { execFile } from "node:child_process";
import { access, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import type { SessionBinding, TaskRecord } from "../../src/core/types.js";
import {
  createTempRepo,
  readJson,
  runCli,
  writeJson,
} from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("continue binds only after confirmation and --start is required to move ready to in_progress", async () => {
  const cwd = await initializedRepo();
  const task = await createReadyTask(cwd, "Resume ready task");
  const taskDirectory = join(cwd, ".vinea", "tasks", "active", task.id);
  const taskPath = join(taskDirectory, "task.json");
  const journalPath = join(taskDirectory, "journal.md");

  const continued = await runCli([
    "continue", task.id,
    "--host", "codex",
    "--session-id", "thread-123",
    "--confirmed",
    "--json",
  ], cwd);

  expect(continued.exitCode).toBe(0);
  expect(continued.stderr).toBe("");
  expect((JSON.parse(continued.stdout) as { task: TaskRecord }).task.status).toBe("ready");
  expect((await readJson<TaskRecord>(taskPath)).status).toBe("ready");
  expect(await readJson<SessionBinding>(
    join(cwd, ".vinea", ".runtime", "sessions", "codex-sid-7468726561642d313233.json"),
  )).toMatchObject({
    schemaVersion: 1,
    taskId: task.id,
    boundAt: expect.any(String),
  });

  const boundOrient = await runCli([
    "orient",
    "--host", "codex",
    "--session-id", "thread-123",
    "--json",
  ], cwd);
  expect(boundOrient.exitCode).toBe(0);
  expect(JSON.parse(boundOrient.stdout)).toMatchObject({
    recommendation: "resume-bound",
    binding: { status: "bound", taskId: task.id },
  });
  const crossHostOrient = await runCli([
    "orient",
    "--host", "claude",
    "--json",
  ], cwd);
  expect(crossHostOrient.exitCode).toBe(0);
  expect(JSON.parse(crossHostOrient.stdout)).toMatchObject({
    recommendation: "confirm-single",
    binding: null,
    candidates: [{ id: task.id }],
  });

  const started = await runCli([
    "continue", task.id,
    "--host", "codex",
    "--session-id", "thread-123",
    "--confirmed",
    "--start",
    "--reason", "Begin the confirmed implementation",
    "--json",
  ], cwd);

  expect(started.exitCode).toBe(0);
  expect((JSON.parse(started.stdout) as { task: TaskRecord }).task.status).toBe("in_progress");
  expect((await readJson<TaskRecord>(taskPath)).status).toBe("in_progress");
  const journal = parseJsonl(await readFile(journalPath, "utf8"));
  expect(journal.slice(-2)).toMatchObject([
    {
      type: "transition_intent",
      oldStatus: "ready",
      newStatus: "in_progress",
      actor: "codex",
      reason: "Begin the confirmed implementation",
    },
    {
      type: "continued",
      host: "codex",
      sessionBound: true,
      started: true,
      status: "in_progress",
    },
  ]);
  expect(journal.at(-1)).not.toHaveProperty("context");
});

test("continue without a session ID journals confirmation without creating a binding", async () => {
  const cwd = await initializedRepo();
  const task = await createReadyTask(cwd, "Continue without binding");
  const taskDirectory = join(cwd, ".vinea", "tasks", "active", task.id);
  expect((await runCli([
    "task", "transition", task.id,
    "--to", "in_progress",
    "--reason", "Begin continuation fixture",
    "--json",
  ], cwd)).exitCode).toBe(0);
  expect((await runCli([
    "task", "transition", task.id,
    "--to", "checking",
    "--reason", "Reach continuation fixture checking state",
    "--json",
  ], cwd)).exitCode).toBe(0);
  const sessions = join(cwd, ".vinea", ".runtime", "sessions");
  const beforeEntries = await readdir(sessions);

  const result = await runCli([
    "continue", task.id,
    "--host", "claude",
    "--confirmed",
    "--json",
  ], cwd);

  expect(result.exitCode).toBe(0);
  expect((JSON.parse(result.stdout) as { task: TaskRecord }).task.status).toBe("checking");
  expect((await readJson<TaskRecord>(join(taskDirectory, "task.json"))).status).toBe("checking");
  expect(await readdir(sessions)).toEqual(beforeEntries);
  expect(parseJsonl(await readFile(join(taskDirectory, "journal.md"), "utf8")).at(-1)).toMatchObject({
    type: "continued",
    host: "claude",
    sessionBound: false,
    started: false,
    status: "checking",
  });
});

test("unconfirmed, unsafe, and malformed start requests fail without mutation", async () => {
  const cwd = await initializedRepo();
  const task = await createReadyTask(cwd, "Reject invalid continuation");
  const taskDirectory = join(cwd, ".vinea", "tasks", "active", task.id);
  const taskPath = join(taskDirectory, "task.json");
  const journalPath = join(taskDirectory, "journal.md");
  const beforeTask = await readFile(taskPath, "utf8");
  const beforeJournal = await readFile(journalPath, "utf8");

  const requests = [
    [
      "continue", task.id,
      "--host", "codex",
      "--session-id", "thread-123",
      "--json",
    ],
    [
      "continue", task.id,
      "--host", "codex",
      "--session-id", "../escape",
      "--confirmed",
      "--json",
    ],
    [
      "continue", task.id,
      "--host", "codex",
      "--confirmed",
      "--start",
      "--json",
    ],
  ];
  for (const args of requests) {
    const result = await runCli(args, cwd);
    expect([1, 2]).toContain(result.exitCode);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: "VINEA_VALIDATION_INVALID" },
    });
    expect(await readFile(taskPath, "utf8")).toBe(beforeTask);
    expect(await readFile(journalPath, "utf8")).toBe(beforeJournal);
  }
  await expect(access(join(cwd, ".vinea", ".runtime", "escape.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test("continue rejects archived and invalid task IDs clearly", async () => {
  const cwd = await initializedRepo();
  const task = await createReadyTask(cwd, "Archived continuation");
  const activeDirectory = join(cwd, ".vinea", "tasks", "active", task.id);
  const archiveDirectory = join(cwd, ".vinea", "tasks", "archive", task.id);
  const stored = await readJson<TaskRecord>(join(activeDirectory, "task.json"));
  stored.status = "archived";
  await writeJson(join(activeDirectory, "task.json"), stored);
  await rename(activeDirectory, archiveDirectory);

  const archived = await runCli([
    "continue", task.id,
    "--host", "claude",
    "--confirmed",
    "--json",
  ], cwd);
  expect(archived.exitCode).toBe(1);
  expect(JSON.parse(archived.stdout)).toEqual({
    error: {
      code: "VINEA_VALIDATION_INVALID",
      message: `Task is archived and cannot be continued: ${task.id}`,
    },
  });

  const invalid = await runCli([
    "continue", "../escape",
    "--host", "claude",
    "--confirmed",
    "--json",
  ], cwd);
  expect(invalid.exitCode).toBe(1);
  expect(JSON.parse(invalid.stdout)).toMatchObject({
    error: {
      code: "VINEA_VALIDATION_INVALID",
      message: "Invalid task ID: ../escape",
    },
  });
});

test.each([
  [
    "missing",
    async (cwd: string) => {
      await rm(join(cwd, ".vinea", "tasks", "active"), { recursive: true });
    },
  ],
  [
    "unsafe symlink",
    async (cwd: string) => {
      const active = join(cwd, ".vinea", "tasks", "active");
      await rm(active, { recursive: true });
      await symlink(join(cwd, ".vinea", "tasks", "archive"), active);
    },
  ],
])("orient returns a nonzero schema diagnostic for %s active task storage", async (_label, corrupt) => {
  const cwd = await initializedRepo();
  await corrupt(cwd);

  const result = await runCli(["orient", "--host", "claude", "--json"], cwd);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({
    error: {
      code: "VINEA_SCHEMA_INVALID",
      message: expect.stringContaining("tasks/active"),
    },
  });
  expect(result.stdout).not.toContain("no-active-task");
});

test("orient returns a defined schema diagnostic for malformed nested task state", async () => {
  const cwd = await initializedRepo();
  const task = await createReadyTask(cwd, "Malformed nested orient task");
  const taskPath = join(cwd, ".vinea", "tasks", "active", task.id, "task.json");
  const stored = await readJson<TaskRecord>(taskPath);
  stored.requirements = [{} as TaskRecord["requirements"][number]];
  await writeJson(taskPath, stored);

  const result = await runCli(["orient", "--host", "claude", "--json"], cwd);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    error: {
      code: "VINEA_SCHEMA_INVALID",
      message: expect.stringContaining("Invalid task record"),
    },
  });
  expect(result.stdout).not.toContain("confirm-single");
  expect(result.stdout).not.toContain("undefined");
});

async function initializedRepo(): Promise<string> {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  return cwd;
}

async function createReadyTask(cwd: string, title: string): Promise<TaskRecord> {
  const proposed = await runCli([
    "propose",
    "--title", title,
    "--description", "Exercise continuation behavior",
    "--risk", "low",
    "--quality", "standard",
    "--execution", "single-agent",
    "--confirmed",
    "--json",
  ], cwd);
  expect(proposed.exitCode).toBe(0);
  const task = JSON.parse(proposed.stdout) as TaskRecord;
  await writeFileFixture(cwd, "brief-source.md", "# Brief\n\nResume the task.\n");
  await writeFileFixture(cwd, "plan-source.md", "# Plan\n\n1. Continue safely.\n");
  for (const args of [
    ["task", "require", task.id, "--id", "R1", "--text", "The task resumes safely", "--json"],
    ["task", "set-brief", task.id, "--file", "brief-source.md", "--json"],
    ["task", "set-plan", task.id, "--file", "plan-source.md", "--json"],
    ["task", "transition", task.id, "--to", "ready", "--reason", "Planning complete", "--json"],
  ]) {
    expect((await runCli(args, cwd)).exitCode).toBe(0);
  }
  return readJson<TaskRecord>(join(cwd, ".vinea", "tasks", "active", task.id, "task.json"));
}

async function writeFileFixture(cwd: string, filename: string, contents: string): Promise<void> {
  await writeFile(join(cwd, filename), contents, "utf8");
}

function parseJsonl(contents: string): Array<Record<string, unknown>> {
  return contents.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}
