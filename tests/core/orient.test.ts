import { access, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { initializeWorkspace } from "../../src/core/config.js";
import { upsertCheck } from "../../src/core/check.js";
import { addContextReference } from "../../src/core/context.js";
import { recordEvidence } from "../../src/core/evidence.js";
import { resolveVineaPaths, type VineaPaths } from "../../src/core/paths.js";
import {
  addAcceptanceCriterion,
  addRequirement,
  createTask,
  type ContinueTaskInput,
  type OrientInput,
} from "../../src/core/workflow.js";
import type {
  ContinuationResult,
  OrientSummary,
  TaskRecord,
} from "../../src/core/types.js";
import { createTempRepo, readJson, writeJson } from "../helpers/fixture.js";

const fixedNow = () => new Date("2026-07-31T08:09:10.000Z");

let cwd: string;
let paths: VineaPaths;

beforeEach(async () => {
  cwd = await createTempRepo();
  paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
});

test("orient summarizes one shared task and cross-host recovery does not require a Claude session ID", async () => {
  const created = await createTask(
    paths,
    {
      title: "Resume shared work",
      risk: { level: "medium", reasons: ["cross-file"] },
      qualityMode: "tdd",
      executionMode: "single-agent",
      confirmation: "user",
    },
    fixedNow,
  );
  await addRequirement(paths, created.task.id, {
    id: "R1",
    text: "The task resumes across hosts",
    actor: "codex",
  });
  await addAcceptanceCriterion(paths, created.task.id, {
    id: "A1",
    text: "Claude can discover the task without a session ID",
    actor: "codex",
  });
  await writeFile(join(cwd, "resume-context.txt"), "shared context\n", "utf8");
  await addContextReference(paths, created.task.id, {
    path: "resume-context.txt",
    purpose: "Defines the shared recovery fixture",
    actor: "codex",
  });
  const evidence = await recordEvidence(paths, created.task.id, {
    kind: "manual",
    summary: "Recovery fixture prepared",
    result: "pass",
    actor: "codex",
  });

  const first = await orient(paths, { host: "codex", sessionId: "thread-123" });

  expect(first.recommendation).toBe("confirm-single");
  expect(first.binding).toBeNull();
  expect(first.health.initialized).toBe(true);
  expect(first.gitStatus.porcelain).toEqual(expect.any(String));
  expect(first.candidates).toEqual([
    {
      id: created.task.id,
      title: "Resume shared work",
      status: "planning",
      qualityMode: "tdd",
      executionMode: "single-agent",
      requirementsNotCovered: ["R1", "A1"],
      contextReferences: [
        expect.objectContaining({
          path: "resume-context.txt",
          purpose: "Defines the shared recovery fixture",
        }),
      ],
      latestEvidence: evidence,
      latestCheckEvent: null,
    },
  ]);

  const continued = await continueTask(paths, created.task.id, {
    host: "codex",
    sessionId: "thread-123",
    confirmed: true,
  });
  expect(continued.task.status).toBe("planning");
  expect(continued.binding).toMatchObject({
    schemaVersion: 1,
    taskId: created.task.id,
    boundAt: expect.any(String),
  });

  const bound = await orient(paths, { host: "codex", sessionId: "thread-123" });
  expect(bound.recommendation).toBe("resume-bound");
  expect(bound.binding).toMatchObject({
    status: "bound",
    taskId: created.task.id,
  });

  const recovered = await orient(paths, { host: "claude" });
  expect(recovered.recommendation).toBe("confirm-single");
  expect(recovered.binding).toBeNull();
  expect(recovered.candidates.map(({ id }) => id)).toEqual([created.task.id]);
});

test("orient reports multiple active candidates without selecting either one", async () => {
  const first = await createTask(
    paths,
    {
      title: "First candidate",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    () => new Date("2026-07-31T08:09:10.000Z"),
  );
  const second = await createTask(
    paths,
    {
      title: "Second candidate",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    () => new Date("2026-07-31T08:09:11.000Z"),
  );

  const summary = await orient(paths, { host: "claude" });

  expect(summary.recommendation).toBe("choose-task");
  expect(summary.binding).toBeNull();
  expect(summary.candidates.map(({ id }) => id)).toEqual([first.task.id, second.task.id]);
});

test("orient derives uncovered requirements from authoritative passing check rows", async () => {
  const created = await createTask(
    paths,
    {
      title: "Checked requirements",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    fixedNow,
  );
  await addRequirement(paths, created.task.id, { id: "R1", text: "Requirement", actor: "codex" });
  await addAcceptanceCriterion(paths, created.task.id, { id: "A1", text: "Acceptance", actor: "codex" });
  const evidence = await recordEvidence(paths, created.task.id, {
    kind: "manual",
    summary: "Checked behavior",
    result: "pass",
    actor: "codex",
  });
  for (const requirementId of ["R1", "A1"]) {
    await upsertCheck(paths, created.task.id, {
      requirementId,
      planItem: "Verify declared outcome",
      paths: ["README.md"],
      evidenceIds: [evidence.id],
      result: "pass",
      summary: "Observed passing evidence",
      actor: "codex",
    });
  }

  const summary = await orient(paths, { host: "codex" });

  expect(summary.candidates[0]?.requirementsNotCovered).toEqual([]);
});

test("orient reports a stale local binding and still requires confirmation for the single candidate", async () => {
  const created = await createTask(
    paths,
    {
      title: "Only live candidate",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    fixedNow,
  );
  await writeJson(join(paths.sessions, "codex-sid-7374616c652d73657373696f6e.json"), {
    schemaVersion: 1,
    taskId: "t-20260730-010203-missing-task",
    boundAt: "2026-07-31T08:00:00.000Z",
  });

  const summary = await orient(paths, { host: "codex", sessionId: "stale-session" });

  expect(summary.binding).toEqual({
    status: "stale",
    taskId: "t-20260730-010203-missing-task",
    boundAt: "2026-07-31T08:00:00.000Z",
  });
  expect(summary.recommendation).toBe("confirm-single");
  expect(summary.candidates.map(({ id }) => id)).toEqual([created.task.id]);
});

test("orient surfaces a malformed local binding without repairing or following it", async () => {
  const created = await createTask(
    paths,
    {
      title: "Candidate beside malformed binding",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    fixedNow,
  );
  const bindingPath = join(paths.sessions, "claude-sid-62726f6b656e2d73657373696f6e.json");
  await writeFile(bindingPath, "{broken json}\n", "utf8");

  const summary = await orient(paths, { host: "claude", sessionId: "broken-session" });

  expect(summary.binding).toMatchObject({
    status: "malformed",
    message: expect.stringContaining("Invalid JSON"),
  });
  expect(summary.recommendation).toBe("confirm-single");
  expect(summary.candidates.map(({ id }) => id)).toEqual([created.task.id]);
  expect(await readFile(bindingPath, "utf8")).toBe("{broken json}\n");
});

test("orient is read-only even when the ignored runtime directory is missing", async () => {
  const created = await createTask(
    paths,
    {
      title: "Read only recovery",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    fixedNow,
  );
  const taskPath = join(created.directory, "task.json");
  const journalPath = join(created.directory, "journal.md");
  const beforeTask = await readFile(taskPath, "utf8");
  const beforeJournal = await readFile(journalPath, "utf8");
  await rm(paths.runtime, { recursive: true, force: true });

  const summary = await orient(paths, { host: "codex", sessionId: "new-session" });

  expect(summary.binding).toBeNull();
  expect(summary.health.missingRequiredDirectories).toContain(".runtime/sessions");
  await expect(access(paths.runtime)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(taskPath, "utf8")).toBe(beforeTask);
  expect(await readFile(journalPath, "utf8")).toBe(beforeJournal);
});

test("orient fails diagnostically and does not recreate missing active task storage", async () => {
  await rm(paths.activeTasks, { recursive: true });

  await expect(orient(paths, { host: "claude" })).rejects.toMatchObject({
    code: "VINEA_SCHEMA_INVALID",
    message: expect.stringContaining("tasks/active"),
  });
  await expect(access(paths.activeTasks)).rejects.toMatchObject({ code: "ENOENT" });
});

test("orient fails diagnostically when active task storage is an unsafe symlink", async () => {
  await rm(paths.activeTasks, { recursive: true });
  await symlink(paths.archivedTasks, paths.activeTasks);

  await expect(orient(paths, { host: "codex" })).rejects.toMatchObject({
    code: "VINEA_SCHEMA_INVALID",
    message: expect.stringContaining("tasks/active"),
  });
  expect(await readlink(paths.activeTasks)).toBe(paths.archivedTasks);
});

test("unsafe session IDs are rejected before any runtime path is resolved", async () => {
  const created = await createTask(
    paths,
    {
      title: "Reject unsafe binding",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    fixedNow,
  );
  const journalPath = join(created.directory, "journal.md");
  const beforeJournal = await readFile(journalPath, "utf8");

  await expect(orient(paths, { host: "codex", sessionId: "../escape" })).rejects.toMatchObject({
    code: "VINEA_VALIDATION_INVALID",
  });
  await expect(continueTask(paths, created.task.id, {
    host: "codex",
    sessionId: "..\\escape",
    confirmed: true,
  })).rejects.toMatchObject({
    code: "VINEA_VALIDATION_INVALID",
  });

  expect(await readFile(journalPath, "utf8")).toBe(beforeJournal);
  await expect(access(join(paths.runtime, "escape.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("session IDs with ill-formed Unicode are rejected instead of collapsing during encoding", async () => {
  await expect(orient(paths, { host: "codex", sessionId: "\uD800" })).rejects.toMatchObject({
    code: "VINEA_VALIDATION_INVALID",
    message: expect.stringContaining("Unicode"),
  });
  await expect(orient(paths, { host: "codex", sessionId: "\uDC00" })).rejects.toMatchObject({
    code: "VINEA_VALIDATION_INVALID",
    message: expect.stringContaining("Unicode"),
  });
});

test("overlong session IDs are rejected before filesystem resolution", async () => {
  const beforeEntries = await readdir(paths.sessions);

  await expect(orient(paths, { host: "claude", sessionId: "a".repeat(120) })).rejects.toMatchObject({
    code: "VINEA_VALIDATION_INVALID",
    message: expect.stringContaining("119-byte"),
  });

  expect(await readdir(paths.sessions)).toEqual(beforeEntries);
});

test("distinct valid session IDs persist to distinct binding files without overwriting each other", async () => {
  const first = await createTask(
    paths,
    {
      title: "Question mark session",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    () => new Date("2026-07-31T08:09:10.000Z"),
  );
  const second = await createTask(
    paths,
    {
      title: "Literal encoded session",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    () => new Date("2026-07-31T08:09:11.000Z"),
  );

  await continueTask(paths, first.task.id, {
    host: "codex",
    sessionId: "?",
    confirmed: true,
  });
  await continueTask(paths, second.task.id, {
    host: "codex",
    sessionId: "b64-Pw",
    confirmed: true,
  });

  const bindingFiles = (await readdir(paths.sessions)).sort();
  expect(bindingFiles).toHaveLength(2);
  expect(new Set(bindingFiles).size).toBe(2);
  expect((await orient(paths, { host: "codex", sessionId: "?" })).binding).toMatchObject({
    status: "bound",
    taskId: first.task.id,
  });
  expect((await orient(paths, { host: "codex", sessionId: "b64-Pw" })).binding).toMatchObject({
    status: "bound",
    taskId: second.task.id,
  });
});

test("binding filenames remain distinct after filesystem case folding", async () => {
  const upper = await createTask(
    paths,
    {
      title: "Uppercase base64 suffix",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    () => new Date("2026-07-31T08:09:10.000Z"),
  );
  const lower = await createTask(
    paths,
    {
      title: "Lowercase base64 suffix",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    () => new Date("2026-07-31T08:09:11.000Z"),
  );

  await continueTask(paths, upper.task.id, {
    host: "codex",
    sessionId: "AAG",
    confirmed: true,
  });
  await continueTask(paths, lower.task.id, {
    host: "codex",
    sessionId: "AAa",
    confirmed: true,
  });

  const bindingFiles = (await readdir(paths.sessions)).sort();
  expect(bindingFiles).toHaveLength(2);
  expect(new Set(bindingFiles.map((filename) => filename.toLowerCase())).size).toBe(2);
  expect((await orient(paths, { host: "codex", sessionId: "AAG" })).binding).toMatchObject({
    status: "bound",
    taskId: upper.task.id,
  });
  expect((await orient(paths, { host: "codex", sessionId: "AAa" })).binding).toMatchObject({
    status: "bound",
    taskId: lower.task.id,
  });
});

test("a malformed active task fails orient instead of allowing another candidate to be guessed", async () => {
  await createTask(
    paths,
    {
      title: "Valid candidate",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    fixedNow,
  );
  const malformed = join(paths.activeTasks, "t-20260731-080911-malformed");
  await mkdir(malformed);
  await writeFile(join(malformed, "task.json"), "{not json}\n", "utf8");

  await expect(orient(paths, { host: "claude" })).rejects.toMatchObject({
    code: "VINEA_SCHEMA_INVALID",
  });
});

test.each([
  [
    "a requirement entry without required fields",
    (task: TaskRecord) => {
      task.requirements = [{} as TaskRecord["requirements"][number]];
    },
  ],
  [
    "an acceptance entry without required fields",
    (task: TaskRecord) => {
      task.acceptanceCriteria = [{} as TaskRecord["acceptanceCriteria"][number]];
    },
  ],
  [
    "a commit without a string SHA",
    (task: TaskRecord) => {
      task.commit = { sha: 123 } as unknown as TaskRecord["commit"];
    },
  ],
])("orient rejects a task record with %s", async (_label, corrupt) => {
  const created = await createTask(
    paths,
    {
      title: "Reject malformed nested task state",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    fixedNow,
  );
  const taskPath = join(created.directory, "task.json");
  const task = await readJson<TaskRecord>(taskPath);
  corrupt(task);
  await writeJson(taskPath, task);

  await expect(orient(paths, { host: "claude" })).rejects.toMatchObject({
    code: "VINEA_SCHEMA_INVALID",
    message: expect.stringContaining("Invalid task record"),
  });
});

type WorkflowModule = {
  orientWorkspace?: (paths: VineaPaths, input: OrientInput) => Promise<OrientSummary>;
  continueTask?: (
    paths: VineaPaths,
    taskId: string,
    input: ContinueTaskInput,
  ) => Promise<ContinuationResult>;
};

async function orient(paths: VineaPaths, input: OrientInput): Promise<OrientSummary> {
  const workflow = await import("../../src/core/workflow.js") as WorkflowModule;
  expect(typeof workflow.orientWorkspace).toBe("function");
  return workflow.orientWorkspace!(paths, input);
}

async function continueTask(
  paths: VineaPaths,
  taskId: string,
  input: ContinueTaskInput,
): Promise<ContinuationResult> {
  const workflow = await import("../../src/core/workflow.js") as WorkflowModule;
  expect(typeof workflow.continueTask).toBe("function");
  return workflow.continueTask!(paths, taskId, input);
}
