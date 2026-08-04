import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, expect, test, vi } from "vitest";
import { initializeWorkspace } from "../../src/core/config.js";
import { resolveVineaPaths } from "../../src/core/paths.js";
import { validateWorkspace } from "../../src/core/validate.js";
import { addRequirement, createTask } from "../../src/core/workflow.js";
import { createTempRepo, readJson, runCli, writeJson } from "../helpers/fixture.js";
import { LEGACY_SCHEMA_VERSION, SCHEMA_VERSION, type TaskRecord } from "../../src/core/types.js";

const managedPathRace = vi.hoisted(() => ({
  target: "",
  calls: 0,
  swapOnCall: 1,
  swap: null as (() => Promise<void>) | null,
}));

vi.mock("../../src/core/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/paths.js")>();
  return {
    ...actual,
    assertNoSymlink: async (...args: Parameters<typeof actual.assertNoSymlink>) => {
      await actual.assertNoSymlink(...args);
      if (args[1] === managedPathRace.target) managedPathRace.calls += 1;
      if (
        args[1] === managedPathRace.target
        && managedPathRace.calls === managedPathRace.swapOnCall
        && managedPathRace.swap !== null
      ) {
        const swap = managedPathRace.swap;
        managedPathRace.swap = null;
        await swap();
      }
    },
  };
});

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("validate emits one deterministic JSON object and accepts a missing local runtime", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  await rm(join(cwd, ".vinea", ".runtime"), { recursive: true });

  const result = await runCli(["validate", "--json"], cwd);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(result.stdout)).toEqual({ issues: [] });
});

test("validate requires the immutable check-history artifact for every v2 task", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const created = await createTask(paths, {
    title: "Require check history",
    risk: { level: "low", reasons: [] },
    qualityMode: "standard",
    executionMode: "single-agent",
    confirmation: "user",
  });
  await rm(join(created.directory, "check-history.jsonl"));

  expect((await validateWorkspace(paths)).issues).toEqual(expect.arrayContaining([
    expect.objectContaining({
      code: "TASK_ARTIFACT_MISSING",
      path: `.vinea/tasks/active/${created.task.id}/check-history.jsonl`,
    }),
  ]));
});

test("validate rejects an intermediate managed tasks symlink without scanning its external tree", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const paths = resolveVineaPaths(cwd);
  const created = await createTask(paths, {
    title: "Plausible task outside managed storage",
    risk: { level: "low", reasons: [] },
    qualityMode: "standard",
    executionMode: "single-agent",
    confirmation: "user",
  });
  expect((await runCli(["validate", "--json"], cwd)).exitCode).toBe(0);

  const externalTasks = await mkdtemp(join(tmpdir(), "vinea-external-tasks-"));
  try {
    await rename(paths.activeTasks, join(externalTasks, "active"));
    await rename(paths.archivedTasks, join(externalTasks, "archive"));
    await writeFile(join(externalTasks, "active", created.task.id, "evidence.jsonl"), "{}\n", "utf8");
    await rm(paths.tasks, { recursive: true });
    await symlink(externalTasks, paths.tasks);

    const result = await runCli(["validate", "--json"], cwd);
    const issues = (JSON.parse(result.stdout) as { issues: Array<{ code: string; path: string; message: string }> }).issues;

    expect(result.exitCode).toBe(1);
    expect(issues).toEqual([{
      code: "MANAGED_PATH_UNSAFE",
      path: ".vinea/tasks",
      message: "Vinea managed paths must remain inside the repository and must not traverse symbolic links.",
    }]);
    expect(issues.map(({ code }) => code)).not.toContain("EVIDENCE_RECORD_INVALID");
  } finally {
    await rm(externalTasks, { recursive: true, force: true });
  }
});

test("validate rechecks managed ancestry before scanning after a preliminary path check", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const created = await createTask(paths, {
    title: "Detect a managed path replacement before scan",
    risk: { level: "low", reasons: [] },
    qualityMode: "standard",
    executionMode: "single-agent",
    confirmation: "user",
  });
  const externalTasks = await mkdtemp(join(tmpdir(), "vinea-race-external-tasks-"));
  try {
    // The second active-root check occurs after its entry-kind decision and
    // immediately before scanTaskScope performs the real readdir.
    managedPathRace.target = paths.activeTasks;
    managedPathRace.calls = 0;
    managedPathRace.swapOnCall = 2;
    managedPathRace.swap = async () => {
      await rename(paths.activeTasks, join(externalTasks, "active"));
      await rename(paths.archivedTasks, join(externalTasks, "archive"));
      await writeFile(join(externalTasks, "active", created.task.id, "evidence.jsonl"), "{}\n", "utf8");
      await rm(paths.tasks, { recursive: true });
      await symlink(externalTasks, paths.tasks);
    };

    const report = await validateWorkspace(paths);

    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "MANAGED_PATH_UNSAFE",
      path: ".vinea/tasks/active",
    })]));
    expect(report.issues.map(({ code }) => code)).not.toContain("EVIDENCE_RECORD_INVALID");
  } finally {
    managedPathRace.target = "";
    managedPathRace.calls = 0;
    managedPathRace.swapOnCall = 1;
    managedPathRace.swap = null;
    await rm(externalTasks, { recursive: true, force: true });
  }
});

test("validate reports retained task lock owner states in sorted JSON without modifying them", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const paths = resolveVineaPaths(cwd);
  const locks = join(paths.runtime, "task-locks");
  const retained = [
    ["t-20260731-195000-a-valid", "{\"token\":\"valid-owner\"}\n", "TASK_LOCK_RETAINED"],
    ["t-20260731-195001-b-missing", undefined, "TASK_LOCK_OWNER_MISSING"],
    ["t-20260731-195002-c-malformed", "{\"token\":42}\n", "TASK_LOCK_OWNER_MALFORMED"],
    ["t-20260731-195003-d-unreadable", "directory", "TASK_LOCK_OWNER_UNREADABLE"],
    ["t-20260731-195004-e-unsafe", "symlink", "TASK_LOCK_OWNER_UNSAFE"],
  ] as const;
  const outsideOwner = join(cwd, "outside-owner.json");
  await writeFile(outsideOwner, "{\"token\":\"outside\"}\n", "utf8");
  for (const [taskId, owner] of retained) {
    const lock = join(locks, `${taskId}.lock`);
    await mkdir(lock, { recursive: true });
    if (owner === "directory") await mkdir(join(lock, "owner.json"));
    else if (owner === "symlink") await symlink(outsideOwner, join(lock, "owner.json"));
    else if (owner !== undefined) await writeFile(join(lock, "owner.json"), owner, "utf8");
  }
  const validLock = join(locks, `${retained[0][0]}.lock`);
  const before = await stat(validLock);

  const result = await runCli(["validate", "--json"], cwd);
  const issues = (JSON.parse(result.stdout) as { issues: Array<{ code: string; path: string; message: string }> }).issues;

  expect(result.exitCode).toBe(1);
  expect(issues.map(({ code }) => code)).toEqual(retained.map(([, , code]) => code));
  expect(issues).toEqual([...issues].sort((left, right) =>
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message),
  ));
  for (const [taskId] of retained) {
    const issue = issues.find(({ path }) => path.endsWith(`${taskId}.lock`));
    expect(issue?.message).toContain(`task ${taskId}`);
    expect(issue?.message).toContain("age");
    expect(issue?.message).toContain(
      `Confirm no active process, then remove exact lock directory .vinea/.runtime/task-locks/${taskId}.lock.`,
    );
  }
  expect((await stat(validLock)).mtimeMs).toBe(before.mtimeMs);
  expect(await readFile(join(validLock, "owner.json"), "utf8")).toBe("{\"token\":\"valid-owner\"}\n");
  expect(await readFile(outsideOwner, "utf8")).toBe("{\"token\":\"outside\"}\n");
});

test.each(["file", "symbolic link"] as const)(
  "validate reports a %s task-lock directory without following or repairing it",
  async (kind) => {
    const cwd = await createTempRepo();
    expect((await runCli(["init"], cwd)).exitCode).toBe(0);
    const locks = join(cwd, ".vinea", ".runtime", "task-locks");
    await rm(locks, { recursive: true, force: true });
    if (kind === "file") {
      await writeFile(locks, "not a directory\n", "utf8");
    } else {
      const outside = join(cwd, "outside-locks");
      await mkdir(outside);
      await symlink(outside, locks);
    }

    const result = await runCli(["validate", "--json"], cwd);
    const issues = (JSON.parse(result.stdout) as { issues: Array<{ code: string; path: string; message: string }> }).issues;

    expect(result.exitCode).toBe(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "TASK_LOCK_DIRECTORY_INVALID",
      path: ".vinea/.runtime/task-locks",
      message: expect.stringContaining(
        "Confirm no active process, then remove exact lock directory .vinea/.runtime/task-locks.",
      ),
    });
  },
);

test("validate reports a retained learning promotion lock without removing it", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const lockDirectory = join(cwd, ".vinea", ".runtime", "learning-promotion.lock");
  await mkdir(lockDirectory);
  await writeFile(join(lockDirectory, "owner.json"), "{\"token\":\"promotion-owner\"}\n", "utf8");
  const before = await stat(lockDirectory);

  const result = await runCli(["validate", "--json"], cwd);
  const issues = (JSON.parse(result.stdout) as { issues: Array<{ code: string; path: string; message: string }> }).issues;

  expect(result.exitCode).toBe(1);
  expect(issues).toEqual([expect.objectContaining({
    code: "LEARNING_PROMOTION_LOCK_RETAINED",
    path: ".vinea/.runtime/learning-promotion.lock",
    message: expect.stringContaining("learning promotion lock"),
  })]);
  expect(issues[0]!.message).toContain(
    "Confirm no active process, then remove exact lock directory .vinea/.runtime/learning-promotion.lock.",
  );
  expect((await stat(lockDirectory)).mtimeMs).toBe(before.mtimeMs);
  expect(await readFile(join(lockDirectory, "owner.json"), "utf8")).toBe("{\"token\":\"promotion-owner\"}\n");
});

test("validate verifies managed spec files, index targets, and the runtime ignore contract", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const paths = resolveVineaPaths(cwd);
  const reportCodes = async (): Promise<string[]> => {
    const result = await runCli(["validate", "--json"], cwd);
    return (JSON.parse(result.stdout) as { issues: Array<{ code: string }> }).issues.map(({ code }) => code);
  };

  await rm(paths.gitignore);
  expect(await reportCodes()).toContain("VINEA_GITIGNORE_MISSING");
  await writeFile(paths.gitignore, ".runtime/\n", "utf8");
  await writeFile(paths.gitignore, "runtime/\n", "utf8");
  expect(await reportCodes()).toContain("VINEA_GITIGNORE_INVALID");
  await writeFile(paths.gitignore, ".runtime/\n", "utf8");

  await writeFile(paths.specIndex, "# Vinea Specs\n\n- [Escaped](../outside.md)\n", "utf8");
  expect(await reportCodes()).toContain("SPEC_INDEX_TARGET_INVALID");
  await writeFile(paths.specIndex, "# Vinea Specs\n\n- [Missing](missing.md)\n", "utf8");
  expect(await reportCodes()).toContain("SPEC_INDEX_TARGET_MISSING");
  await writeFile(paths.specIndex, "# Vinea Specs\n\n- [Malformed](missing.md\n", "utf8");
  expect(await reportCodes()).toContain("SPEC_INDEX_ENTRY_INVALID");

  const outsideSpec = join(cwd, "outside-spec.md");
  await writeFile(outsideSpec, "# Outside\n", "utf8");
  await symlink(outsideSpec, join(paths.specs, "testing.md"));
  await writeFile(
    paths.specIndex,
    "# Vinea Specs\n\n- [Testing](testing.md)\n- [Duplicate](./testing.md)\n",
    "utf8",
  );
  const codes = await reportCodes();
  expect(codes).toEqual(expect.arrayContaining([
    "SPEC_INDEX_TARGET_INVALID",
    "SPEC_INDEX_TARGET_DUPLICATE",
  ]));
});

test("validate aggregates malformed shared and runtime state in stable order without writes", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const created = await createTask(
    paths,
    {
      title: "Malformed validation fixture",
      risk: { level: "medium", reasons: ["cross-file"] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    () => new Date("2026-07-31T08:09:10.000Z"),
  );
  const taskPath = join(created.directory, "task.json");
  const task = await readJson<TaskRecord>(taskPath);
  await writeJson(taskPath, { ...task, status: "mystery" });
  await rm(join(created.directory, "plan.md"));
  await writeFile(join(cwd, "README.md"), "validation context fixture\n", "utf8");
  await writeFile(
    join(created.directory, "context.jsonl"),
    [
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        path: "README.md",
        purpose: "first",
        estimatedBytes: 10,
        addedAt: "2026-07-31T08:09:10.000Z",
      }),
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        path: "README.md",
        purpose: "duplicate",
        estimatedBytes: 10,
        addedAt: "2026-07-31T08:09:11.000Z",
      }),
      "",
    ].join("\n"),
    "utf8",
  );
  await writeJson(paths.config, {
    schemaVersion: SCHEMA_VERSION + 1,
    riskRules: { medium: [], high: [] },
    context: { maxFiles: 1, maxEstimatedBytes: 5 },
  });
  await writeFile(join(paths.vineaRoot, "inline-audit.jsonl"), "{broken json}\n", "utf8");
  await writeJson(join(paths.sessions, "codex-sid-7374616c65.json"), {
    schemaVersion: SCHEMA_VERSION,
    taskId: "t-20260730-010203-missing-task",
    boundAt: "2026-07-31T08:00:00.000Z",
  });
  await writeJson(join(paths.sessions, "codex-raw-session.json"), {
    schemaVersion: SCHEMA_VERSION,
    taskId: created.task.id,
    boundAt: "2026-07-31T08:00:00.000Z",
  });
  const before = await snapshotFiles(paths.vineaRoot);

  const result = await runCli(["validate", "--json"], cwd);
  const output = JSON.parse(result.stdout) as {
    issues: Array<{ code: string; path: string; message: string }>;
  };

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  expect(output.issues).toEqual(
    [...output.issues].sort((left, right) =>
      left.path.localeCompare(right.path)
      || left.code.localeCompare(right.code)
      || left.message.localeCompare(right.message)
    ),
  );
  expect(output.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
    "CONFIG_SCHEMA_UNSUPPORTED",
    "INLINE_AUDIT_JSONL_INVALID",
    "TASK_RECORD_INVALID",
    "TASK_STATUS_INVALID",
    "TASK_ARTIFACT_MISSING",
    "CONTEXT_DUPLICATE",
    "CONTEXT_FILE_BUDGET_EXCEEDED",
    "CONTEXT_BYTE_BUDGET_EXCEEDED",
    "SESSION_BINDING_STALE",
    "SESSION_FILENAME_INVALID",
  ]));
  expect(output.issues.every(({ path }) => path.startsWith(".vinea/"))).toBe(true);
  expect(await snapshotFiles(paths.vineaRoot)).toEqual(before);
});

test("validate rejects invalid versioned evidence, journal, and authoritative check artifacts without writes", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const primary = await createTask(
    paths,
    {
      title: "Versioned artifact validation",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    () => new Date("2026-07-31T08:09:10.000Z"),
  );
  const task = await readJson<TaskRecord>(join(primary.directory, "task.json"));
  const requirement = {
    schemaVersion: SCHEMA_VERSION,
    id: "R1",
    text: "Validate versioned artifacts",
    createdAt: "2026-07-31T08:09:10.000Z",
  } as const;
  await writeJson(join(primary.directory, "task.json"), {
    ...task,
    requirements: [requirement],
  });
  const evidence = {
    schemaVersion: SCHEMA_VERSION,
    verificationRevision: 0,
    id: "evidence-1",
    kind: "command",
    summary: "A valid command result",
    result: "pass",
    recordedAt: "2026-07-31T08:09:10.000Z",
    exitCode: 0,
    actor: "cli",
  } as const;
  await writeFile(
    join(primary.directory, "evidence.jsonl"),
    [
      JSON.stringify(evidence),
      JSON.stringify({ ...evidence, id: "future-evidence", schemaVersion: SCHEMA_VERSION + 1 }),
      JSON.stringify({ ...evidence, summary: "Duplicate evidence ID" }),
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(primary.directory, "journal.md"), "", "utf8");
  const checkRow = {
    schemaVersion: SCHEMA_VERSION,
    verificationRevision: 0,
    requirementId: "R1",
    planItem: "Validate artifacts",
    paths: ["README.md"],
    evidenceIds: ["evidence-1"],
    result: "pass",
    summary: "Backed by command evidence",
    checkedAt: "2026-07-31T08:09:10.000Z",
  };
  const checkPayload = Buffer.from(JSON.stringify({ schemaVersion: SCHEMA_VERSION, rows: [checkRow, checkRow] }), "utf8")
    .toString("base64url");
  await writeFile(
    join(primary.directory, "check.md"),
    `<!-- vinea-checks:v2:${checkPayload} -->\n`,
    "utf8",
  );
  const secondary = await createTask(
    paths,
    {
      title: "Future journal schema",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    () => new Date("2026-07-31T08:09:11.000Z"),
  );
  await writeFile(
    join(secondary.directory, "journal.md"),
    `${JSON.stringify({
      schemaVersion: SCHEMA_VERSION + 1,
      type: "created",
      timestamp: "2026-07-31T08:09:11.000Z",
      actor: "cli",
      confirmation: "user",
      status: "planning",
    })}\n`,
    "utf8",
  );
  const missingCreation = await createTask(
    paths,
    {
      title: "Missing journal creation",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    () => new Date("2026-07-31T08:09:12.000Z"),
  );
  await writeFile(
    join(missingCreation.directory, "journal.md"),
    `${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      type: "continued",
      timestamp: "2026-07-31T08:09:12.000Z",
      actor: "cli",
      confirmation: "user",
      host: "codex",
      sessionBound: false,
      started: false,
      status: "planning",
    })}\n`,
    "utf8",
  );
  const before = await snapshotFiles(paths.vineaRoot);

  const result = await runCli(["validate", "--json"], cwd);
  const output = JSON.parse(result.stdout) as { issues: Array<{ code: string }> };

  expect(result.exitCode).toBe(1);
  expect(output.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
    "EVIDENCE_SCHEMA_UNSUPPORTED",
    "EVIDENCE_ID_DUPLICATE",
    "JOURNAL_EMPTY",
    "JOURNAL_SCHEMA_UNSUPPORTED",
    "JOURNAL_CREATION_MISSING",
    "CHECK_PAYLOAD_INVALID",
  ]));
  expect(await snapshotFiles(paths.vineaRoot)).toEqual(before);
});

test("validate rejects evidence that claims a verification revision newer than its task", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const task = await createTask(paths, {
    title: "Reject future evidence revision",
    risk: { level: "low", reasons: [] },
    qualityMode: "standard",
    executionMode: "single-agent",
    confirmation: "user",
  }, () => new Date("2026-08-04T01:05:00.000Z"));
  await writeFile(join(task.directory, "evidence.jsonl"), `${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    verificationRevision: 1,
    id: "future-evidence",
    kind: "command",
    summary: "This proof cannot come from the future.",
    result: "pass",
    recordedAt: "2026-08-04T01:05:01.000Z",
    command: "npm test -- future",
    exitCode: 0,
    actor: "cli",
  })}\n`, "utf8");

  const report = await validateWorkspace(paths);
  expect(report.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "EVIDENCE_REVISION_INVALID" }),
  ]));
});

test("validate replays journal state before accepting task lifecycle artifacts", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const createdAt = "2026-07-31T08:10:00.000Z";
  const create = async (title: string, offset: number) => createTask(
    paths,
    {
      title,
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    () => new Date(`2026-07-31T08:10:0${offset}.000Z`),
  );
  const creation = (timestamp: string) => ({
    schemaVersion: SCHEMA_VERSION,
    type: "created",
    timestamp,
    actor: "cli",
    confirmation: "user",
    status: "planning",
  });
  const transition = (operationId: string, oldStatus: string, newStatus: string, timestamp: string) => ({
    schemaVersion: SCHEMA_VERSION,
    type: "transition_intent",
    operationId,
    timestamp,
    actor: "cli",
    reason: "test transition",
    oldStatus,
    newStatus,
  });

  const continuedBeforeCreation = await create("Continued before creation", 1);
  await writeFile(
    join(continuedBeforeCreation.directory, "journal.md"),
    [
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        type: "continued",
        timestamp: createdAt,
        actor: "cli",
        confirmation: "user",
        host: "codex",
        sessionBound: false,
        started: false,
        status: "planning",
      }),
      JSON.stringify(creation(createdAt)),
      "",
    ].join("\n"),
    "utf8",
  );

  const selfTransition = await create("Self transition", 2);
  await writeFile(
    join(selfTransition.directory, "journal.md"),
    [
      JSON.stringify(creation(createdAt)),
      JSON.stringify(transition("op-self", "planning", "planning", "2026-07-31T08:10:02.000Z")),
      JSON.stringify(transition("op-skip", "planning", "in_progress", "2026-07-31T08:10:03.000Z")),
      "",
    ].join("\n"),
    "utf8",
  );

  const discontinuousTransition = await create("Discontinuous transition", 3);
  await writeFile(
    join(discontinuousTransition.directory, "journal.md"),
    [
      JSON.stringify(creation(createdAt)),
      JSON.stringify(transition("op-ready", "planning", "ready", "2026-07-31T08:10:03.000Z")),
      JSON.stringify(transition("op-discontinuous", "planning", "ready", "2026-07-31T08:10:04.000Z")),
      "",
    ].join("\n"),
    "utf8",
  );
  const discontinuousTask = await readJson<TaskRecord>(join(discontinuousTransition.directory, "task.json"));
  await writeJson(join(discontinuousTransition.directory, "task.json"), { ...discontinuousTask, status: "ready" });

  const mismatchedStatus = await create("Mismatched resulting status", 4);
  await writeFile(
    join(mismatchedStatus.directory, "journal.md"),
    [
      JSON.stringify(creation(createdAt)),
      JSON.stringify(transition("op-mismatch", "planning", "ready", "2026-07-31T08:10:05.000Z")),
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        type: "continued",
        timestamp: "2026-07-31T08:10:06.000Z",
        actor: "cli",
        confirmation: "user",
        host: "codex",
        sessionBound: false,
        started: false,
        status: "ready",
      }),
      "",
    ].join("\n"),
    "utf8",
  );

  const before = await snapshotFiles(paths.vineaRoot);
  const result = await runCli(["validate", "--json"], cwd);
  const output = JSON.parse(result.stdout) as { issues: Array<{ code: string }> };

  expect(result.exitCode).toBe(1);
  expect(output.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
    "JOURNAL_CREATION_NOT_FIRST",
    "JOURNAL_TRANSITION_INVALID",
    "JOURNAL_STATUS_DISCONTINUITY",
    "JOURNAL_TASK_STATUS_MISMATCH",
  ]));
  expect(output.issues.filter(({ code }) => code === "JOURNAL_TRANSITION_INVALID")).toHaveLength(2);
  expect(await snapshotFiles(paths.vineaRoot)).toEqual(before);
});

test("validate preserves the old-status window only for a final transition intent", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const task = await createTask(
    paths,
    {
      title: "Pending transition intent",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    () => new Date("2026-07-31T08:11:00.000Z"),
  );
  await writeFile(
    join(task.directory, "journal.md"),
    [
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        type: "created",
        timestamp: "2026-07-31T08:11:00.000Z",
        actor: "cli",
        confirmation: "user",
        status: "planning",
      }),
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        type: "transition_intent",
        operationId: "op-pending",
        timestamp: "2026-07-31T08:11:01.000Z",
        actor: "cli",
        reason: "pending status commit",
        oldStatus: "planning",
        newStatus: "ready",
      }),
      "",
    ].join("\n"),
    "utf8",
  );

  const result = await runCli(["validate", "--json"], cwd);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ issues: [] });
});

test("validate distinguishes uncommitted mutation intents from committed events with missing targets", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const task = await createTask(
    paths,
    {
      title: "Mutation intent validation",
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    },
    () => new Date("2026-07-31T20:10:00.000Z"),
  );
  const taskPath = join(task.directory, "task.json");
  const journalPath = join(task.directory, "journal.md");
  const timestamp = "2026-07-31T20:10:01.000Z";
  const expected = {
    identity: { requirementId: "R1" },
    files: [{ path: relative(cwd, taskPath).split("\\").join("/"), sha256: "0".repeat(64) }],
  };
  const completion = {
    schemaVersion: SCHEMA_VERSION,
    type: "requirement_added",
    mutationKind: "requirement_added",
    timestamp,
    actor: "cli",
    requirementId: "R1",
  };
  const original = await readFile(journalPath, "utf8");
  await writeFile(
    journalPath,
    [
      original.trimEnd(),
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        type: "mutation_intent",
        operationId: "op-completed-target-missing",
        timestamp,
        actor: "cli",
        mutationKind: "requirement_added",
        fingerprint: "a".repeat(64),
        expected,
        completion,
      }),
      JSON.stringify({ ...completion, operationId: "op-completed-target-missing" }),
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        type: "mutation_intent",
        operationId: "op-uncommitted",
        timestamp,
        actor: "cli",
        mutationKind: "requirement_added",
        fingerprint: "b".repeat(64),
        expected,
        completion,
      }),
      "",
    ].join("\n"),
    "utf8",
  );

  const result = await runCli(["validate", "--json"], cwd);
  const codes = (JSON.parse(result.stdout) as { issues: Array<{ code: string }> }).issues.map(({ code }) => code);

  expect(result.exitCode).toBe(1);
  expect(codes).toEqual(expect.arrayContaining([
    "MUTATION_INTENT_UNCOMMITTED",
    "MUTATION_TARGET_MISMATCH",
  ]));
});

test("validate rejects current orphan mutation completions while preserving the pre-protocol event shape", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const current = await createTask(paths, {
    title: "Reject orphan mutation completions",
    risk: { level: "low", reasons: [] },
    qualityMode: "standard",
    executionMode: "single-agent",
    confirmation: "user",
  }, () => new Date("2026-07-31T20:12:00.000Z"));
  const currentJournal = join(current.directory, "journal.md");
  const timestamp = "2026-07-31T20:12:01.000Z";
  await addRequirement(paths, current.task.id, {
    id: "R0",
    text: "Prove current completions carry the protocol marker.",
    actor: "cli",
  }, () => new Date(timestamp));
  const currentEvents = (await readFile(currentJournal, "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(currentEvents.find((event) => event.type === "requirement_added"))
    .toMatchObject({ mutationProtocolVersion: 1 });
  await writeFile(currentJournal, [
    (await readFile(currentJournal, "utf8")).trimEnd(),
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      type: "requirement_added",
      mutationKind: "requirement_added",
      mutationProtocolVersion: 1,
      operationId: "op-orphan-requirement",
      timestamp,
      actor: "cli",
      requirementId: "R1",
    }),
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      type: "learning_accepted",
      mutationKind: "learning_accepted",
      mutationProtocolVersion: 1,
      operationId: "op-orphan-learning",
      timestamp,
      actor: "cli",
      learningCandidateId: "L1",
      confirmedBy: "user",
    }),
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      type: "check_recorded",
      mutationKind: "check_recorded",
      mutationProtocolVersion: 1,
      operationId: "op-orphan-check",
      timestamp,
      actor: "cli",
      requirementId: "R1",
      result: "uncovered",
    }),
    "",
  ].join("\n"), "utf8");

  const currentReport = await validateWorkspace(paths);
  const orphanIssues = currentReport.issues.filter(({ code }) => code === "MUTATION_COMPLETION_ORPHAN");
  expect(orphanIssues).toHaveLength(3);
  expect(orphanIssues.map(({ message }) => message)).toEqual(expect.arrayContaining([
    expect.stringContaining("op-orphan-requirement"),
    expect.stringContaining("op-orphan-learning"),
    expect.stringContaining("op-orphan-check"),
  ]));
  expect(orphanIssues.every(({ message }) => message.includes("Line"))).toBe(true);

  const legacy = await createTask(paths, {
    title: "Recognize pre protocol completion",
    risk: { level: "low", reasons: [] },
    qualityMode: "standard",
    executionMode: "single-agent",
    confirmation: "user",
  }, () => new Date("2026-07-31T20:13:00.000Z"));
  const legacyTask = await readJson<TaskRecord>(join(legacy.directory, "task.json"));
  await writeJson(join(legacy.directory, "task.json"), {
    ...legacyTask,
    requirements: [{
      schemaVersion: SCHEMA_VERSION,
      id: "R1",
      text: "Recorded before the mutation-intent protocol.",
      createdAt: timestamp,
    }],
    updatedAt: timestamp,
  });
  const legacyJournal = join(legacy.directory, "journal.md");
  await writeFile(legacyJournal, [
    (await readFile(legacyJournal, "utf8")).trimEnd(),
    JSON.stringify({
      schemaVersion: LEGACY_SCHEMA_VERSION,
      type: "requirement_added",
      operationId: "op-legacy-requirement",
      timestamp,
      actor: "cli",
      requirementId: "R1",
    }),
    "",
  ].join("\n"), "utf8");

  const legacyReport = await validateWorkspace(paths);
  expect(legacyReport.issues.filter(({ path }) => path.includes(legacy.task.id))).toEqual([]);
  expect(legacyReport.issues.filter(({ code }) => code === "MUTATION_COMPLETION_ORPHAN")).toHaveLength(3);
});

test("validate detects a completed task mutation whose identified value was changed later", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const created = await createTask(paths, {
    title: "Detect altered mutation value",
    risk: { level: "low", reasons: [] },
    qualityMode: "standard",
    executionMode: "single-agent",
    confirmation: "user",
  }, () => new Date("2026-07-31T20:11:00.000Z"));
  const originalRequirement = {
    createdAt: "2026-07-31T20:11:01.000Z",
    id: "R1",
    schemaVersion: SCHEMA_VERSION,
    text: "Original durable requirement",
  };
  const stored = await readJson<TaskRecord>(join(created.directory, "task.json"));
  await writeJson(join(created.directory, "task.json"), {
    ...stored,
    requirements: [{ ...originalRequirement, text: "Tampered requirement text" }],
  });
  const taskPath = join(created.directory, "task.json");
  const timestamp = "2026-07-31T20:11:01.000Z";
  const completion = {
    schemaVersion: SCHEMA_VERSION,
    type: "requirement_added",
    mutationKind: "requirement_added",
    timestamp,
    actor: "cli",
    requirementId: "R1",
  };
  const journalPath = join(created.directory, "journal.md");
  const journal = await readFile(journalPath, "utf8");
  await writeFile(journalPath, [
    journal.trimEnd(),
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      type: "mutation_intent",
      operationId: "op-altered-requirement",
      timestamp,
      actor: "cli",
      mutationKind: "requirement_added",
      fingerprint: "c".repeat(64),
      expected: {
        identity: {
          requirementId: "R1",
          valueSha256: createHash("sha256").update(JSON.stringify(originalRequirement)).digest("hex"),
        },
        files: [{
          path: relative(cwd, taskPath).split("\\").join("/"),
          sha256: createHash("sha256").update(await readFile(taskPath)).digest("hex"),
        }],
      },
      completion,
    }),
    JSON.stringify({ ...completion, operationId: "op-altered-requirement" }),
    "",
  ].join("\n"), "utf8");

  const result = await runCli(["validate", "--json"], cwd);
  const codes = (JSON.parse(result.stdout) as { issues: Array<{ code: string }> }).issues.map(({ code }) => code);

  expect(result.exitCode).toBe(1);
  expect(codes).toContain("MUTATION_TARGET_MISMATCH");
});

async function snapshotFiles(root: string): Promise<Record<string, { contents: string; mtimeMs: number }>> {
  const snapshot: Record<string, { contents: string; mtimeMs: number }> = {};
  await visit(root);
  return snapshot;

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        snapshot[relative(root, path)] = {
          contents: await readFile(path, "utf8"),
          mtimeMs: (await stat(path)).mtimeMs,
        };
      }
    }
  }
}
