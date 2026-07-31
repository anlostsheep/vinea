import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import { initializeWorkspace } from "../../src/core/config.js";
import { SchemaError } from "../../src/core/errors.js";
import { resolveVineaPaths } from "../../src/core/paths.js";
import { findTask, persistTaskTransition } from "../../src/core/task-store.js";
import { createTask, transitionTask } from "../../src/core/workflow.js";
import type { TaskRecord } from "../../src/core/types.js";
import { createTempRepo, readJson, writeJson, runCli } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("CLI retries pending active and archive transition intents without duplicating them", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);

  const active = await createPreparedTask(paths, "Active retry", "standard");
  const activeLocation = await findTask(paths, active.id);
  const inProgress: TaskRecord = {
    ...activeLocation.task,
    status: "in_progress",
    updatedAt: "2026-07-31T08:12:00.000Z",
  };
  await expect(persistTaskTransition(
    paths,
    activeLocation,
    inProgress,
    transition("ready", "in_progress", "2026-07-31T08:12:00.000Z"),
    { writeTask: async () => { throw new SchemaError("Injected active task.json failure"); } },
  )).rejects.toMatchObject({ code: "VINEA_SCHEMA_INVALID" });

  const activeRetry = await runCli([
    "task", "transition", active.id,
    "--to", "in_progress",
    "--reason", "Retry active transition",
    "--json",
  ], cwd);
  expect(activeRetry.exitCode).toBe(0);
  expect(JSON.parse(activeRetry.stdout)).toMatchObject({ status: "in_progress" });
  expect(transitionIntentCount(await readFile(join(activeLocation.directory, "journal.md"), "utf8"), "ready")).toBe(1);

  const archived = await createPreparedTask(paths, "Archive retry", "standard");
  await transitionTask(paths, archived.id, "in_progress", { actor: "codex", reason: "Start", now: () => new Date("2026-07-31T08:13:00.000Z") });
  await transitionTask(paths, archived.id, "checking", { actor: "codex", reason: "Check", now: () => new Date("2026-07-31T08:14:00.000Z") });
  await transitionTask(paths, archived.id, "finished", { actor: "codex", reason: "Finish", now: () => new Date("2026-07-31T08:15:00.000Z") });
  const archiveLocation = await findTask(paths, archived.id);
  const archivedTask: TaskRecord = {
    ...archiveLocation.task,
    status: "archived",
    updatedAt: "2026-07-31T08:16:00.000Z",
  };
  await expect(persistTaskTransition(
    paths,
    archiveLocation,
    archivedTask,
    transition("finished", "archived", "2026-07-31T08:16:00.000Z"),
    { writeTask: async () => { throw new SchemaError("Injected archive task.json failure"); } },
  )).rejects.toMatchObject({ code: "VINEA_SCHEMA_INVALID" });

  const archiveRetry = await runCli(["archive", archived.id, "--confirmed", "--json"], cwd);
  expect(archiveRetry.exitCode).toBe(0);
  expect(JSON.parse(archiveRetry.stdout)).toMatchObject({ status: "archived" });
  const archiveDirectory = join(paths.archivedTasks, archived.id);
  expect(transitionIntentCount(await readFile(join(archiveDirectory, "journal.md"), "utf8"), "finished")).toBe(1);

  const moveFailure = await createFinishedTask(paths, "Archive move retry");
  const moveLocation = await findTask(paths, moveFailure.id);
  const occupiedArchivePath = join(paths.archivedTasks, moveFailure.id);
  await writeFile(occupiedArchivePath, "occupied\n", "utf8");
  await expect(persistTaskTransition(
    paths,
    moveLocation,
    { ...moveLocation.task, status: "archived", updatedAt: "2026-07-31T08:20:00.000Z" },
    transition("finished", "archived", "2026-07-31T08:20:00.000Z"),
  )).rejects.toMatchObject({ code: "VINEA_SCHEMA_INVALID" });
  await rm(occupiedArchivePath);
  const moveRetry = await runCli(["archive", moveFailure.id, "--confirmed", "--json"], cwd);
  expect(moveRetry.exitCode).toBe(0);
  expect(JSON.parse(moveRetry.stdout)).toMatchObject({ status: "archived" });
  expect(transitionIntentCount(await readFile(join(paths.archivedTasks, moveFailure.id, "journal.md"), "utf8"), "finished")).toBe(1);

  const validation = await runCli(["validate", "--json"], cwd);
  expect(validation.exitCode).toBe(0);
  expect(JSON.parse(validation.stdout)).toEqual({ issues: [] });
});

async function createPreparedTask(
  paths: ReturnType<typeof resolveVineaPaths>,
  title: string,
  qualityMode: "standard" | "tdd",
): Promise<TaskRecord> {
  const created = await createTask(paths, {
    title,
    risk: { level: "low", reasons: [] },
    qualityMode,
    executionMode: "single-agent",
    confirmation: "user",
  }, () => new Date("2026-07-31T08:09:10.000Z"));
  const taskPath = join(created.directory, "task.json");
  const task = await readJson<TaskRecord>(taskPath);
  await writeJson(taskPath, {
    ...task,
    requirements: [{
      schemaVersion: 1,
      id: "R1",
      text: "Retry transitions safely",
      createdAt: "2026-07-31T08:09:10.000Z",
    }],
  });
  await writeFile(join(created.directory, "brief.md"), "# Brief\n\nRetry safely.\n", "utf8");
  await writeFile(join(created.directory, "plan.md"), "# Plan\n\n1. Retry.\n", "utf8");
  await transitionTask(paths, created.task.id, "ready", {
    actor: "codex",
    reason: "Prepared",
    now: () => new Date("2026-07-31T08:10:00.000Z"),
  });
  return readJson<TaskRecord>(taskPath);
}

async function createFinishedTask(
  paths: ReturnType<typeof resolveVineaPaths>,
  title: string,
): Promise<TaskRecord> {
  const task = await createPreparedTask(paths, title, "standard");
  await transitionTask(paths, task.id, "in_progress", { actor: "codex", reason: "Start", now: () => new Date("2026-07-31T08:17:00.000Z") });
  await transitionTask(paths, task.id, "checking", { actor: "codex", reason: "Check", now: () => new Date("2026-07-31T08:18:00.000Z") });
  await transitionTask(paths, task.id, "finished", { actor: "codex", reason: "Finish", now: () => new Date("2026-07-31T08:19:00.000Z") });
  return readJson<TaskRecord>(join(paths.activeTasks, task.id, "task.json"));
}

function transition(
  oldStatus: TaskRecord["status"],
  newStatus: TaskRecord["status"],
  timestamp: string,
) {
  return {
    schemaVersion: 1 as const,
    timestamp,
    actor: "codex",
    reason: "Injected failure",
    oldStatus,
    newStatus,
  };
}

function transitionIntentCount(contents: string, oldStatus: string): number {
  return contents.split("\n").filter(Boolean).filter((line) => {
    const event = JSON.parse(line) as Record<string, unknown>;
    return event.type === "transition_intent" && event.oldStatus === oldStatus;
  }).length;
}
