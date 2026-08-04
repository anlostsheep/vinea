import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import type { TaskRecord } from "../../src/core/types.js";
import { createTempRepo, runCli } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("task rework exposes one revision-scoped history snapshot through JSON and human CLI output", async () => {
  const { cwd, task } = await createCheckingTask();
  const checkingView = await runCli(["task", "show", task.id, "--json"], cwd);
  expect(checkingView.exitCode).toBe(0);
  expect(JSON.parse(checkingView.stdout)).toMatchObject({
    id: task.id,
    verificationRevision: 0,
    failedOrUncoveredIds: ["R1"],
    reworkEligible: true,
    nextAction: "task rework",
  });
  const reworked = await runCli([
    "task", "rework", task.id,
    "--reason", "Repair the failed requirement before continuing implementation.",
    "--json",
  ], cwd);

  expect(reworked.exitCode).toBe(0);
  expect(JSON.parse(reworked.stdout)).toMatchObject({
    id: task.id,
    status: "in_progress",
    verificationRevision: 1,
  });

  const list = await runCli(["check", "history", task.id, "--json"], cwd);
  expect(list.exitCode).toBe(0);
  expect(JSON.parse(list.stdout)).toEqual({
    taskId: task.id,
    revisions: [{
      verificationRevision: 0,
      archivedAt: expect.any(String),
      reworkReason: "Repair the failed requirement before continuing implementation.",
      operationId: `rework-${task.id}-r0`,
      totals: { total: 1, pass: 0, fail: 1, uncovered: 0 },
    }],
  });

  const detail = await runCli(["check", "history", task.id, "--revision", "0", "--json"], cwd);
  expect(detail.exitCode).toBe(0);
  expect(JSON.parse(detail.stdout)).toMatchObject({
    taskId: task.id,
    verificationRevision: 0,
    rows: [expect.objectContaining({ requirementId: "R1", result: "fail" })],
  });

  const human = await runCli(["check", "history", task.id], cwd);
  expect(human.exitCode).toBe(0);
  expect(human.stdout).toContain("revision 0");
  expect(human.stdout).toContain("0 pass; 1 fail; 0 uncovered");

  const missing = await runCli(["check", "history", task.id, "--revision", "1", "--json"], cwd);
  expect(missing.exitCode).toBe(1);
  expect(JSON.parse(missing.stdout)).toMatchObject({
    error: { code: "VINEA_VALIDATION_INVALID", message: expect.stringContaining("No check-history snapshot") },
  });
});

async function createCheckingTask(): Promise<{ cwd: string; task: TaskRecord }> {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const proposed = await runCli([
    "propose",
    "--title", "CLI rework history",
    "--description", "Exercise the checked failure loop",
    "--risk", "low",
    "--quality", "standard",
    "--execution", "single-agent",
    "--confirmed",
    "--json",
  ], cwd);
  const task = JSON.parse(proposed.stdout) as TaskRecord;
  await writeFile(join(cwd, "brief-source.md"), "# Brief\n\nRepair a checked failure.\n", "utf8");
  await writeFile(join(cwd, "plan-source.md"), "# Plan\n\n1. Repair and verify.\n", "utf8");
  for (const args of [
    ["task", "require", task.id, "--id", "R1", "--text", "The failed check can be reworked", "--json"],
    ["task", "set-brief", task.id, "--file", "brief-source.md", "--json"],
    ["task", "set-plan", task.id, "--file", "plan-source.md", "--json"],
    ["task", "transition", task.id, "--to", "ready", "--reason", "Plan ready", "--json"],
    ["task", "transition", task.id, "--to", "in_progress", "--reason", "Start work", "--json"],
    ["task", "transition", task.id, "--to", "checking", "--reason", "Begin verification", "--json"],
    [
      "check", task.id,
      "--requirement", "R1",
      "--plan-item", "Exercise the failing path",
      "--paths", "README.md",
      "--result", "fail",
      "--summary", "The requirement still fails.",
      "--json",
    ],
  ]) {
    expect((await runCli(args, cwd)).exitCode).toBe(0);
  }
  return { cwd, task };
}
