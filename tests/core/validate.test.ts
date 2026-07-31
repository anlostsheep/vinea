import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import { initializeWorkspace } from "../../src/core/config.js";
import { resolveVineaPaths } from "../../src/core/paths.js";
import { createTask } from "../../src/core/workflow.js";
import { createTempRepo, readJson, runCli, writeJson } from "../helpers/fixture.js";
import type { TaskRecord } from "../../src/core/types.js";

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
  await writeJson(taskPath, { ...task, schemaVersion: 2, status: "mystery" });
  await rm(join(created.directory, "plan.md"));
  await writeFile(
    join(created.directory, "context.jsonl"),
    [
      JSON.stringify({
        schemaVersion: 1,
        path: "README.md",
        purpose: "first",
        estimatedBytes: 10,
        addedAt: "2026-07-31T08:09:10.000Z",
      }),
      JSON.stringify({
        schemaVersion: 1,
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
    schemaVersion: 2,
    riskRules: { medium: [], high: [] },
    context: { maxFiles: 1, maxEstimatedBytes: 5 },
  });
  await writeFile(join(paths.vineaRoot, "inline-audit.jsonl"), "{broken json}\n", "utf8");
  await writeJson(join(paths.sessions, "codex-sid-7374616c65.json"), {
    schemaVersion: 1,
    taskId: "t-20260730-010203-missing-task",
    boundAt: "2026-07-31T08:00:00.000Z",
  });
  await writeJson(join(paths.sessions, "codex-raw-session.json"), {
    schemaVersion: 1,
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
    "TASK_SCHEMA_UNSUPPORTED",
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
    schemaVersion: 1,
    id: "R1",
    text: "Validate versioned artifacts",
    createdAt: "2026-07-31T08:09:10.000Z",
  } as const;
  await writeJson(join(primary.directory, "task.json"), {
    ...task,
    requirements: [requirement],
  });
  const evidence = {
    schemaVersion: 1,
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
      JSON.stringify({ ...evidence, id: "future-evidence", schemaVersion: 2 }),
      JSON.stringify({ ...evidence, summary: "Duplicate evidence ID" }),
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(primary.directory, "journal.md"), "", "utf8");
  const checkRow = {
    schemaVersion: 1,
    requirementId: "R1",
    planItem: "Validate artifacts",
    paths: ["README.md"],
    evidenceIds: ["evidence-1"],
    result: "pass",
    summary: "Backed by command evidence",
    checkedAt: "2026-07-31T08:09:10.000Z",
  };
  const checkPayload = Buffer.from(JSON.stringify({ schemaVersion: 1, rows: [checkRow, checkRow] }), "utf8")
    .toString("base64url");
  await writeFile(
    join(primary.directory, "check.md"),
    `<!-- vinea-checks:v1:${checkPayload} -->\n`,
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
      schemaVersion: 2,
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
      schemaVersion: 1,
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
    schemaVersion: 1,
    type: "created",
    timestamp,
    actor: "cli",
    confirmation: "user",
    status: "planning",
  });
  const transition = (operationId: string, oldStatus: string, newStatus: string, timestamp: string) => ({
    schemaVersion: 1,
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
        schemaVersion: 1,
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
        schemaVersion: 1,
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
        schemaVersion: 1,
        type: "created",
        timestamp: "2026-07-31T08:11:00.000Z",
        actor: "cli",
        confirmation: "user",
        status: "planning",
      }),
      JSON.stringify({
        schemaVersion: 1,
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
    schemaVersion: 1,
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
        schemaVersion: 1,
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
        schemaVersion: 1,
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
    schemaVersion: 1,
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
    schemaVersion: 1,
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
      schemaVersion: 1,
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
