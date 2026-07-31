import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import type { TaskRecord } from "../../src/core/types.js";
import { createTempRepo, runCli } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("evidence record stores bounded audit metadata and rejects contradictory TDD evidence without appending", async () => {
  const { cwd, task } = await initializedTask("Evidence metadata", "tdd");
  const evidencePath = evidenceArtifact(cwd, task.id);
  const journalPath = journalArtifact(cwd, task.id);
  const beforeInvalidJournal = await readFile(journalPath, "utf8");

  const invalidRed = await recordEvidence(cwd, task.id, {
    kind: "tdd-red",
    summary: "The regression test unexpectedly passed",
    command: "npm test -- regression",
    exitCode: 0,
    result: "pass",
  });
  expect(invalidRed.exitCode).toBe(1);
  expect(JSON.parse(invalidRed.stdout)).toMatchObject({
    error: { code: "VINEA_VALIDATION_INVALID" },
  });
  expect(await readFile(evidencePath, "utf8")).toBe("");
  expect(await readFile(journalPath, "utf8")).toBe(beforeInvalidJournal);

  const recorded = await recordEvidence(cwd, task.id, {
    kind: "tdd-red",
    summary: "Regression assertion failed before implementation",
    command: "npm test -- regression",
    exitCode: 1,
    result: "fail",
  });
  expect(recorded.exitCode).toBe(0);
  expect(recorded.stderr).toBe("");
  expect(JSON.parse(recorded.stdout)).toMatchObject({
    schemaVersion: 1,
    id: expect.any(String),
    kind: "tdd-red",
    summary: "Regression assertion failed before implementation",
    command: "npm test -- regression",
    exitCode: 1,
    result: "fail",
    actor: "cli",
    recordedAt: expect.any(String),
  });
  expect(JSON.parse(recorded.stdout)).not.toHaveProperty("output");
  const journal = parseJsonl(await readFile(journalPath, "utf8"));
  expect(journal.at(-1)).toMatchObject({
    type: "evidence_recorded",
    mutationKind: "evidence_recorded",
    operationId: expect.any(String),
    actor: "cli",
    timestamp: expect.any(String),
    evidenceId: JSON.parse(recorded.stdout).id,
    evidenceKind: "tdd-red",
  });
  expect(journal.at(-1)).not.toHaveProperty("summary");
  expect(journal.at(-1)).not.toHaveProperty("command");

  const beforeContradiction = await readFile(evidencePath, "utf8");
  const beforeContradictionJournal = await readFile(journalPath, "utf8");
  const contradictoryGreen = await recordEvidence(cwd, task.id, {
    kind: "tdd-green",
    summary: "Green command still failed",
    command: "npm test -- regression",
    exitCode: 2,
    result: "pass",
  });
  expect(contradictoryGreen.exitCode).toBe(1);
  expect(await readFile(evidencePath, "utf8")).toBe(beforeContradiction);
  expect(await readFile(journalPath, "utf8")).toBe(beforeContradictionJournal);
});

test("a TDD checking gate requires a valid red record before a valid green and leaves transition state durable on failure", async () => {
  const { cwd, task } = await initializedTask("Ordered TDD evidence", "tdd");
  await prepareInProgressTask(cwd, task);
  const taskDirectory = join(cwd, ".vinea", "tasks", "active", task.id);
  const journalPath = join(taskDirectory, "journal.md");

  expect((await recordEvidence(cwd, task.id, {
    kind: "tdd-green",
    summary: "The focused test passes",
    command: "npm test -- focused",
    exitCode: 0,
    result: "pass",
  })).exitCode).toBe(0);
  const beforeGreenOnly = await readFile(journalPath, "utf8");
  const greenOnly = await transitionToChecking(cwd, task.id);
  expect(greenOnly.exitCode).toBe(1);
  expect(JSON.parse(greenOnly.stdout)).toMatchObject({
    error: { code: "VINEA_TRANSITION_INVALID" },
  });
  expect(await readFile(journalPath, "utf8")).toBe(beforeGreenOnly);
  expect((await showTask(cwd, task.id)).status).toBe("in_progress");

  expect((await recordEvidence(cwd, task.id, {
    kind: "tdd-red",
    summary: "The focused test fails before the fix",
    command: "npm test -- focused",
    exitCode: 1,
    result: "fail",
  })).exitCode).toBe(0);
  const redAfterGreen = await transitionToChecking(cwd, task.id);
  expect(redAfterGreen.exitCode).toBe(1);
  expect((await showTask(cwd, task.id)).status).toBe("in_progress");

  expect((await recordEvidence(cwd, task.id, {
    kind: "tdd-green",
    summary: "The focused test passes after the fix",
    command: "npm test -- focused",
    exitCode: 0,
    result: "pass",
  })).exitCode).toBe(0);
  const checking = await transitionToChecking(cwd, task.id);
  expect(checking.exitCode).toBe(0);
  expect((JSON.parse(checking.stdout) as TaskRecord).status).toBe("checking");
  expect(parseJsonl(await readFile(journalPath, "utf8")).at(-1)).toMatchObject({
    type: "transition_intent",
    oldStatus: "in_progress",
    newStatus: "checking",
  });
});

test("standard quality tasks may enter checking without TDD red or green evidence", async () => {
  const { cwd, task } = await initializedTask("Standard evidence", "standard");
  await prepareInProgressTask(cwd, task);

  const checking = await transitionToChecking(cwd, task.id);

  expect(checking.exitCode).toBe(0);
  expect((JSON.parse(checking.stdout) as TaskRecord).status).toBe("checking");
  expect(await readFile(evidenceArtifact(cwd, task.id), "utf8")).toBe("");
});

test("malformed minimal red and green objects cannot satisfy the TDD checking gate", async () => {
  const { cwd, task } = await initializedTask("Reject malformed evidence", "tdd");
  await prepareInProgressTask(cwd, task);
  const evidencePath = evidenceArtifact(cwd, task.id);
  const journalPath = journalArtifact(cwd, task.id);
  await writeFile(
    evidencePath,
    [
      JSON.stringify({ schemaVersion: 1, kind: "tdd-red", result: "fail", exitCode: 1 }),
      JSON.stringify({ schemaVersion: 1, kind: "tdd-green", result: "pass", exitCode: 0 }),
      "",
    ].join("\n"),
    "utf8",
  );
  const beforeJournal = await readFile(journalPath, "utf8");

  const result = await transitionToChecking(cwd, task.id);

  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    error: { code: "VINEA_SCHEMA_INVALID" },
  });
  expect((await showTask(cwd, task.id)).status).toBe("in_progress");
  expect(await readFile(journalPath, "utf8")).toBe(beforeJournal);
});

test("evidence summaries reject oversized audit payloads before append", async () => {
  const { cwd, task } = await initializedTask("Bound evidence", "standard");
  const evidencePath = evidenceArtifact(cwd, task.id);
  const journalPath = journalArtifact(cwd, task.id);
  const beforeJournal = await readFile(journalPath, "utf8");

  const result = await recordEvidence(cwd, task.id, {
    kind: "manual",
    summary: "x".repeat(2001),
    result: "pass",
  });

  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    error: { code: "VINEA_VALIDATION_INVALID" },
  });
  expect(await readFile(evidencePath, "utf8")).toBe("");
  expect(await readFile(journalPath, "utf8")).toBe(beforeJournal);
});

async function initializedTask(
  title: string,
  qualityMode: "standard" | "tdd",
): Promise<{ cwd: string; task: TaskRecord }> {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const proposed = await runCli([
    "propose",
    "--title", title,
    "--description", "Exercise evidence gates",
    "--risk", "low",
    "--quality", qualityMode,
    "--execution", "single-agent",
    "--confirmed",
    "--json",
  ], cwd);
  expect(proposed.exitCode).toBe(0);
  return { cwd, task: JSON.parse(proposed.stdout) as TaskRecord };
}

async function prepareInProgressTask(cwd: string, task: TaskRecord): Promise<void> {
  await writeFile(join(cwd, "brief-source.md"), "# Brief\n\nVerify quality evidence.\n", "utf8");
  await writeFile(join(cwd, "plan-source.md"), "# Plan\n\n1. Test the change.\n", "utf8");
  expect((await runCli([
    "task", "require", task.id,
    "--id", "R1",
    "--text", "Evidence is recorded",
    "--json",
  ], cwd)).exitCode).toBe(0);
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
  expect((await runCli([
    "task", "transition", task.id,
    "--to", "ready",
    "--reason", "Planning complete",
    "--json",
  ], cwd)).exitCode).toBe(0);
  expect((await runCli([
    "task", "transition", task.id,
    "--to", "in_progress",
    "--reason", "Start implementation",
    "--json",
  ], cwd)).exitCode).toBe(0);
}

function recordEvidence(
  cwd: string,
  taskId: string,
  input: {
    kind: "command" | "manual" | "tdd-red" | "tdd-green";
    summary: string;
    command?: string;
    exitCode?: number;
    result?: "pass" | "fail";
  },
) {
  const args = [
    "evidence", "record", taskId,
    "--kind", input.kind,
    "--summary", input.summary,
  ];
  if (input.command !== undefined) args.push("--command", input.command);
  if (input.exitCode !== undefined) args.push("--exit-code", String(input.exitCode));
  if (input.result !== undefined) args.push("--result", input.result);
  args.push("--json");
  return runCli(args, cwd);
}

function transitionToChecking(cwd: string, taskId: string) {
  return runCli([
    "task", "transition", taskId,
    "--to", "checking",
    "--reason", "Begin checks",
    "--json",
  ], cwd);
}

async function showTask(cwd: string, taskId: string): Promise<TaskRecord> {
  const result = await runCli(["task", "show", taskId, "--json"], cwd);
  return JSON.parse(result.stdout) as TaskRecord;
}

function evidenceArtifact(cwd: string, taskId: string): string {
  return join(cwd, ".vinea", "tasks", "active", taskId, "evidence.jsonl");
}

function journalArtifact(cwd: string, taskId: string): string {
  return join(cwd, ".vinea", "tasks", "active", taskId, "journal.md");
}

function parseJsonl(contents: string): Array<Record<string, unknown>> {
  return contents.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}
