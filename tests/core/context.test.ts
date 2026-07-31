import { execFile, spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import type { TaskRecord } from "../../src/core/types.js";
import {
  createTempRepo,
  readJson,
  runCli,
  writeJson,
} from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("task mutation commands preserve requirement order, reject duplicate IDs, and copy nonempty UTF-8 documents", async () => {
  const cwd = await initializedRepo();
  const task = await createTask(cwd, "Capture task inputs", "standard");
  const taskDirectory = join(cwd, ".vinea", "tasks", "active", task.id);
  await writeFile(join(cwd, "brief-source.md"), "# Brief\n\nKeep requirements reviewable.\n", "utf8");
  await writeFile(join(cwd, "plan-source.md"), "# Plan\n\n1. Add context.\n", "utf8");

  const first = await runCli([
    "task", "require", task.id,
    "--id", "R1",
    "--text", "The task records bounded context",
    "--json",
  ], cwd);
  const second = await runCli([
    "task", "require", task.id,
    "--id", "R2",
    "--text", "The task rejects duplicate paths",
    "--json",
  ], cwd);
  const accepted = await runCli([
    "task", "accept", task.id,
    "--id", "A1",
    "--text", "A rejected mutation leaves artifacts unchanged",
    "--json",
  ], cwd);
  const brief = await runCli([
    "task", "set-brief", task.id,
    "--file", "brief-source.md",
    "--json",
  ], cwd);
  const plan = await runCli([
    "task", "set-plan", task.id,
    "--file", "plan-source.md",
    "--json",
  ], cwd);

  expect([first, second, accepted, brief, plan].map((result) => result.exitCode)).toEqual([0, 0, 0, 0, 0]);
  const stored = await readJson<TaskRecord>(join(taskDirectory, "task.json"));
  expect(stored.requirements.map(({ id, text }) => ({ id, text }))).toEqual([
    { id: "R1", text: "The task records bounded context" },
    { id: "R2", text: "The task rejects duplicate paths" },
  ]);
  expect(stored.acceptanceCriteria.map(({ id, text }) => ({ id, text }))).toEqual([
    { id: "A1", text: "A rejected mutation leaves artifacts unchanged" },
  ]);
  expect(await readFile(join(taskDirectory, "brief.md"), "utf8")).toBe(
    "# Brief\n\nKeep requirements reviewable.\n",
  );
  expect(await readFile(join(taskDirectory, "plan.md"), "utf8")).toBe("# Plan\n\n1. Add context.\n");

  const beforeDuplicate = await readFile(join(taskDirectory, "task.json"), "utf8");
  const duplicate = await runCli([
    "task", "require", task.id,
    "--id", "R1",
    "--text", "Overwrite the first requirement",
    "--json",
  ], cwd);
  expect(duplicate.exitCode).toBe(1);
  expect(JSON.parse(duplicate.stdout)).toMatchObject({
    error: { code: "VINEA_VALIDATION_INVALID" },
  });
  expect(await readFile(join(taskDirectory, "task.json"), "utf8")).toBe(beforeDuplicate);

  const journal = parseJsonl(await readFile(join(taskDirectory, "journal.md"), "utf8"));
  expect(journal.slice(-5)).toMatchObject([
    {
      type: "requirement_added",
      mutationKind: "requirement_added",
      operationId: expect.any(String),
      requirementId: "R1",
      actor: "cli",
      timestamp: expect.any(String),
    },
    {
      type: "requirement_added",
      mutationKind: "requirement_added",
      operationId: expect.any(String),
      requirementId: "R2",
      actor: "cli",
      timestamp: expect.any(String),
    },
    {
      type: "acceptance_criterion_added",
      mutationKind: "acceptance_criterion_added",
      operationId: expect.any(String),
      requirementId: "A1",
      actor: "cli",
      timestamp: expect.any(String),
    },
    {
      type: "brief_set",
      mutationKind: "brief_set",
      operationId: expect.any(String),
      artifact: "brief.md",
      actor: "cli",
      timestamp: expect.any(String),
    },
    {
      type: "plan_set",
      mutationKind: "plan_set",
      operationId: expect.any(String),
      artifact: "plan.md",
      actor: "cli",
      timestamp: expect.any(String),
    },
  ]);
  expect(journal.slice(-5).every((event) => !("text" in event))).toBe(true);
});

test("context add stores real repository-relative files and list reports cumulative budget without file contents", async () => {
  const cwd = await initializedRepo();
  const task = await createTask(cwd, "Bound context", "standard");
  const contents = "export const marker = 'not returned by list';\n";
  await mkdir(join(cwd, "src"));
  await writeFile(join(cwd, "src", "marker.ts"), contents, "utf8");

  const added = await runCli([
    "context", "add", task.id,
    "--path", "src/marker.ts",
    "--purpose", "Defines the behavior under test",
    "--json",
  ], cwd);
  expect(added.exitCode).toBe(0);
  expect(added.stderr).toBe("");
  expect(JSON.parse(added.stdout)).toMatchObject({
    schemaVersion: 1,
    path: "src/marker.ts",
    purpose: "Defines the behavior under test",
    estimatedBytes: Buffer.byteLength(contents),
    addedAt: expect.any(String),
  });

  const listed = await runCli(["context", "list", task.id, "--json"], cwd);
  expect(listed.exitCode).toBe(0);
  expect(listed.stderr).toBe("");
  const manifest = JSON.parse(listed.stdout);
  expect(manifest).toEqual({
    references: [JSON.parse(added.stdout)],
    totals: { files: 1, estimatedBytes: Buffer.byteLength(contents) },
    limits: { maxFiles: 12, maxEstimatedBytes: 80000 },
  });
  expect(listed.stdout).not.toContain("not returned by list");
  const journal = parseJsonl(
    await readFile(join(cwd, ".vinea", "tasks", "active", task.id, "journal.md"), "utf8"),
  );
  expect(journal.at(-1)).toMatchObject({
    type: "context_added",
    mutationKind: "context_added",
    operationId: expect.any(String),
    actor: "cli",
    timestamp: expect.any(String),
    path: "src/marker.ts",
  });
  expect(journal.at(-1)).not.toHaveProperty("purpose");
});

test("duplicate, escaped, runtime, missing, directory, and symlink context paths fail without appending JSONL", async () => {
  const cwd = await initializedRepo();
  const task = await createTask(cwd, "Reject unsafe context", "standard");
  const contextPath = contextArtifact(cwd, task.id);
  await mkdir(join(cwd, "src"));
  await writeFile(join(cwd, "src", "safe.ts"), "safe\n", "utf8");
  await writeFile(join(cwd, "outside.ts"), "outside\n", "utf8");
  await symlink(join(cwd, "src", "safe.ts"), join(cwd, "src", "linked.ts"));
  await writeFile(join(cwd, ".vinea", ".runtime", "local.txt"), "local\n", "utf8");

  expect((await addContext(cwd, task.id, "src/safe.ts")).exitCode).toBe(0);
  const before = await readFile(contextPath, "utf8");
  const journalPath = join(cwd, ".vinea", "tasks", "active", task.id, "journal.md");
  const beforeJournal = await readFile(journalPath, "utf8");
  const invalidPaths = [
    "src/safe.ts",
    "../outside.ts",
    join(cwd, "outside.ts"),
    ".vinea/.runtime/local.txt",
    "missing.ts",
    "src",
    "src/linked.ts",
  ];
  for (const path of invalidPaths) {
    const result = await addContext(cwd, task.id, path);
    expect(result.exitCode, path).toBe(1);
    expect(JSON.parse(result.stdout), path).toMatchObject({
      error: { code: "VINEA_VALIDATION_INVALID" },
    });
    expect(await readFile(contextPath, "utf8"), path).toBe(before);
    expect(await readFile(journalPath, "utf8"), path).toBe(beforeJournal);
  }
});

test("file-count and estimated-byte budgets are hard gates with no partial append", async () => {
  const cwd = await initializedRepo();
  const countTask = await createTask(cwd, "Count budget", "standard");
  await writeFile(join(cwd, "one.txt"), "1", "utf8");
  await writeFile(join(cwd, "two.txt"), "2", "utf8");
  const configPath = join(cwd, ".vinea", "config.json");
  const config = await readJson<Record<string, unknown>>(configPath);
  config.context = { maxFiles: 1, maxEstimatedBytes: 80000 };
  await writeJson(configPath, config);

  expect((await addContext(cwd, countTask.id, "one.txt")).exitCode).toBe(0);
  const countArtifact = contextArtifact(cwd, countTask.id);
  const countJournal = join(cwd, ".vinea", "tasks", "active", countTask.id, "journal.md");
  const beforeCountFailure = await readFile(countArtifact, "utf8");
  const beforeCountJournal = await readFile(countJournal, "utf8");
  const countFailure = await addContext(cwd, countTask.id, "two.txt");
  expect(countFailure.exitCode).toBe(1);
  expect(await readFile(countArtifact, "utf8")).toBe(beforeCountFailure);
  expect(await readFile(countJournal, "utf8")).toBe(beforeCountJournal);

  const byteTask = await createTask(cwd, "Byte budget", "standard");
  config.context = { maxFiles: 12, maxEstimatedBytes: 3 };
  await writeJson(configPath, config);
  await writeFile(join(cwd, "large.txt"), "four", "utf8");
  const byteArtifact = contextArtifact(cwd, byteTask.id);
  const byteJournal = join(cwd, ".vinea", "tasks", "active", byteTask.id, "journal.md");
  const beforeByteJournal = await readFile(byteJournal, "utf8");
  const byteFailure = await addContext(cwd, byteTask.id, "large.txt");
  expect(byteFailure.exitCode).toBe(1);
  expect(await readFile(byteArtifact, "utf8")).toBe("");
  expect(await readFile(byteJournal, "utf8")).toBe(beforeByteJournal);
});

test("set brief and plan reject symlink and FIFO sources before reading or journaling them", async () => {
  const cwd = await initializedRepo();
  const task = await createTask(cwd, "Reject unsafe task documents", "standard");
  const taskDirectory = join(cwd, ".vinea", "tasks", "active", task.id);
  await writeFile(join(cwd, "brief-source.md"), "# Safe brief\n", "utf8");
  await writeFile(join(cwd, "plan-source.md"), "# Safe plan\n", "utf8");
  expect((await runCli([
    "task", "set-brief", task.id,
    "--file", "brief-source.md",
    "--json",
  ], cwd)).exitCode).toBe(0);
  expect((await runCli([
    "task", "set-plan", task.id,
    "--file", "plan-source.md",
    "--json",
  ], cwd)).exitCode).toBe(0);

  const briefPath = join(taskDirectory, "brief.md");
  const planPath = join(taskDirectory, "plan.md");
  const journalPath = join(taskDirectory, "journal.md");
  const beforeBrief = await readFile(briefPath, "utf8");
  const beforePlan = await readFile(planPath, "utf8");
  const beforeJournal = await readFile(journalPath, "utf8");

  await writeFile(join(cwd, "secret.md"), "# Must not be followed\n", "utf8");
  await symlink(join(cwd, "secret.md"), join(cwd, "linked.md"));
  const linked = await runCli([
    "task", "set-brief", task.id,
    "--file", "linked.md",
    "--json",
  ], cwd);
  expect(linked.exitCode).toBe(1);
  expect(await readFile(briefPath, "utf8")).toBe(beforeBrief);
  expect(await readFile(journalPath, "utf8")).toBe(beforeJournal);

  const fifoPath = join(cwd, "blocked-input");
  await execFileAsync("mkfifo", [fifoPath]);
  const fifo = await runCliWithTimeout([
    "task", "set-plan", task.id,
    "--file", "blocked-input",
    "--json",
  ], cwd);
  expect(fifo.timedOut).toBe(false);
  expect(fifo.exitCode).toBe(1);
  expect(await readFile(planPath, "utf8")).toBe(beforePlan);
  expect(await readFile(journalPath, "utf8")).toBe(beforeJournal);
});

test("task artifact readers reject symlinked brief, plan, and context files", async () => {
  const cwd = await initializedRepo();
  const outside = join(cwd, "outside-artifact.txt");
  await writeFile(outside, "outside\n", "utf8");

  for (const artifact of ["brief.md", "plan.md"] as const) {
    const task = await createTask(cwd, `Unsafe ${artifact}`, "standard");
    const taskDirectory = join(cwd, ".vinea", "tasks", "active", task.id);
    const artifactPath = join(taskDirectory, artifact);
    await rm(artifactPath);
    await symlink(outside, artifactPath);
    const ready = await runCli([
      "task", "transition", task.id,
      "--to", "ready",
      "--reason", "Attempt unsafe readiness",
      "--json",
    ], cwd);
    expect(ready.exitCode).toBe(1);
    expect(JSON.parse(ready.stdout)).toMatchObject({ error: { code: "VINEA_SCHEMA_INVALID" } });
  }

  const task = await createTask(cwd, "Unsafe context reader", "standard");
  const contextPath = contextArtifact(cwd, task.id);
  await rm(contextPath);
  await symlink(outside, contextPath);
  for (const args of [
    ["context", "list", task.id, "--json"],
    ["orient", "--host", "codex", "--json"],
  ]) {
    const result = await runCli(args, cwd);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: "VINEA_SCHEMA_INVALID" } });
  }
});

async function initializedRepo(): Promise<string> {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  return cwd;
}

async function createTask(
  cwd: string,
  title: string,
  qualityMode: "standard" | "tdd",
): Promise<TaskRecord> {
  const result = await runCli([
    "propose",
    "--title", title,
    "--description", "Exercise task mutation behavior",
    "--risk", "low",
    "--quality", qualityMode,
    "--execution", "single-agent",
    "--confirmed",
    "--json",
  ], cwd);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as TaskRecord;
}

function addContext(cwd: string, taskId: string, path: string) {
  return runCli([
    "context", "add", taskId,
    "--path", path,
    "--purpose", "Test context",
    "--json",
  ], cwd);
}

function contextArtifact(cwd: string, taskId: string): string {
  return join(cwd, ".vinea", "tasks", "active", taskId, "context.jsonl");
}

function parseJsonl(contents: string): Array<Record<string, unknown>> {
  return contents.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function runCliWithTimeout(
  args: string[],
  cwd: string,
  timeoutMs = 2000,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const cliPath = join(process.cwd(), "dist", "vinea.mjs");
    const child = spawn(process.execPath, [cliPath, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}
