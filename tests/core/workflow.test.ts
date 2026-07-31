import { access, chmod, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { initializeWorkspace } from "../../src/core/config.js";
import { recordEvidence } from "../../src/core/evidence.js";
import { SchemaError } from "../../src/core/errors.js";
import { appendJsonl } from "../../src/core/json.js";
import { resolveVineaPaths, type VineaPaths } from "../../src/core/paths.js";
import {
  appendTaskContinuation,
  findTask,
  mutationFingerprint,
  persistTaskMutation,
  persistTaskTransition,
} from "../../src/core/task-store.js";
import { validateWorkspace } from "../../src/core/validate.js";
import {
  createTask,
  addRequirement,
  readTask,
  setTaskBrief,
  setTaskPlan,
  suggestRisk,
  transitionTask,
} from "../../src/core/workflow.js";
import type { TaskRecord } from "../../src/core/types.js";
import { createTempRepo, readJson, writeJson } from "../helpers/fixture.js";

const mutationCompletionFailure = vi.hoisted(() => ({ type: null as string | null }));

vi.mock("../../src/core/json.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/json.js")>();
  return {
    ...actual,
    appendJsonl: async (...args: Parameters<typeof actual.appendJsonl>) => {
      const value = args[1] as Record<string, unknown>;
      if (mutationCompletionFailure.type === value.type) {
        mutationCompletionFailure.type = null;
        throw new Error(`Injected ${String(value.type)} completion failure`);
      }
      return actual.appendJsonl(...args);
    },
  };
});

const fixedNow = () => new Date("2026-07-31T08:09:10.000Z");

let cwd: string;
let paths: VineaPaths;

beforeEach(async () => {
  mutationCompletionFailure.type = null;
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

test("createTask rejects an archived ID collision without creating active artifacts", async () => {
  const taskId = "t-20260731-080910-archived-collision";
  await mkdir(join(paths.archivedTasks, taskId));

  await expect(
    createTask(
      paths,
      {
        title: "Archived collision",
        risk: { level: "low", reasons: [] },
        qualityMode: "standard",
        executionMode: "single-agent",
        confirmation: "user",
      },
      fixedNow,
    ),
  ).rejects.toMatchObject({ code: "VINEA_VALIDATION_INVALID" });
  await expect(access(join(paths.activeTasks, taskId))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(join(paths.archivedTasks, taskId))).toEqual([]);
});

test("task lookup rejects an invalid task ID before resolving a filesystem path", async () => {
  await expect(readTask(paths, "../tasks")).rejects.toMatchObject({
    code: "VINEA_VALIDATION_INVALID",
    message: "Invalid task ID: ../tasks",
  });
});

test("task brief and plan sources must be safe repository-relative regular files", async () => {
  const created = await createTask(
    paths,
    {
      title: "Constrain task document sources",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    fixedNow,
  );
  const sources = join(cwd, "task-sources");
  await mkdir(sources);
  await writeFile(join(sources, "brief.md"), "# Brief\n\nUse a safe source.\n", "utf8");
  await writeFile(join(sources, "plan.md"), "# Plan\n\n1. Use a safe source.\n", "utf8");

  await expect(setTaskBrief(paths, created.task.id, "task-sources/brief.md", "codex", fixedNow)).resolves.toMatchObject({
    artifact: "brief.md",
  });
  await expect(setTaskPlan(paths, created.task.id, "task-sources/plan.md", "codex", fixedNow)).resolves.toMatchObject({
    artifact: "plan.md",
  });
  const persistedBrief = await readFile(join(created.directory, "brief.md"), "utf8");
  const persistedPlan = await readFile(join(created.directory, "plan.md"), "utf8");

  const outsideDirectory = join(cwd, "outside-documents");
  await mkdir(outsideDirectory);
  await writeFile(join(outsideDirectory, "brief.md"), "outside", "utf8");
  await symlink(outsideDirectory, join(cwd, "linked-documents"));
  await symlink(join(sources, "brief.md"), join(cwd, "linked-brief.md"));
  await expect(setTaskBrief(paths, created.task.id, join(sources, "brief.md"), "codex", fixedNow)).rejects.toMatchObject({
    code: "VINEA_VALIDATION_INVALID",
    message: expect.stringContaining("repository-relative"),
  });
  await expect(setTaskBrief(paths, created.task.id, "../outside-brief.md", "codex", fixedNow)).rejects.toMatchObject({
    code: "VINEA_VALIDATION_INVALID",
    message: expect.stringContaining("parent traversal"),
  });
  await expect(setTaskBrief(paths, created.task.id, "linked-documents/brief.md", "codex", fixedNow)).rejects.toMatchObject({
    code: "VINEA_VALIDATION_INVALID",
    message: expect.stringContaining("symbolic links"),
  });
  await expect(setTaskBrief(paths, created.task.id, "linked-brief.md", "codex", fixedNow)).rejects.toMatchObject({
    code: "VINEA_VALIDATION_INVALID",
    message: expect.stringContaining("symbolic links"),
  });
  expect(await readFile(join(created.directory, "brief.md"), "utf8")).toBe(persistedBrief);
  expect(await readFile(join(created.directory, "plan.md"), "utf8")).toBe(persistedPlan);
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

test("ready transition rejects blank or structurally malformed requirement entries", async () => {
  const { task, directory } = await createTask(
    paths,
    {
      title: "Validate requirement structure",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    fixedNow,
  );
  await writeFile(join(directory, "brief.md"), "# Brief\n\nValidate requirements.\n", "utf8");
  await writeFile(join(directory, "plan.md"), "# Plan\n\n1. Validate.\n", "utf8");
  const stored = await readJson<TaskRecord>(join(directory, "task.json"));
  stored.requirements = [
    {
      schemaVersion: 1,
      id: " ",
      text: "Has no ID",
      createdAt: "2026-07-31T08:09:30.000Z",
    },
    { broken: true } as unknown as TaskRecord["requirements"][number],
  ];
  stored.acceptanceCriteria = [
    {
      schemaVersion: 1,
      id: "A1",
      text: " ",
      createdAt: "2026-07-31T08:09:30.000Z",
    },
  ];
  await writeJson(join(directory, "task.json"), stored);

  await expect(
    transitionTask(paths, task.id, "ready", {
      actor: "codex",
      reason: "Malformed entries should not satisfy ready",
      now: () => new Date("2026-07-31T08:10:00.000Z"),
    }),
  ).rejects.toMatchObject({
    code: "VINEA_TRANSITION_INVALID",
    message: expect.stringContaining("valid requirement or acceptance criterion"),
  });
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

test("journal append failure restores the prior task state and updatedAt", async () => {
  const { task, directory } = await createReadyTask();
  const before = await readJson<TaskRecord>(join(directory, "task.json"));
  const journalPath = join(directory, "journal.md");
  const beforeJournal = await readFile(journalPath, "utf8");
  await chmod(journalPath, 0o444);

  await expect(
    transitionTask(paths, task.id, "in_progress", {
      actor: "codex",
      reason: "This journal append will fail",
      now: () => new Date("2026-07-31T08:11:00.000Z"),
    }),
  ).rejects.toMatchObject({ code: "VINEA_SCHEMA_INVALID" });

  expect(await readJson<TaskRecord>(join(directory, "task.json"))).toEqual(before);
  expect(await readFile(journalPath, "utf8")).toBe(beforeJournal);
});

test("archive move failure leaves the task active with a pending audit intent", async () => {
  const { task, directory } = await createFinishedTask();
  const taskPath = join(directory, "task.json");
  const journalPath = join(directory, "journal.md");
  const beforeTask = await readJson<TaskRecord>(taskPath);
  const beforeJournal = await readFile(journalPath, "utf8");
  const archiveCollision = join(paths.archivedTasks, task.id);
  await writeFile(archiveCollision, "occupied\n", "utf8");

  await expect(
    transitionTask(paths, task.id, "archived", {
      actor: "codex",
      reason: "Archive task",
      now: () => new Date("2026-07-31T08:14:00.000Z"),
    }),
  ).rejects.toMatchObject({ code: "VINEA_SCHEMA_INVALID" });

  expect(await readJson<TaskRecord>(taskPath)).toEqual(beforeTask);
  const afterJournal = await readFile(journalPath, "utf8");
  expect(afterJournal.startsWith(beforeJournal)).toBe(true);
  expect((parseJournal(afterJournal).at(-1) as Record<string, unknown>)).toMatchObject({
    type: "transition_intent",
    oldStatus: "finished",
    newStatus: "archived",
    actor: "codex",
    reason: "Archive task",
  });
  expect(await readFile(archiveCollision, "utf8")).toBe("occupied\n");
  await expect(access(directory)).resolves.toBeUndefined();
});

test("late archive commit failure leaves only an intent and is recoverable by retry", async () => {
  const { task, directory } = await createFinishedTask();
  const location = await findTask(paths, task.id);
  const archivedTask: TaskRecord = {
    ...location.task,
    status: "archived",
    updatedAt: "2026-07-31T08:14:00.000Z",
  };

  await expect(
    persistTaskTransition(
      paths,
      location,
      archivedTask,
      {
        schemaVersion: 1,
        timestamp: "2026-07-31T08:14:00.000Z",
        actor: "codex",
        reason: "Archive task",
        oldStatus: "finished",
        newStatus: "archived",
      },
      {
        createOperationId: () => "op-injected-archive",
        writeTask: async () => {
          throw new SchemaError("Injected task commit failure");
        },
      },
    ),
  ).rejects.toMatchObject({
    code: "VINEA_SCHEMA_INVALID",
    message: expect.stringContaining("transition intent remains pending for retry"),
  });

  const archivedDirectory = join(paths.archivedTasks, task.id);
  await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await readJson<TaskRecord>(join(archivedDirectory, "task.json"))).status).toBe("finished");
  const failedJournal = parseJournal(await readFile(join(archivedDirectory, "journal.md"), "utf8")) as Array<
    Record<string, unknown>
  >;
  expect(failedJournal.at(-1)).toMatchObject({
    type: "transition_intent",
    operationId: "op-injected-archive",
    oldStatus: "finished",
    newStatus: "archived",
  });
  expect(failedJournal.some((event) => event.type === "transition")).toBe(false);

  const recovered = await transitionTask(paths, task.id, "archived", {
    actor: "codex",
    reason: "Retry archive task",
    now: () => new Date("2026-07-31T08:15:00.000Z"),
  });
  expect(recovered.status).toBe("archived");
  expect((await readJson<TaskRecord>(join(archivedDirectory, "task.json"))).status).toBe("archived");
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });
});

test("archive validation maps only this task's historical active artifacts", async () => {
  const { task } = await createFinishedTask();
  await transitionTask(paths, task.id, "archived", {
    actor: "codex",
    reason: "Archive validated mutation history",
    now: () => new Date("2026-07-31T08:14:00.000Z"),
  });
  const archivedJournal = join(paths.archivedTasks, task.id, "journal.md");
  const events = parseJournal(await readFile(archivedJournal, "utf8")) as Array<Record<string, unknown>>;
  const intent = events.find((event) => event.type === "mutation_intent" && event.mutationKind === "evidence_recorded")!;
  const expected = intent.expected as { files: Array<{ path: string; sha256: string }> };
  const originalPath = expected.files[0]!.path;

  expected.files[0]!.path = ".vinea/tasks/active/t-20260731-080910-foreign-task/evidence.jsonl";
  await writeFile(archivedJournal, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  expect(await validateWorkspace(paths)).toMatchObject({
    issues: [expect.objectContaining({ code: "MUTATION_TARGET_MISMATCH" })],
  });

  expected.files[0]!.path = `.vinea/tasks/active/${task.id}/journal.md`;
  await writeFile(archivedJournal, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  expect(await validateWorkspace(paths)).toMatchObject({
    issues: [expect.objectContaining({ code: "MUTATION_TARGET_MISMATCH" })],
  });

  expected.files[0]!.path = originalPath;
});

test("a failed active task commit reuses its pending intent on retry and validates cleanly", async () => {
  const { task, directory } = await createReadyTask();
  const location = await findTask(paths, task.id);
  const inProgress: TaskRecord = {
    ...location.task,
    status: "in_progress",
    updatedAt: "2026-07-31T08:11:00.000Z",
  };

  await expect(
    persistTaskTransition(
      paths,
      location,
      inProgress,
      {
        schemaVersion: 1,
        timestamp: "2026-07-31T08:11:00.000Z",
        actor: "codex",
        reason: "Start work",
        oldStatus: "ready",
        newStatus: "in_progress",
      },
      {
        createOperationId: () => "op-injected-active",
        writeTask: async () => {
          throw new SchemaError("Injected task commit failure");
        },
      },
    ),
  ).rejects.toMatchObject({ code: "VINEA_SCHEMA_INVALID" });

  const retried = await transitionTask(paths, task.id, "in_progress", {
    actor: "codex",
    reason: "Retry start work",
    now: () => new Date("2026-07-31T08:12:00.000Z"),
  });
  expect(retried.status).toBe("in_progress");
  const intents = (parseJournal(await readFile(join(directory, "journal.md"), "utf8")) as Array<Record<string, unknown>>)
    .filter((event) => event.type === "transition_intent" && event.oldStatus === "ready");
  expect(intents).toHaveLength(1);
  expect(intents[0]).toMatchObject({ operationId: "op-injected-active", newStatus: "in_progress" });
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });
});

test("task mutation serialization prevents an interleaved pending transition from duplicating its intent", async () => {
  const { task } = await createReadyTask();
  const location = await findTask(paths, task.id);
  const mutationAppendStarted = deferred<void>();
  const releaseMutationAppend = deferred<void>();
  const mutationTask: TaskRecord = {
    ...location.task,
    requirements: [...location.task.requirements, {
      schemaVersion: 1,
      id: "R2",
      text: "Serialized mutation",
      createdAt: "2026-07-31T08:11:00.000Z",
    }],
    updatedAt: "2026-07-31T08:11:00.000Z",
  };
  const mutation = persistTaskMutation(
    paths,
    location,
    mutationTask,
    {
      schemaVersion: 1,
      type: "requirement_added",
      timestamp: "2026-07-31T08:11:00.000Z",
      actor: "codex",
      requirementId: "R2",
    },
    {
      appendJournal: async (filename, value, repoRoot) => {
        mutationAppendStarted.resolve();
        await releaseMutationAppend.promise;
        await appendJsonl(filename, value, repoRoot);
      },
    },
  );
  await mutationAppendStarted.promise;

  const transition = persistTaskTransition(
    paths,
    location,
    { ...location.task, status: "in_progress", updatedAt: "2026-07-31T08:12:00.000Z" },
    {
      schemaVersion: 1,
      timestamp: "2026-07-31T08:12:00.000Z",
      actor: "codex",
      reason: "Concurrent transition",
      oldStatus: "ready",
      newStatus: "in_progress",
    },
    { writeTask: async () => { throw new SchemaError("Injected transition commit failure"); } },
  );
  releaseMutationAppend.resolve();
  await mutation;
  await expect(transition).rejects.toMatchObject({ code: "VINEA_SCHEMA_INVALID" });

  const retried = await transitionTask(paths, task.id, "in_progress", {
    actor: "codex",
    reason: "Retry concurrent transition",
    now: () => new Date("2026-07-31T08:13:00.000Z"),
  });
  expect(retried.status).toBe("in_progress");
  const intents = (parseJournal(await readFile(join(location.directory, "journal.md"), "utf8")) as Array<Record<string, unknown>>)
    .filter((event) => event.type === "transition_intent" && event.oldStatus === "ready");
  expect(intents).toHaveLength(1);
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });
});

test("a failed task.json mutation keeps one recoverable intent and blocks unrelated journal writes", async () => {
  const { task, directory } = await createReadyTask();
  const location = await findTask(paths, task.id);
  const timestamp = "2026-07-31T08:11:00.000Z";
  const mutated: TaskRecord = {
    ...location.task,
    requirements: [...location.task.requirements, {
      schemaVersion: 1,
      id: "R2",
      text: "Recover this requirement",
      createdAt: timestamp,
    }],
    updatedAt: timestamp,
  };
  const event = {
    schemaVersion: 1 as const,
    type: "requirement_added" as const,
    timestamp,
    actor: "codex",
    requirementId: "R2",
  };

  await expect(persistTaskMutation(paths, location, mutated, event, {
    createOperationId: () => "op-task-json-retry",
    writeTask: async () => {
      throw new SchemaError("Injected task.json failure");
    },
  })).rejects.toMatchObject({
    code: "VINEA_SCHEMA_INVALID",
    message: expect.stringContaining("journal intent remains pending for retry"),
  });
  const journalWithPendingIntent = await readFile(join(directory, "journal.md"), "utf8");

  await expect(persistTaskMutation(paths, location, {
    ...location.task,
    requirements: [...location.task.requirements, {
      schemaVersion: 1,
      id: "R3",
      text: "A different mutation must wait",
      createdAt: "2026-07-31T08:12:00.000Z",
    }],
    updatedAt: "2026-07-31T08:12:00.000Z",
  }, {
    schemaVersion: 1,
    type: "requirement_added",
    timestamp: "2026-07-31T08:12:00.000Z",
    actor: "codex",
    requirementId: "R3",
  })).rejects.toMatchObject({ code: "VINEA_TRANSITION_INVALID" });

  await expect(persistTaskTransition(
    paths,
    location,
    { ...location.task, status: "in_progress", updatedAt: "2026-07-31T08:12:00.000Z" },
    {
      schemaVersion: 1,
      timestamp: "2026-07-31T08:12:00.000Z",
      actor: "codex",
      reason: "Must not bypass mutation recovery",
      oldStatus: "ready",
      newStatus: "in_progress",
    },
  )).rejects.toMatchObject({ code: "VINEA_TRANSITION_INVALID" });
  await expect(appendTaskContinuation(paths, location, {
    schemaVersion: 1,
    type: "continued",
    timestamp: "2026-07-31T08:12:00.000Z",
    actor: "codex",
    confirmation: "user",
    host: "codex",
    sessionBound: false,
    started: false,
    status: "ready",
  })).rejects.toMatchObject({ code: "VINEA_TRANSITION_INVALID" });
  expect(await readFile(join(directory, "journal.md"), "utf8")).toBe(journalWithPendingIntent);

  const recovered = await persistTaskMutation(paths, location, mutated, event);
  expect(recovered.task.requirements.map(({ id }) => id)).toContain("R2");
  const journal = parseJournal(await readFile(join(directory, "journal.md"), "utf8")) as Array<Record<string, unknown>>;
  expect(journal.filter((entry) => entry.type === "mutation_intent")).toHaveLength(1);
  expect(journal.filter((entry) => entry.operationId === "op-task-json-retry")).toHaveLength(2);
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });
});

test("requirement retry reuses the pending mutation timestamp after an interrupted task.json write", async () => {
  const { task } = await createReadyTask();
  const location = await findTask(paths, task.id);
  const firstTimestamp = "2026-07-31T08:11:00.000Z";
  const target: TaskRecord = {
    ...location.task,
    requirements: [...location.task.requirements, {
      schemaVersion: 1,
      id: "R2",
      text: "Reuse the original timestamp",
      createdAt: firstTimestamp,
    }],
    updatedAt: firstTimestamp,
  };
  const event = {
    schemaVersion: 1 as const,
    type: "requirement_added" as const,
    timestamp: firstTimestamp,
    actor: "codex",
    requirementId: "R2",
  };
  await expect(persistTaskMutation(paths, location, target, event, {
    createOperationId: () => "op-requirement-retry",
    writeTask: async () => { throw new SchemaError("Injected task.json failure"); },
  })).rejects.toMatchObject({ code: "VINEA_SCHEMA_INVALID" });

  const recovered = await addRequirement(paths, task.id, {
    id: "R2",
    text: "Reuse the original timestamp",
    actor: "codex",
  }, () => new Date("2026-07-31T08:12:00.000Z"));

  expect(recovered.requirements.find(({ id }) => id === "R2")).toMatchObject({ createdAt: firstTimestamp });
  expect(recovered.updatedAt).toBe(firstTimestamp);
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });
});

test("requirement retry binds its normalized text before appending a delayed completion", async () => {
  const { task, directory } = await createReadyTask();
  const exact = {
    id: " R2 ",
    text: "  Preserve the original requirement text.  ",
    actor: " codex ",
  };
  const firstTimestamp = "2026-07-31T08:11:00.000Z";
  mutationCompletionFailure.type = "requirement_added";

  await expect(addRequirement(paths, task.id, exact, () => new Date(firstTimestamp)))
    .rejects.toThrow("Injected requirement_added completion failure");
  expect((await readTask(paths, task.id)).requirements.find(({ id }) => id === "R2")).toMatchObject({
    text: "Preserve the original requirement text.",
    createdAt: firstTimestamp,
  });
  expect((await validateWorkspace(paths)).issues.map(({ code }) => code)).toContain("MUTATION_INTENT_UNCOMMITTED");
  const journalWithPendingIntent = await readFile(join(directory, "journal.md"), "utf8");
  expect(journalWithPendingIntent).not.toContain("Preserve the original requirement text.");

  await expect(addRequirement(paths, task.id, {
    id: "R2",
    text: "Different text must not resume the pending request.",
    actor: "codex",
  }, () => new Date("2026-07-31T08:12:00.000Z"))).rejects.toMatchObject({ code: "VINEA_TRANSITION_INVALID" });
  expect(await readFile(join(directory, "journal.md"), "utf8")).toBe(journalWithPendingIntent);

  const recovered = await addRequirement(paths, task.id, exact, () => new Date("2026-07-31T08:13:00.000Z"));
  expect(recovered.updatedAt).toBe(firstTimestamp);
  const journal = parseJournal(await readFile(join(directory, "journal.md"), "utf8")) as Array<Record<string, unknown>>;
  const intent = journal.find((entry) => entry.type === "mutation_intent" && entry.mutationKind === "requirement_added")!;
  const completion = journal.find((entry) => entry.type === "requirement_added" && entry.requirementId === "R2")!;
  expect(completion.operationId).toBe(intent.operationId);
  expect(completion.timestamp).toBe(firstTimestamp);
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });
});

test("task mutation recovery rejects a forged pending intent outside managed targets", async () => {
  const { task, directory } = await createReadyTask();
  const location = await findTask(paths, task.id);
  const timestamp = "2026-07-31T08:11:00.000Z";
  const target: TaskRecord = {
    ...location.task,
    requirements: [...location.task.requirements, {
      schemaVersion: 1,
      id: "R2",
      text: "Reject forged journal targets",
      createdAt: timestamp,
    }],
    updatedAt: timestamp,
  };
  const event = {
    schemaVersion: 1 as const,
    type: "requirement_added" as const,
    timestamp,
    actor: "codex",
    requirementId: "R2",
  };
  const unmanagedTarget = join(paths.repoRoot, "README.md");
  await writeFile(unmanagedTarget, "outside managed task targets\n", "utf8");
  const completion = { ...event, mutationKind: "requirement_added" as const };
  await appendJsonl(join(directory, "journal.md"), {
    schemaVersion: 1,
    type: "mutation_intent",
    operationId: "op-forged-target",
    timestamp,
    actor: "codex",
    mutationKind: "requirement_added",
    fingerprint: mutationFingerprint({
      schemaVersion: 1,
      type: "requirement_added",
      actor: "codex",
      requirementId: "R2",
      text: "Reject forged journal targets",
    }),
    expected: {
      identity: { requirementId: "R2", valueSha256: "a".repeat(64) },
      files: [{
        path: "README.md",
        sha256: createHash("sha256").update(await readFile(unmanagedTarget)).digest("hex"),
      }],
    },
    completion,
  }, paths.repoRoot);

  await expect(persistTaskMutation(paths, location, target, event)).rejects.toMatchObject({
    code: "VINEA_SCHEMA_INVALID",
    message: expect.stringContaining("exact managed ownership"),
  });
});

test("task mutation writes an intent before its target and completes it with one operation ID", async () => {
  const { task, directory } = await createReadyTask();
  const location = await findTask(paths, task.id);
  const timestamp = "2026-07-31T08:12:30.000Z";
  const changed: TaskRecord = {
    ...location.task,
    requirements: [...location.task.requirements, {
      schemaVersion: 1,
      id: "R2",
      text: "A durable mutation is traceable.",
      createdAt: timestamp,
    }],
    updatedAt: timestamp,
  };

  await persistTaskMutation(
    paths,
    location,
    changed,
    {
      schemaVersion: 1,
      type: "requirement_added",
      timestamp,
      actor: "codex",
      requirementId: "R2",
    },
    { createOperationId: () => "op-mutation-intent" },
  );

  const events = parseJournal(await readFile(join(directory, "journal.md"), "utf8")) as Array<Record<string, unknown>>;
  const intent = events.at(-2)!;
  const completion = events.at(-1)!;
  expect(intent).toMatchObject({
    type: "mutation_intent",
    operationId: "op-mutation-intent",
    mutationKind: "requirement_added",
    fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    expected: {
      identity: { requirementId: "R2" },
      files: [{ path: `.vinea/tasks/active/${task.id}/task.json`, sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) }],
    },
  });
  expect(completion).toMatchObject({
    type: "requirement_added",
    operationId: "op-mutation-intent",
    mutationKind: "requirement_added",
    requirementId: "R2",
    timestamp,
  });
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });
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
  expect(parseJournal(await readFile(join(directory, "journal.md"), "utf8")).slice(-2)).toMatchObject([
    {
      schemaVersion: 1,
      type: "transition_intent",
      timestamp: "2026-07-31T08:11:00.000Z",
      actor: "codex",
      reason: "Waiting for access",
      oldStatus: "ready",
      newStatus: "blocked",
    },
    {
      schemaVersion: 1,
      type: "transition_intent",
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

async function createFinishedTask() {
  const created = await createReadyTask();
  await transitionTask(paths, created.task.id, "in_progress", {
    actor: "codex",
    reason: "Start work",
    now: () => new Date("2026-07-31T08:11:00.000Z"),
  });
  await recordEvidence(paths, created.task.id, {
    kind: "tdd-red",
    summary: "Lifecycle test failed before implementation",
    command: "npm test -- lifecycle",
    exitCode: 1,
    result: "fail",
    actor: "codex",
  }, () => new Date("2026-07-31T08:11:20.000Z"));
  await recordEvidence(paths, created.task.id, {
    kind: "tdd-green",
    summary: "Lifecycle test passed after implementation",
    command: "npm test -- lifecycle",
    exitCode: 0,
    result: "pass",
    actor: "codex",
  }, () => new Date("2026-07-31T08:11:40.000Z"));
  await transitionTask(paths, created.task.id, "checking", {
    actor: "codex",
    reason: "Check work",
    now: () => new Date("2026-07-31T08:12:00.000Z"),
  });
  await transitionTask(paths, created.task.id, "finished", {
    actor: "codex",
    reason: "Finish work",
    now: () => new Date("2026-07-31T08:13:00.000Z"),
  });
  return created;
}

function parseJournal(contents: string): unknown[] {
  return contents.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((resolve_) => { resolve = resolve_; }),
    resolve,
  };
}
