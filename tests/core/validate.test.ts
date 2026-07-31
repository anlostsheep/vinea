import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
