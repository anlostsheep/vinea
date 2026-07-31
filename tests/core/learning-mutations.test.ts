import { beforeEach, expect, test } from "vitest";
import { initializeWorkspace } from "../../src/core/config.js";
import { SchemaError } from "../../src/core/errors.js";
import { archiveLearning, proposeLearning } from "../../src/core/learning.js";
import { resolveVineaPaths, type VineaPaths } from "../../src/core/paths.js";
import { findTask, persistTaskMutation } from "../../src/core/task-store.js";
import { validateWorkspace } from "../../src/core/validate.js";
import { createTask } from "../../src/core/workflow.js";
import type { LearningCandidate, TaskRecord } from "../../src/core/types.js";
import { createTempRepo } from "../helpers/fixture.js";

let paths: VineaPaths;

beforeEach(async () => {
  paths = resolveVineaPaths(await createTempRepo());
  await initializeWorkspace(paths);
});

test("learning proposal retry reuses its pending mutation timestamp", async () => {
  const task = await createTaskRecord();
  const location = await findTask(paths, task.id);
  const firstTimestamp = "2026-07-31T08:11:00.000Z";
  const candidate: LearningCandidate = {
    schemaVersion: 1,
    id: "L1",
    domain: "testing-practice",
    text: "Reuse the proposal timestamp.",
    rationale: "A retry must preserve its original operation identity.",
    status: "proposed",
    proposedAt: firstTimestamp,
  };
  const target: TaskRecord = {
    ...location.task,
    learningCandidates: [candidate],
    updatedAt: firstTimestamp,
  };
  await expect(persistTaskMutation(paths, location, target, {
    schemaVersion: 1,
    type: "learning_proposed",
    timestamp: firstTimestamp,
    actor: "codex",
    learningCandidateId: "L1",
  }, {
    createOperationId: () => "op-learning-propose-retry",
    writeTask: async () => { throw new SchemaError("Injected task.json failure"); },
  })).rejects.toMatchObject({ code: "VINEA_SCHEMA_INVALID" });

  const recovered = await proposeLearning(paths, task.id, {
    id: "L1",
    domain: "testing-practice",
    text: "Reuse the proposal timestamp.",
    rationale: "A retry must preserve its original operation identity.",
    actor: "codex",
  }, () => new Date("2026-07-31T08:12:00.000Z"));

  expect(recovered.learningCandidates?.[0]).toMatchObject({ proposedAt: firstTimestamp });
  expect(recovered.updatedAt).toBe(firstTimestamp);
});

test("learning archive retry reuses its pending mutation timestamp", async () => {
  const task = await createTaskRecord();
  const proposed = await proposeLearning(paths, task.id, {
    id: "L1",
    domain: "testing-practice",
    text: "Archive using the initial timestamp.",
    rationale: "The rule is task-specific.",
    actor: "codex",
  }, () => new Date("2026-07-31T08:10:00.000Z"));
  const location = await findTask(paths, task.id);
  const firstTimestamp = "2026-07-31T08:11:00.000Z";
  const proposedCandidate = proposed.learningCandidates?.[0]!;
  const archived: LearningCandidate = {
    ...proposedCandidate,
    status: "archived",
    archivedAt: firstTimestamp,
    archiveReason: "Only relevant to this task",
  };
  const target: TaskRecord = {
    ...location.task,
    learningCandidates: [archived],
    updatedAt: firstTimestamp,
  };
  await expect(persistTaskMutation(paths, location, target, {
    schemaVersion: 1,
    type: "learning_archived",
    timestamp: firstTimestamp,
    actor: "codex",
    learningCandidateId: "L1",
  }, {
    createOperationId: () => "op-learning-archive-retry",
    writeTask: async () => { throw new SchemaError("Injected task.json failure"); },
  })).rejects.toMatchObject({ code: "VINEA_SCHEMA_INVALID" });

  const recovered = await archiveLearning(paths, task.id, {
    id: "L1",
    reason: "Only relevant to this task",
    actor: "codex",
  }, () => new Date("2026-07-31T08:12:00.000Z"));

  expect(recovered.learningCandidates?.[0]).toMatchObject({ archivedAt: firstTimestamp });
  expect(recovered.updatedAt).toBe(firstTimestamp);
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });
});

async function createTaskRecord(): Promise<TaskRecord> {
  return (await createTask(paths, {
    title: "Recover learning mutation",
    risk: { level: "low", reasons: [] },
    qualityMode: "standard",
    executionMode: "single-agent",
    confirmation: "user",
  }, () => new Date("2026-07-31T08:09:10.000Z"))).task;
}
