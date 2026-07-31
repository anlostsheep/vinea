import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { initializeWorkspace } from "../../src/core/config.js";
import { resolveVineaPaths, type VineaPaths } from "../../src/core/paths.js";
import {
  createTask,
  readTask,
  suggestRisk,
  transitionTask,
} from "../../src/core/workflow.js";
import type { TaskRecord } from "../../src/core/types.js";
import { createTempRepo, readJson, writeJson } from "../helpers/fixture.js";

const fixedNow = () => new Date("2026-07-31T08:09:10.000Z");

let cwd: string;
let paths: VineaPaths;

beforeEach(async () => {
  cwd = await createTempRepo();
  paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
});

test("suggestRisk gives high rules precedence and returns every matched reason", () => {
  expect(suggestRisk("Production migration", "Move the production data safely")).toEqual({
    level: "high",
    reasons: ["production", "migration", "data"],
  });
});

test("suggestRisk recognizes a cross-file behavior change as medium risk", () => {
  expect(suggestRisk("Small refactor", "Cross-file behavior change")).toEqual({
    level: "medium",
    reasons: ["behavior", "cross-file"],
  });
});

test("suggestRisk matches whole normalized keywords instead of substrings", () => {
  expect(suggestRisk("Metadata label", "Rename a metadata label")).toEqual({
    level: "low",
    reasons: [],
  });
});

test("createTask generates a deterministic ID and the complete initial artifact set", async () => {
  const created = await createTask(
    paths,
    {
      title: "Add safer deploy",
      risk: { level: "medium", reasons: ["deploy"] },
      qualityMode: "tdd",
      executionMode: "single-agent",
      confirmation: "user",
    },
    fixedNow,
  );

  expect(created.task).toEqual({
    schemaVersion: 1,
    id: "t-20260731-080910-add-safer-deploy",
    title: "Add safer deploy",
    status: "planning",
    risk: { level: "medium", reasons: ["deploy"] },
    qualityMode: "tdd",
    executionMode: "single-agent",
    requirements: [],
    acceptanceCriteria: [],
    commit: null,
    createdAt: "2026-07-31T08:09:10.000Z",
    updatedAt: "2026-07-31T08:09:10.000Z",
  });
  expect(created.directory).toBe(join(paths.activeTasks, created.task.id));
  expect((await readdir(created.directory)).sort()).toEqual([
    "brief.md",
    "check.md",
    "context.jsonl",
    "evidence.jsonl",
    "journal.md",
    "plan.md",
    "task.json",
  ]);
  expect(await readJson(join(created.directory, "task.json"))).toEqual(created.task);
  expect(await readFile(join(created.directory, "brief.md"), "utf8")).toBe("");
  expect(await readFile(join(created.directory, "plan.md"), "utf8")).toBe("");
  expect(await readFile(join(created.directory, "context.jsonl"), "utf8")).toBe("");
  expect(await readFile(join(created.directory, "evidence.jsonl"), "utf8")).toBe("");
  expect(await readFile(join(created.directory, "check.md"), "utf8")).toBe("");
  expect(parseJournal(await readFile(join(created.directory, "journal.md"), "utf8"))).toEqual([
    {
      schemaVersion: 1,
      type: "created",
      timestamp: "2026-07-31T08:09:10.000Z",
      actor: "cli",
      confirmation: "user",
      status: "planning",
    },
  ]);
});

test("createTask fails instead of overwriting a colliding deterministic ID", async () => {
  const input = {
    title: "Same title",
    risk: { level: "low" as const, reasons: [] },
    qualityMode: "standard" as const,
    executionMode: "single-agent" as const,
    confirmation: "user" as const,
  };
  await createTask(paths, input, fixedNow);

  await expect(createTask(paths, input, fixedNow)).rejects.toMatchObject({
    code: "VINEA_VALIDATION_INVALID",
  });
});

test("task lookup rejects an invalid task ID before resolving a filesystem path", async () => {
  await expect(readTask(paths, "../tasks")).rejects.toMatchObject({
    code: "VINEA_VALIDATION_INVALID",
    message: "Invalid task ID: ../tasks",
  });
});

test("ready transition requires meaningful brief and plan content plus a requirement or acceptance criterion", async () => {
  const { task, directory } = await createTask(
    paths,
    {
      title: "Guard readiness",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    fixedNow,
  );
  await writeFile(join(directory, "brief.md"), " \n", "utf8");
  await writeFile(join(directory, "plan.md"), "# Plan\n", "utf8");

  await expect(
    transitionTask(paths, task.id, "ready", {
      actor: "codex",
      reason: "Planning complete",
      now: () => new Date("2026-07-31T08:10:00.000Z"),
    }),
  ).rejects.toMatchObject({ code: "VINEA_TRANSITION_INVALID" });

  const stored = await readJson<TaskRecord>(join(directory, "task.json"));
  stored.requirements.push({
    schemaVersion: 1,
    id: "R1",
    text: "The workflow is guarded",
    createdAt: "2026-07-31T08:09:30.000Z",
  });
  await writeJson(join(directory, "task.json"), stored);
  await writeFile(join(directory, "brief.md"), "# Brief\n\nGuard the workflow.\n", "utf8");

  const ready = await transitionTask(paths, task.id, "ready", {
    actor: "codex",
    reason: "Planning complete",
    now: () => new Date("2026-07-31T08:10:00.000Z"),
  });

  expect(ready.status).toBe("ready");
});

test("invalid skipped transitions fail without changing task state", async () => {
  const { task } = await createReadyTask();

  await expect(
    transitionTask(paths, task.id, "checking", {
      actor: "codex",
      reason: "Skip implementation",
      now: fixedNow,
    }),
  ).rejects.toMatchObject({ code: "VINEA_TRANSITION_INVALID" });
  expect((await readTask(paths, task.id)).status).toBe("ready");
});

test("blocked tasks require explicit unblock and both transitions are auditable", async () => {
  const { task, directory } = await createReadyTask();
  await transitionTask(paths, task.id, "blocked", {
    actor: "codex",
    reason: "Waiting for access",
    now: () => new Date("2026-07-31T08:11:00.000Z"),
  });

  await expect(
    transitionTask(paths, task.id, "in_progress", {
      actor: "codex",
      reason: "Access arrived",
      now: () => new Date("2026-07-31T08:12:00.000Z"),
    }),
  ).rejects.toMatchObject({ code: "VINEA_TRANSITION_INVALID" });

  const unblocked = await transitionTask(paths, task.id, "in_progress", {
    actor: "codex",
    reason: "Access arrived",
    unblock: true,
    now: () => new Date("2026-07-31T08:12:00.000Z"),
  });

  expect(unblocked.status).toBe("in_progress");
  expect(parseJournal(await readFile(join(directory, "journal.md"), "utf8")).slice(-2)).toEqual([
    {
      schemaVersion: 1,
      type: "transition",
      timestamp: "2026-07-31T08:11:00.000Z",
      actor: "codex",
      reason: "Waiting for access",
      oldStatus: "ready",
      newStatus: "blocked",
    },
    {
      schemaVersion: 1,
      type: "transition",
      timestamp: "2026-07-31T08:12:00.000Z",
      actor: "codex",
      reason: "Access arrived",
      oldStatus: "blocked",
      newStatus: "in_progress",
    },
  ]);
});

async function createReadyTask() {
  const created = await createTask(
    paths,
    {
      title: "Lifecycle task",
      risk: { level: "medium", reasons: ["behavior"] },
      qualityMode: "tdd",
      executionMode: "single-agent",
      confirmation: "user",
    },
    fixedNow,
  );
  const task = await readJson<TaskRecord>(join(created.directory, "task.json"));
  task.requirements.push({
    schemaVersion: 1,
    id: "R1",
    text: "Follow the lifecycle",
    createdAt: "2026-07-31T08:09:30.000Z",
  });
  await writeJson(join(created.directory, "task.json"), task);
  await writeFile(join(created.directory, "brief.md"), "# Brief\n\nLifecycle.\n", "utf8");
  await writeFile(join(created.directory, "plan.md"), "# Plan\n\n1. Test.\n", "utf8");
  await transitionTask(paths, task.id, "ready", {
    actor: "codex",
    reason: "Planning complete",
    now: () => new Date("2026-07-31T08:10:00.000Z"),
  });
  return created;
}

function parseJournal(contents: string): unknown[] {
  return contents.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown);
}
