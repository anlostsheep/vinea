import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import { createTempRepo, readJson, runCli } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("migrate explicitly upgrades current v1 state while preserving immutable v1 history", async () => {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);

  const vineaRoot = join(cwd, ".vinea");
  const taskId = "t-20260804-000001-legacy-migration";
  const taskDirectory = join(vineaRoot, "tasks", "active", taskId);
  const legacySessionPath = join(
    vineaRoot,
    ".runtime",
    "sessions",
    "codex-sid-6c65676163792d73657373696f6e.json",
  );
  const legacySessionBinding = {
    schemaVersion: 1,
    taskId,
    boundAt: "2026-08-04T00:00:00.000Z",
  };
  await mkdir(taskDirectory);

  const config = JSON.stringify({
    schemaVersion: 1,
    riskRules: { medium: ["behavior"], high: ["migration"] },
    context: { maxFiles: 12, maxEstimatedBytes: 80000 },
  });
  const task = JSON.stringify({
    schemaVersion: 1,
    id: taskId,
    title: "Legacy migration fixture",
    status: "planning",
    risk: { level: "medium", reasons: ["migration"] },
    qualityMode: "standard",
    executionMode: "single-agent",
    requirements: [{
      schemaVersion: 1,
      id: "R1",
      text: "Preserve immutable history.",
      createdAt: "2026-08-04T00:00:00.000Z",
    }],
    acceptanceCriteria: [],
    commit: null,
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
  });
  const journal = `${JSON.stringify({
    schemaVersion: 1,
    type: "created",
    timestamp: "2026-08-04T00:00:00.000Z",
    actor: "cli",
    confirmation: "user",
    status: "planning",
  })}\n`;
  const evidence = `${JSON.stringify({
    schemaVersion: 1,
    id: "legacy-evidence",
    kind: "command",
    summary: "Legacy passing command",
    result: "pass",
    recordedAt: "2026-08-04T00:00:00.000Z",
    command: "npm test",
    exitCode: 0,
    actor: "cli",
  })}\n`;
  const context = `${JSON.stringify({
    schemaVersion: 1,
    path: "README.md",
    purpose: "Legacy context",
    estimatedBytes: 100,
    addedAt: "2026-08-04T00:00:00.000Z",
  })}\n`;
  const legacyCheckRow = {
    schemaVersion: 1,
    requirementId: "R1",
    planItem: "Migrate current check",
    paths: ["README.md"],
    evidenceIds: ["legacy-evidence"],
    result: "pass",
    summary: "Legacy check passed",
    checkedAt: "2026-08-04T00:00:00.000Z",
  };
  const legacyCheckPayload = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    rows: [legacyCheckRow],
  }), "utf8").toString("base64url");
  const check = [
    `<!-- vinea-checks:v1:${legacyCheckPayload} -->`,
    "",
    "# Check matrix",
    "",
    "| Requirement/acceptance ID | Task item | Implementation/change paths | Test/verification evidence | Result | Summary |",
    "| --- | --- | --- | --- | --- | --- |",
    "| R1 | Migrate current check | `README.md` | `legacy-evidence` | pass | Legacy check passed |",
    "",
  ].join("\n");

  await Promise.all([
    writeFile(join(cwd, "README.md"), "# Legacy fixture\n", "utf8"),
    writeFile(join(vineaRoot, "config.json"), config, "utf8"),
    writeFile(join(taskDirectory, "task.json"), task, "utf8"),
    writeFile(join(taskDirectory, "brief.md"), "# Brief\n", "utf8"),
    writeFile(join(taskDirectory, "plan.md"), "# Plan\n", "utf8"),
    writeFile(join(taskDirectory, "journal.md"), journal, "utf8"),
    writeFile(join(taskDirectory, "evidence.jsonl"), evidence, "utf8"),
    writeFile(join(taskDirectory, "context.jsonl"), context, "utf8"),
    writeFile(join(taskDirectory, "check.md"), check, "utf8"),
    writeFile(legacySessionPath, `${JSON.stringify(legacySessionBinding)}\n`, "utf8"),
  ]);

  const blocked = await runCli(["task", "show", taskId, "--json"], cwd);
  expect(blocked.exitCode).toBe(1);
  expect(JSON.parse(blocked.stdout)).toMatchObject({
    error: { message: expect.stringContaining("vinea migrate") },
  });

  const migrated = await runCli(["migrate", "--json"], cwd);
  expect(migrated.exitCode).toBe(0);
  expect(JSON.parse(migrated.stdout)).toMatchObject({
    status: "migrated",
    fromSchemaVersion: 1,
    toSchemaVersion: 2,
    migratedTaskIds: [taskId],
  });

  expect(await readJson(join(vineaRoot, "config.json"))).toMatchObject({ schemaVersion: 2 });
  expect(await readJson<Record<string, unknown>>(join(taskDirectory, "task.json"))).toMatchObject({
    schemaVersion: 2,
    verificationRevision: 0,
    requirements: [{ schemaVersion: 2, id: "R1" }],
  });
  expect(await readFile(join(taskDirectory, "journal.md"), "utf8")).toBe(journal);
  expect(await readFile(join(taskDirectory, "evidence.jsonl"), "utf8")).toBe(evidence);
  expect(await readFile(join(taskDirectory, "context.jsonl"), "utf8")).toBe(context);
  expect(await readJson<Record<string, unknown>>(legacySessionPath)).toEqual({
    schemaVersion: 2,
    taskId,
    boundAt: "2026-08-04T00:00:00.000Z",
  });
  expect(await readFile(join(taskDirectory, "check-history.jsonl"), "utf8")).toBe("");
  const migratedCheck = await readFile(join(taskDirectory, "check.md"), "utf8");
  expect(migratedCheck.startsWith("<!-- vinea-checks:v2:")).toBe(true);
  const migratedCheckPayload = JSON.parse(Buffer.from(
    migratedCheck.slice("<!-- vinea-checks:v2:".length, migratedCheck.indexOf(" -->")),
    "base64url",
  ).toString("utf8")) as Record<string, unknown>;
  expect(migratedCheckPayload).toMatchObject({
    schemaVersion: 2,
    rows: [{
      schemaVersion: 2,
      verificationRevision: 0,
      requirementId: "R1",
    }],
  });

  const shown = await runCli(["task", "show", taskId, "--json"], cwd);
  expect(shown.exitCode).toBe(0);
  expect(JSON.parse(shown.stdout)).toMatchObject({ schemaVersion: 2, verificationRevision: 0 });

  const oriented = await runCli(["orient", "--host", "codex", "--json"], cwd);
  expect(JSON.parse(oriented.stdout)).toMatchObject({
    candidates: [{
      id: taskId,
      latestEvidence: { schemaVersion: 2, id: "legacy-evidence" },
    }],
  });
  expect(oriented.exitCode).toBe(0);

  const validated = await runCli(["validate", "--json"], cwd);
  expect(JSON.parse(validated.stdout)).toEqual({ issues: [] });
  expect(validated.exitCode).toBe(0);

  // A v2 config may exist if an older binary completed the task/config portion
  // before it learned to migrate runtime bindings. Rerunning migrate repairs
  // that recoverable partial state rather than leaving validation broken.
  await writeFile(legacySessionPath, `${JSON.stringify(legacySessionBinding)}\n`, "utf8");
  const repairedRuntime = await runCli(["migrate", "--json"], cwd);
  expect(repairedRuntime.exitCode).toBe(0);
  expect(JSON.parse(repairedRuntime.stdout)).toMatchObject({
    status: "migrated",
    fromSchemaVersion: 2,
    toSchemaVersion: 2,
    migratedTaskIds: [],
  });
  expect(await readJson<Record<string, unknown>>(legacySessionPath)).toMatchObject({ schemaVersion: 2 });

  const rerun = await runCli(["migrate", "--json"], cwd);
  expect(rerun.exitCode).toBe(0);
  expect(JSON.parse(rerun.stdout)).toMatchObject({
    status: "already-current",
    fromSchemaVersion: 2,
    toSchemaVersion: 2,
    migratedTaskIds: [],
  });
});
