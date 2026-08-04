import { basename, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import { initializeWorkspace, readConfig } from "../../src/core/config.js";
import { diagnoseWorkspace } from "../../src/core/doctor.js";
import { migrateWorkspace } from "../../src/core/migrate.js";
import { resolveVineaPaths, type VineaPaths } from "../../src/core/paths.js";
import { validateWorkspace } from "../../src/core/validate.js";
import { createTempRepo, readJson, writeJson } from "../helpers/fixture.js";

type FailureBoundary = "intent" | "check" | "history" | "task" | "session" | "config" | "completion";

const injectedFailure = vi.hoisted(() => ({ boundary: null as FailureBoundary | null }));

vi.mock("../../src/core/json.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/json.js")>();
  return {
    ...actual,
    writeJsonAtomic: async (...args: Parameters<typeof actual.writeJsonAtomic>) => {
      const [filename, value] = args;
      const state = value as Record<string, unknown>;
      const shouldFail = injectedFailure.boundary === "task" && basename(filename) === "task.json"
        || injectedFailure.boundary === "session" && filename.includes("/.runtime/sessions/")
        || injectedFailure.boundary === "config" && basename(filename) === "config.json"
        || injectedFailure.boundary === "intent"
          && basename(filename) === "schema-migration.json"
          && state.phase === "intent"
        || injectedFailure.boundary === "completion"
          && basename(filename) === "schema-migration.json"
          && state.phase === "completed";
      if (shouldFail) {
        const boundary = injectedFailure.boundary;
        injectedFailure.boundary = null;
        throw new Error(`Injected migration ${boundary} failure`);
      }
      return actual.writeJsonAtomic(...args);
    },
  };
});

vi.mock("../../src/core/task-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/task-store.js")>();
  return {
    ...actual,
    writeManagedMutationTarget: async (...args: Parameters<typeof actual.writeManagedMutationTarget>) => {
      const boundary = injectedFailure.boundary;
      if ((boundary === "check" && args[2].endsWith("/check.md"))
        || (boundary === "history" && args[2].endsWith("/check-history.jsonl"))) {
        injectedFailure.boundary = null;
        throw new Error(`Injected migration ${boundary} failure`);
      }
      return actual.writeManagedMutationTarget(...args);
    },
  };
});

beforeEach(() => {
  injectedFailure.boundary = null;
});

test.each(["intent", "check", "history", "task", "session", "config", "completion"] as const)(
  "migration recovers exactly once after a %s write failure",
  async (boundary) => {
    const { paths, taskId, taskDirectory } = await createLegacyWorkspace();
    const statePath = join(paths.runtime, "schema-migration.json");
    injectedFailure.boundary = boundary;

    await expect(migrateWorkspace(paths)).rejects.toThrow(`Injected migration ${boundary} failure`);

    if (boundary === "intent") {
      await expect(readFile(statePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      expect(await readJson<Record<string, unknown>>(statePath)).toMatchObject({
        schemaVersion: 2,
        type: "schema_migration",
        phase: "intent",
        migratedTaskIds: [taskId],
      });
    }

    const recovered = await migrateWorkspace(paths);
    expect(recovered).toMatchObject({
      status: "migrated",
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      migratedTaskIds: [taskId],
    });
    expect(await readJson<Record<string, unknown>>(statePath)).toMatchObject({
      phase: "completed",
      migratedTaskIds: [taskId],
      completedAt: expect.any(String),
    });
    expect(await readJson<Record<string, unknown>>(paths.config)).toMatchObject({ schemaVersion: 2 });
    expect(await readJson<Record<string, unknown>>(join(taskDirectory, "task.json"))).toMatchObject({
      schemaVersion: 2,
      verificationRevision: 0,
    });
    expect(await readJson<Record<string, unknown>>(join(paths.sessions, "codex-sid-6c65676163792d73657373696f6e.json"))).toMatchObject({
      schemaVersion: 2,
      taskId,
    });
    expect((await readFile(join(taskDirectory, "check.md"), "utf8")).match(/vinea-checks:v2/g)).toHaveLength(1);

    expect(await migrateWorkspace(paths)).toEqual({
      status: "already-current",
      fromSchemaVersion: 2,
      toSchemaVersion: 2,
      migratedTaskIds: [],
    });
  },
);

test("a pending migration blocks normal reads and is diagnosed without rewriting state", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const state = {
    schemaVersion: 2,
    type: "schema_migration",
    operationId: "schema-v1-to-v2-pending",
    fromSchemaVersion: 1,
    toSchemaVersion: 2,
    phase: "intent",
    taskIds: [],
    migratedTaskIds: [],
    startedAt: "2026-08-04T01:02:00.000Z",
  };
  await writeJson(paths.migrationState, state);

  await expect(readConfig(paths)).rejects.toThrow("vinea migrate");
  expect((await validateWorkspace(paths)).issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "MIGRATION_PENDING" }),
  ]));
  expect(await diagnoseWorkspace(paths)).toMatchObject({
    healthy: false,
    migration: { status: "pending", operationId: state.operationId },
  });
  expect(await readJson(paths.migrationState)).toEqual(state);
});

async function createLegacyWorkspace(): Promise<{
  paths: VineaPaths;
  taskId: string;
  taskDirectory: string;
}> {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const taskId = "t-20260804-010101-migration-recovery";
  const taskDirectory = join(paths.activeTasks, taskId);
  await mkdir(taskDirectory);
  const timestamp = "2026-08-04T01:01:01.000Z";
  const checkRow = {
    schemaVersion: 1,
    requirementId: "R1",
    planItem: "Migrate the recovery fixture",
    paths: ["README.md"],
    evidenceIds: ["legacy-evidence"],
    result: "pass",
    summary: "Legacy check passes",
    checkedAt: timestamp,
  };
  const checkPayload = Buffer.from(JSON.stringify({ schemaVersion: 1, rows: [checkRow] }), "utf8")
    .toString("base64url");
  const check = [
    `<!-- vinea-checks:v1:${checkPayload} -->`,
    "",
    "# Check matrix",
    "",
    "| Requirement/acceptance ID | Task item | Implementation/change paths | Test/verification evidence | Result | Summary |",
    "| --- | --- | --- | --- | --- | --- |",
    "| R1 | Migrate the recovery fixture | `README.md` | `legacy-evidence` | pass | Legacy check passes |",
    "",
  ].join("\n");
  await Promise.all([
    writeFile(join(cwd, "README.md"), "# Migration recovery\n", "utf8"),
    writeFile(paths.config, `${JSON.stringify({
      schemaVersion: 1,
      riskRules: { medium: ["behavior"], high: ["migration"] },
      context: { maxFiles: 12, maxEstimatedBytes: 80000 },
    })}\n`, "utf8"),
    writeFile(join(taskDirectory, "task.json"), `${JSON.stringify({
      schemaVersion: 1,
      id: taskId,
      title: "Migration recovery fixture",
      status: "planning",
      risk: { level: "medium", reasons: ["migration"] },
      qualityMode: "standard",
      executionMode: "single-agent",
      requirements: [{ schemaVersion: 1, id: "R1", text: "Recover migration.", createdAt: timestamp }],
      acceptanceCriteria: [],
      commit: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })}\n`, "utf8"),
    writeFile(join(taskDirectory, "brief.md"), "# Brief\n", "utf8"),
    writeFile(join(taskDirectory, "plan.md"), "# Plan\n", "utf8"),
    writeFile(join(taskDirectory, "journal.md"), `${JSON.stringify({
      schemaVersion: 1,
      type: "created",
      timestamp,
      actor: "cli",
      confirmation: "user",
      status: "planning",
    })}\n`, "utf8"),
    writeFile(join(taskDirectory, "evidence.jsonl"), `${JSON.stringify({
      schemaVersion: 1,
      id: "legacy-evidence",
      kind: "command",
      summary: "Legacy command passed",
      result: "pass",
      recordedAt: timestamp,
      command: "npm test",
      exitCode: 0,
      actor: "cli",
    })}\n`, "utf8"),
    writeFile(join(taskDirectory, "context.jsonl"), `${JSON.stringify({
      schemaVersion: 1,
      path: "README.md",
      purpose: "Migration context",
      estimatedBytes: 21,
      addedAt: timestamp,
    })}\n`, "utf8"),
    writeFile(join(taskDirectory, "check.md"), check, "utf8"),
    writeFile(join(paths.sessions, "codex-sid-6c65676163792d73657373696f6e.json"), `${JSON.stringify({
      schemaVersion: 1,
      taskId,
      boundAt: timestamp,
    })}\n`, "utf8"),
  ]);
  return { paths, taskId, taskDirectory };
}
