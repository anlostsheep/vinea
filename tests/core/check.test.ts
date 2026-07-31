import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import type { TaskRecord } from "../../src/core/types.js";
import { createTempRepo, runCli } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("check upserts one authoritative row and renders stable machine and human summaries", async () => {
  const { cwd, task } = await initializedTask();
  const evidence = await recordPassingEvidence(cwd, task.id, "Focused check passed");

  const first = await runCli([
    "check", task.id,
    "--requirement", "R1",
    "--plan-item", "Implement | verify",
    "--paths", "src/core/check.ts,tests/core/check.test.ts",
    "--evidence", evidence.id,
    "--result", "pass",
    "--summary", "Covered by focused test",
    "--json",
  ], cwd);
  expect(first.exitCode).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({
    taskId: task.id,
    rows: [{
      requirementId: "R1",
      planItem: "Implement | verify",
      paths: ["src/core/check.ts", "tests/core/check.test.ts"],
      evidenceIds: [evidence.id],
      result: "pass",
      summary: "Covered by focused test",
    }],
    totals: { total: 1, pass: 1, fail: 0, uncovered: 0 },
  });

  const updated = await runCli([
    "check", task.id,
    "--requirement", "R1",
    "--plan-item", "Implement and verify",
    "--paths", "src/core/check.ts",
    "--evidence", evidence.id,
    "--result", "pass",
    "--summary", "Updated focused coverage",
    "--json",
  ], cwd);
  expect(updated.exitCode).toBe(0);
  expect(JSON.parse(updated.stdout)).toMatchObject({
    rows: [{
      requirementId: "R1",
      planItem: "Implement and verify",
      paths: ["src/core/check.ts"],
      evidenceIds: [evidence.id],
      result: "pass",
      summary: "Updated focused coverage",
    }],
    totals: { total: 1, pass: 1, fail: 0, uncovered: 0 },
  });

  const shown = await runCli(["check", "show", task.id, "--json"], cwd);
  expect(shown.exitCode).toBe(0);
  expect(JSON.parse(shown.stdout)).toEqual(JSON.parse(updated.stdout));
  const markdown = await readFile(checkArtifact(cwd, task.id), "utf8");
  expect(markdown).toContain("| Requirement/acceptance ID | Task item | Implementation/change paths | Test/verification evidence | Result | Summary |");
  expect(markdown).toContain("| R1 | Implement and verify | `src/core/check.ts` |");
  expect(markdown.match(/\| R1 \|/g)).toHaveLength(1);
});

test("check rejects absent requirement and evidence IDs, escaping paths, and pass without evidence without changing check.md", async () => {
  const { cwd, task } = await initializedTask();
  const evidence = await recordPassingEvidence(cwd, task.id, "Baseline evidence");
  const checkPath = checkArtifact(cwd, task.id);
  const before = await readFile(checkPath, "utf8");

  const invalidInputs = [
    [
      "--requirement", "R404",
      "--plan-item", "Unknown requirement",
      "--paths", "src/core/check.ts",
      "--evidence", evidence.id,
      "--result", "pass",
      "--summary", "Must be rejected",
    ],
    [
      "--requirement", "R1",
      "--plan-item", "Unknown evidence",
      "--paths", "src/core/check.ts",
      "--evidence", "missing-evidence",
      "--result", "pass",
      "--summary", "Must be rejected",
    ],
    [
      "--requirement", "R1",
      "--plan-item", "Escaping path",
      "--paths", "../outside.ts",
      "--evidence", evidence.id,
      "--result", "pass",
      "--summary", "Must be rejected",
    ],
    [
      "--requirement", "R1",
      "--plan-item", "Windows separator traversal",
      "--paths", "safe\\\\..\\\\outside.ts",
      "--evidence", evidence.id,
      "--result", "pass",
      "--summary", "Must be rejected",
    ],
    [
      "--requirement", "R1",
      "--plan-item", "Windows drive path",
      "--paths", "C:\\\\outside.ts",
      "--evidence", evidence.id,
      "--result", "pass",
      "--summary", "Must be rejected",
    ],
    [
      "--requirement", "R1",
      "--plan-item", "Windows drive slash path",
      "--paths", "C:/outside.ts",
      "--evidence", evidence.id,
      "--result", "pass",
      "--summary", "Must be rejected",
    ],
    [
      "--requirement", "R1",
      "--plan-item", "Windows drive relative path",
      "--paths", "C:outside.ts",
      "--evidence", evidence.id,
      "--result", "pass",
      "--summary", "Must be rejected",
    ],
    [
      "--requirement", "R1",
      "--plan-item", "UNC path",
      "--paths", "\\\\\\\\server\\\\share\\\\outside.ts",
      "--evidence", evidence.id,
      "--result", "pass",
      "--summary", "Must be rejected",
    ],
    [
      "--requirement", "R1",
      "--plan-item", "No proof",
      "--paths", "src/core/check.ts",
      "--result", "pass",
      "--summary", "Must be rejected",
    ],
  ];

  for (const input of invalidInputs) {
    const result = await runCli(["check", task.id, ...input, "--json"], cwd);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: "VINEA_VALIDATION_INVALID" },
    });
    expect(await readFile(checkPath, "utf8")).toBe(before);
  }
});

async function initializedTask(): Promise<{ cwd: string; task: TaskRecord }> {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const proposal = await runCli([
    "propose",
    "--title", "Check matrix",
    "--description", "Verify requirement coverage",
    "--risk", "low",
    "--quality", "standard",
    "--execution", "single-agent",
    "--confirmed",
    "--json",
  ], cwd);
  expect(proposal.exitCode).toBe(0);
  const task = JSON.parse(proposal.stdout) as TaskRecord;
  expect((await runCli([
    "task", "require", task.id,
    "--id", "R1",
    "--text", "The check matrix is durable",
    "--json",
  ], cwd)).exitCode).toBe(0);
  expect((await runCli([
    "task", "accept", task.id,
    "--id", "A1",
    "--text", "Human and JSON summaries agree",
    "--json",
  ], cwd)).exitCode).toBe(0);
  return { cwd, task };
}

async function recordPassingEvidence(
  cwd: string,
  taskId: string,
  summary: string,
): Promise<{ id: string }> {
  const result = await runCli([
    "evidence", "record", taskId,
    "--kind", "command",
    "--summary", summary,
    "--command", "npm test -- focused",
    "--exit-code", "0",
    "--result", "pass",
    "--json",
  ], cwd);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as { id: string };
}

function checkArtifact(cwd: string, taskId: string): string {
  return join(cwd, ".vinea", "tasks", "active", taskId, "check.md");
}
