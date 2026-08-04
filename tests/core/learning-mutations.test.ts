import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { initializeWorkspace } from "../../src/core/config.js";
import { SchemaError } from "../../src/core/errors.js";
import { archiveLearning, proposeLearning } from "../../src/core/learning.js";
import { resolveVineaPaths, type VineaPaths } from "../../src/core/paths.js";
import { findTask, persistTaskMutation } from "../../src/core/task-store.js";
import { validateWorkspace } from "../../src/core/validate.js";
import { createTask } from "../../src/core/workflow.js";
import { SCHEMA_VERSION, type LearningCandidate, type TaskRecord } from "../../src/core/types.js";
import { createTempRepo } from "../helpers/fixture.js";

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

let paths: VineaPaths;

beforeEach(async () => {
  mutationCompletionFailure.type = null;
  paths = resolveVineaPaths(await createTempRepo());
  await initializeWorkspace(paths);
});

test("learning proposal retry reuses its pending mutation timestamp", async () => {
  const task = await createTaskRecord();
  const location = await findTask(paths, task.id);
  const firstTimestamp = "2026-07-31T08:11:00.000Z";
  const candidate: LearningCandidate = {
    schemaVersion: SCHEMA_VERSION,
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
    schemaVersion: SCHEMA_VERSION,
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
    schemaVersion: SCHEMA_VERSION,
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

test("learning proposal retry binds normalized domain, text, and rationale before delayed completion", async () => {
  const task = await createTaskRecord();
  const exact = {
    id: " L1 ",
    domain: "testing-practice",
    text: "  Preserve proposal content.  ",
    rationale: "  Reuse only the exact normalized proposal request.  ",
    actor: " codex ",
  };
  const firstTimestamp = "2026-07-31T08:11:00.000Z";
  mutationCompletionFailure.type = "learning_proposed";

  await expect(proposeLearning(paths, task.id, exact, () => new Date(firstTimestamp)))
    .rejects.toThrow("Injected learning_proposed completion failure");
  const location = await findTask(paths, task.id);
  expect(location.task.learningCandidates?.[0]).toMatchObject({
    domain: "testing-practice",
    text: "Preserve proposal content.",
    rationale: "Reuse only the exact normalized proposal request.",
    proposedAt: firstTimestamp,
  });
  expect((await validateWorkspace(paths)).issues.map(({ code }) => code)).toContain("MUTATION_INTENT_UNCOMMITTED");
  const journalPath = join(location.directory, "journal.md");
  const journalWithPendingIntent = await readFile(journalPath, "utf8");
  expect(journalWithPendingIntent).not.toContain("Preserve proposal content.");
  expect(journalWithPendingIntent).not.toContain("Reuse only the exact normalized proposal request.");

  for (const changed of [
    { ...exact, domain: "other-domain" },
    { ...exact, text: "Different proposal text." },
    { ...exact, rationale: "Different proposal rationale." },
  ]) {
    await expect(proposeLearning(paths, task.id, changed, () => new Date("2026-07-31T08:12:00.000Z")))
      .rejects.toMatchObject({ code: "VINEA_TRANSITION_INVALID" });
    expect(await readFile(journalPath, "utf8")).toBe(journalWithPendingIntent);
  }

  const recovered = await proposeLearning(paths, task.id, exact, () => new Date("2026-07-31T08:13:00.000Z"));
  expect(recovered.updatedAt).toBe(firstTimestamp);
  const events = parseJsonl(await readFile(journalPath, "utf8"));
  const intent = events.find((event) => event.type === "mutation_intent" && event.mutationKind === "learning_proposed")!;
  const completion = events.find((event) => event.type === "learning_proposed")!;
  expect(completion.operationId).toBe(intent.operationId);
  expect(completion.timestamp).toBe(firstTimestamp);
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });
});

test("learning archive retry binds its normalized reason before delayed completion", async () => {
  const task = await createTaskRecord();
  await proposeLearning(paths, task.id, {
    id: "L1",
    domain: "testing-practice",
    text: "Archive content.",
    rationale: "Archive retry coverage.",
    actor: "codex",
  }, () => new Date("2026-07-31T08:10:00.000Z"));
  const exact = { id: " L1 ", reason: "  Keep only task-specific context.  ", actor: " codex " };
  const firstTimestamp = "2026-07-31T08:11:00.000Z";
  mutationCompletionFailure.type = "learning_archived";

  await expect(archiveLearning(paths, task.id, exact, () => new Date(firstTimestamp)))
    .rejects.toThrow("Injected learning_archived completion failure");
  const location = await findTask(paths, task.id);
  expect(location.task.learningCandidates?.[0]).toMatchObject({
    status: "archived",
    archiveReason: "Keep only task-specific context.",
    archivedAt: firstTimestamp,
  });
  const journalPath = join(location.directory, "journal.md");
  const journalWithPendingIntent = await readFile(journalPath, "utf8");
  expect(journalWithPendingIntent).not.toContain("Keep only task-specific context.");
  await expect(archiveLearning(paths, task.id, {
    id: "L1",
    reason: "A different archival reason.",
    actor: "codex",
  }, () => new Date("2026-07-31T08:12:00.000Z"))).rejects.toMatchObject({ code: "VINEA_TRANSITION_INVALID" });
  expect(await readFile(journalPath, "utf8")).toBe(journalWithPendingIntent);

  const recovered = await archiveLearning(paths, task.id, exact, () => new Date("2026-07-31T08:13:00.000Z"));
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

function parseJsonl(contents: string): Array<Record<string, unknown>> {
  return contents.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}
