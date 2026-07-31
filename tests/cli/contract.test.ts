import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import type { CheckRow, EvidenceRecord, OrientSummary, TaskRecord } from "../../src/core/types.js";
import type { ValidationReport } from "../../src/core/validate.js";
import { createTempRepo, git, runCli } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("the public CLI completes and reopens one archived TDD task as machine-readable JSON", async () => {
  const cwd = await createTempRepo();
  await writeFile(join(cwd, "brief-source.md"), "# Brief\n\nChange observable behavior safely.\n", "utf8");
  await writeFile(join(cwd, "plan-source.md"), "# Plan\n\n1. Add a failing test.\n2. Implement and verify.\n", "utf8");
  await writeFile(join(cwd, "feature.ts"), "export const behavior = 'green';\n", "utf8");
  expect((await git(cwd, ["add", "brief-source.md", "plan-source.md", "feature.ts"])).exitCode).toBe(0);
  expect((await git(cwd, [
    "-c", "user.name=Vinea Test",
    "-c", "user.email=vinea@example.invalid",
    "commit", "-m", "seed fixture",
  ])).exitCode).toBe(0);

  const initialized = await runJson(["init", "--json"], cwd);
  expect(initialized).toEqual({ initialized: true });

  const task = await runJson<TaskRecord>([
    "propose",
    "--title", "Change fixture behavior",
    "--description", "Implement a cross-file behavior change",
    "--risk", "auto",
    "--quality", "tdd",
    "--execution", "single-agent",
    "--confirmed",
    "--json",
  ], cwd);
  expect(task).toMatchObject({
    status: "planning",
    risk: { level: "medium", reasons: expect.arrayContaining(["behavior", "cross-file"]) },
    qualityMode: "tdd",
  });

  for (const command of [
    ["task", "require", task.id, "--id", "R1", "--text", "The behavior is verified", "--json"],
    ["task", "accept", task.id, "--id", "A1", "--text", "The focused test passes", "--json"],
    ["task", "set-brief", task.id, "--file", "brief-source.md", "--json"],
    ["task", "set-plan", task.id, "--file", "plan-source.md", "--json"],
    ["context", "add", task.id, "--path", "feature.ts", "--purpose", "Implementation target", "--json"],
  ]) {
    await runJson(command, cwd);
  }

  const red = await runJson<EvidenceRecord>([
    "evidence", "record", task.id,
    "--kind", "tdd-red",
    "--summary", "The focused test failed before implementation",
    "--command", "npm test -- feature",
    "--exit-code", "1",
    "--result", "fail",
    "--json",
  ], cwd);
  const green = await runJson<EvidenceRecord>([
    "evidence", "record", task.id,
    "--kind", "tdd-green",
    "--summary", "The focused test passed after implementation",
    "--command", "npm test -- feature",
    "--exit-code", "0",
    "--result", "pass",
    "--json",
  ], cwd);
  expect([red.kind, green.kind]).toEqual(["tdd-red", "tdd-green"]);

  for (const [to, reason] of [
    ["ready", "Planning artifacts are complete"],
    ["in_progress", "Begin the confirmed implementation"],
    ["checking", "Implementation and TDD evidence are complete"],
  ] as const) {
    const transitioned = await runJson<TaskRecord>([
      "task", "transition", task.id,
      "--to", to,
      "--reason", reason,
      "--json",
    ], cwd);
    expect(transitioned.status).toBe(to);
  }

  const check = await runJson<{ rows: CheckRow[] }>([
    "check", task.id,
    "--requirement", "R1",
    "--plan-item", "Implement and verify the fixture behavior",
    "--paths", "feature.ts",
    "--evidence", green.id,
    "--result", "pass",
    "--summary", "The passing TDD evidence covers the behavior",
    "--json",
  ], cwd);
  expect(check.rows).toHaveLength(1);

  const acceptanceCheck = await runJson<{ rows: CheckRow[] }>([
    "check", task.id,
    "--requirement", "A1",
    "--plan-item", "Verify the focused test outcome",
    "--paths", "feature.ts",
    "--evidence", green.id,
    "--result", "pass",
    "--summary", "The passing TDD evidence covers acceptance",
    "--json",
  ], cwd);
  expect(acceptanceCheck.rows).toHaveLength(2);
  const activeHumanTask = await runCli(["task", "show", task.id], cwd);
  expect(activeHumanTask.exitCode).toBe(0);
  expect(activeHumanTask.stdout).toContain("incomplete requirements: none");

  await runJson([
    "learning", "propose", task.id,
    "--id", "L1",
    "--domain", "fixture",
    "--text", "Keep this fixture-only sequence local.",
    "--rationale", "It is not a reusable project rule.",
    "--json",
  ], cwd);
  await runJson([
    "learning", "archive", task.id,
    "--id", "L1",
    "--reason", "Task-specific fixture detail",
    "--json",
  ], cwd);

  expect((await runJson<TaskRecord>(["finish", task.id, "--confirmed", "--json"], cwd)).status).toBe("finished");
  expect((await runJson<TaskRecord>(["archive", task.id, "--confirmed", "--json"], cwd)).status).toBe("archived");

  const orient = await runJson<OrientSummary>(["orient", "--host", "codex", "--json"], cwd);
  expect(orient).toMatchObject({ candidates: [], recommendation: "no-active-task" });
  const shown = await runJson<TaskRecord>(["task", "show", task.id, "--json"], cwd);
  expect(shown).toMatchObject({ id: task.id, status: "archived" });
  const shownCheck = await runJson<{ taskId: string; rows: CheckRow[] }>([
    "check", "show", task.id, "--json",
  ], cwd);
  expect(shownCheck).toMatchObject({
    taskId: task.id,
    rows: [
      { requirementId: "R1", result: "pass" },
      { requirementId: "A1", result: "pass" },
    ],
  });
  const validation = await runJson<ValidationReport>(["validate", "--json"], cwd);
  expect(validation).toEqual({ issues: [] });
});

async function runJson<T = unknown>(args: string[], cwd: string): Promise<T> {
  const result = await runCli(args, cwd);
  expect(result.exitCode, `${args.join(" ")}\n${result.stderr}\n${result.stdout}`).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim()).not.toBe("");
  expect(() => JSON.parse(result.stdout)).not.toThrow();
  return JSON.parse(result.stdout) as T;
}
