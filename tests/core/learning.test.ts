import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import type { EvidenceRecord, LearningCandidate, TaskRecord } from "../../src/core/types.js";
import { createTempRepo, readJson, runCli, writeJson } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("learning propose stores a task-local candidate and rejects invalid or terminal mutations without touching specs", async () => {
  const cwd = await initializedRepo();
  const task = await createTask(cwd, "Propose durable learning");
  const taskDirectory = activeTaskDirectory(cwd, task.id);
  const specsDirectory = join(cwd, ".vinea", "specs");
  const specsBefore = await snapshotDirectory(specsDirectory);

  const proposed = await proposeLearning(cwd, task.id, {
    id: "L1",
    domain: "testing-practice",
    text: "Keep completion gates fail closed.",
    rationale: "This rule applies to every task completion workflow.",
  });

  expect(proposed.exitCode).toBe(0);
  expect(proposed.stderr).toBe("");
  const stored = await readJson<TaskRecord>(join(taskDirectory, "task.json"));
  expect(stored.learningCandidates).toEqual([{
    schemaVersion: 1,
    id: "L1",
    domain: "testing-practice",
    text: "Keep completion gates fail closed.",
    rationale: "This rule applies to every task completion workflow.",
    status: "proposed",
    proposedAt: expect.any(String),
  }]);
  expect(await snapshotDirectory(specsDirectory)).toEqual(specsBefore);
  expect(parseJsonl(await readFile(join(taskDirectory, "journal.md"), "utf8")).at(-1)).toMatchObject({
    type: "learning_proposed",
    mutationKind: "learning_proposed",
    operationId: expect.any(String),
    learningCandidateId: "L1",
    actor: "cli",
    timestamp: expect.any(String),
  });

  const taskBeforeRejected = await readFile(join(taskDirectory, "task.json"), "utf8");
  const journalBeforeRejected = await readFile(join(taskDirectory, "journal.md"), "utf8");
  const rejected = [
    await proposeLearning(cwd, task.id, {
      id: "L1",
      domain: "testing-practice",
      text: "A duplicate identifier.",
      rationale: "Duplicate identifiers are ambiguous.",
    }),
    await proposeLearning(cwd, task.id, {
      id: "L2",
      domain: "../testing",
      text: "An unsafe domain.",
      rationale: "Unsafe paths must be rejected.",
    }),
    await proposeLearning(cwd, task.id, {
      id: "L3",
      domain: "testing",
      text: "A missing rationale.",
      rationale: " ",
    }),
    await proposeLearning(cwd, task.id, {
      id: "L4",
      domain: "testing",
      text: "x".repeat(501),
      rationale: "Rules are capped at 500 characters.",
    }),
    await proposeLearning(cwd, task.id, {
      id: "L5",
      domain: "testing",
      text: "A bounded rationale.",
      rationale: "x".repeat(1001),
    }),
  ];
  expect(rejected.map(({ exitCode }) => exitCode)).toEqual([1, 1, 2, 1, 1]);
  expect(await readFile(join(taskDirectory, "task.json"), "utf8")).toBe(taskBeforeRejected);
  expect(await readFile(join(taskDirectory, "journal.md"), "utf8")).toBe(journalBeforeRejected);
  expect(await snapshotDirectory(specsDirectory)).toEqual(specsBefore);

  await writeJson(join(taskDirectory, "task.json"), { ...stored, status: "finished" });
  const terminalBefore = await readFile(join(taskDirectory, "task.json"), "utf8");
  const terminalJournalBefore = await readFile(join(taskDirectory, "journal.md"), "utf8");
  const terminal = await proposeLearning(cwd, task.id, {
    id: "L6",
    domain: "testing",
    text: "Terminal tasks stay immutable.",
    rationale: "Completion state must not drift.",
  });
  expect(terminal.exitCode).toBe(1);
  expect(await readFile(join(taskDirectory, "task.json"), "utf8")).toBe(terminalBefore);
  expect(await readFile(join(taskDirectory, "journal.md"), "utf8")).toBe(terminalJournalBefore);
  expect(await snapshotDirectory(specsDirectory)).toEqual(specsBefore);
});

test("learning accept requires literal user confirmation and promotes one normalized dated rule exactly once", async () => {
  const cwd = await initializedRepo();
  const task = await createTask(cwd, "Accept reusable learning");
  const taskDirectory = activeTaskDirectory(cwd, task.id);
  const specPath = join(cwd, ".vinea", "specs", "testing-practice.md");
  const indexPath = join(cwd, ".vinea", "specs", "index.md");

  expect((await proposeLearning(cwd, task.id, {
    id: "L1",
    domain: "testing-practice",
    text: "  Keep   completion\n gates\tfail closed.  ",
    rationale: "This is reusable across completion workflows.",
  })).exitCode).toBe(0);

  const beforeConfirmation = await readFile(join(taskDirectory, "task.json"), "utf8");
  const missingConfirmation = await runCli([
    "learning", "accept", task.id,
    "--id", "L1",
    "--json",
  ], cwd);
  const wrongConfirmation = await runCli([
    "learning", "accept", task.id,
    "--id", "L1",
    "--confirmed-by", "model",
    "--json",
  ], cwd);
  expect([missingConfirmation.exitCode, wrongConfirmation.exitCode]).toEqual([2, 2]);
  expect(await readFile(join(taskDirectory, "task.json"), "utf8")).toBe(beforeConfirmation);
  await expect(readFile(specPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

  const accepted = await runCli([
    "learning", "accept", task.id,
    "--id", "L1",
    "--confirmed-by", "user",
    "--json",
  ], cwd);
  expect(accepted.exitCode).toBe(0);
  const stored = await readJson<TaskRecord>(join(taskDirectory, "task.json"));
  const candidate = stored.learningCandidates?.[0];
  expect(candidate).toMatchObject({
    id: "L1",
    status: "accepted",
    confirmedBy: "user",
    acceptedAt: expect.any(String),
  });
  const date = candidate!.acceptedAt!.slice(0, 10);
  expect(await readFile(specPath, "utf8")).toBe(
    `# testing-practice\n\n- ${date}: Keep completion gates fail closed.\n`,
  );
  expect(await readFile(indexPath, "utf8")).toBe(
    "# Vinea Specs\n\n## Indexed specs\n\n- [testing-practice](testing-practice.md)\n",
  );
  expect(parseJsonl(await readFile(join(taskDirectory, "journal.md"), "utf8")).at(-1)).toMatchObject({
    type: "learning_accepted",
    mutationKind: "learning_accepted",
    learningCandidateId: "L1",
    confirmedBy: "user",
    actor: "cli",
  });

  expect((await proposeLearning(cwd, task.id, {
    id: "L2",
    domain: "testing-practice",
    text: "Keep completion gates   fail\nclosed.",
    rationale: "The same rule must not be promoted twice.",
  })).exitCode).toBe(0);
  const beforeDuplicateTask = await readFile(join(taskDirectory, "task.json"), "utf8");
  const beforeDuplicateJournal = await readFile(join(taskDirectory, "journal.md"), "utf8");
  const beforeDuplicateSpec = await readFile(specPath, "utf8");
  const beforeDuplicateIndex = await readFile(indexPath, "utf8");
  const duplicate = await runCli([
    "learning", "accept", task.id,
    "--id", "L2",
    "--confirmed-by", "user",
    "--json",
  ], cwd);
  expect(duplicate.exitCode).toBe(1);
  expect(JSON.parse(duplicate.stdout)).toMatchObject({
    error: {
      code: "VINEA_VALIDATION_INVALID",
      message: expect.stringContaining("already exists"),
    },
  });
  expect(await readFile(join(taskDirectory, "task.json"), "utf8")).toBe(beforeDuplicateTask);
  expect(await readFile(join(taskDirectory, "journal.md"), "utf8")).toBe(beforeDuplicateJournal);
  expect(await readFile(specPath, "utf8")).toBe(beforeDuplicateSpec);
  expect(await readFile(indexPath, "utf8")).toBe(beforeDuplicateIndex);
});

test("concurrent confirmed accepts are repository-serialized without losing either candidate or rule", async () => {
  const cwd = await initializedRepo();
  const task = await createTask(cwd, "Serialize concurrent learning");
  for (const candidate of [
    {
      id: "L1",
      domain: "testing-practice",
      text: "Keep the first concurrent rule.",
      rationale: "The first rule is reusable.",
    },
    {
      id: "L2",
      domain: "testing-practice",
      text: "Keep the second concurrent rule.",
      rationale: "The second rule is reusable.",
    },
  ]) {
    expect((await proposeLearning(cwd, task.id, candidate)).exitCode).toBe(0);
  }

  const lockPath = join(cwd, ".vinea", ".runtime", "learning-promotion.lock");
  await mkdir(lockPath);
  const accepts = ["L1", "L2"].map((id) => runCli([
    "learning", "accept", task.id,
    "--id", id,
    "--confirmed-by", "user",
    "--json",
  ], cwd));
  try {
    const state = await Promise.race([
      Promise.all(accepts).then(() => "settled"),
      delay(250).then(() => "waiting"),
    ]);
    expect(state).toBe("waiting");
  } finally {
    await rmdir(lockPath);
  }

  const results = await Promise.all(accepts);
  expect(results.map(({ exitCode }) => exitCode)).toEqual([0, 0]);
  const stored = await readJson<TaskRecord>(join(activeTaskDirectory(cwd, task.id), "task.json"));
  expect(stored.learningCandidates?.map(({ id, status }) => ({ id, status }))).toEqual([
    { id: "L1", status: "accepted" },
    { id: "L2", status: "accepted" },
  ]);
  const spec = await readFile(join(cwd, ".vinea", "specs", "testing-practice.md"), "utf8");
  expect(spec).toContain("Keep the first concurrent rule.");
  expect(spec).toContain("Keep the second concurrent rule.");
  const index = await readFile(join(cwd, ".vinea", "specs", "index.md"), "utf8");
  expect(index.match(/\]\(testing-practice\.md\)/gu)).toHaveLength(1);
});

test("spec index membership ignores display labels and pre-existing duplicate targets fail before mutation", async () => {
  const cwd = await initializedRepo();
  const task = await createTask(cwd, "Normalize spec index identity");
  const taskDirectory = activeTaskDirectory(cwd, task.id);
  const indexPath = join(cwd, ".vinea", "specs", "index.md");
  const specPath = join(cwd, ".vinea", "specs", "testing-practice.md");
  await writeFile(
    indexPath,
    "# Vinea Specs\n\n## Indexed specs\n\n- [Testing practice](testing-practice.md \"Reusable rules\")\n",
    "utf8",
  );
  expect((await proposeLearning(cwd, task.id, {
    id: "L1",
    domain: "testing-practice",
    text: "Treat the spec target as its identity.",
    rationale: "Display labels may be customized by maintainers.",
  })).exitCode).toBe(0);

  const accepted = await runCli([
    "learning", "accept", task.id,
    "--id", "L1",
    "--confirmed-by", "user",
    "--json",
  ], cwd);
  expect(accepted.exitCode).toBe(0);
  expect(await readFile(indexPath, "utf8")).toBe(
    "# Vinea Specs\n\n## Indexed specs\n\n- [Testing practice](testing-practice.md \"Reusable rules\")\n",
  );

  expect((await proposeLearning(cwd, task.id, {
    id: "L2",
    domain: "testing-practice",
    text: "Reject an ambiguous duplicate index target.",
    rationale: "Promotion must not guess which duplicate entry is authoritative.",
  })).exitCode).toBe(0);
  await writeFile(
    indexPath,
    [
      "# Vinea Specs",
      "",
      "## Indexed specs",
      "",
      "- [Testing practice](testing-practice.md \"Reusable rules\")",
      "- [Parenthesized title](testing-practice.md (Reusable rules))",
      "- [Duplicate label](./testing-practice.md)",
      "",
    ].join("\n"),
    "utf8",
  );
  const beforeTask = await readFile(join(taskDirectory, "task.json"), "utf8");
  const beforeJournal = await readFile(join(taskDirectory, "journal.md"), "utf8");
  const beforeSpec = await readFile(specPath, "utf8");
  const beforeIndex = await readFile(indexPath, "utf8");
  const duplicateTarget = await runCli([
    "learning", "accept", task.id,
    "--id", "L2",
    "--confirmed-by", "user",
    "--json",
  ], cwd);
  expect(duplicateTarget.exitCode).toBe(1);
  expect(JSON.parse(duplicateTarget.stdout)).toMatchObject({
    error: {
      code: "VINEA_VALIDATION_INVALID",
      message: expect.stringContaining("duplicate"),
    },
  });
  expect(await readFile(join(taskDirectory, "task.json"), "utf8")).toBe(beforeTask);
  expect(await readFile(join(taskDirectory, "journal.md"), "utf8")).toBe(beforeJournal);
  expect(await readFile(specPath, "utf8")).toBe(beforeSpec);
  expect(await readFile(indexPath, "utf8")).toBe(beforeIndex);
});

test("learning archive classifies the candidate locally with a reason and never modifies specs", async () => {
  const cwd = await initializedRepo();
  const task = await createTask(cwd, "Archive task-specific learning");
  const specsDirectory = join(cwd, ".vinea", "specs");
  expect((await proposeLearning(cwd, task.id, {
    id: "L1",
    domain: "testing",
    text: "Use the temporary fixture identifier.",
    rationale: "This may only apply to the current fixture.",
  })).exitCode).toBe(0);
  const specsBefore = await snapshotDirectory(specsDirectory);
  const taskPath = join(activeTaskDirectory(cwd, task.id), "task.json");
  const beforeMissingReason = await readFile(taskPath, "utf8");

  const missingReason = await runCli([
    "learning", "archive", task.id,
    "--id", "L1",
    "--reason", " ",
    "--json",
  ], cwd);
  expect(missingReason.exitCode).toBe(2);
  expect(await readFile(taskPath, "utf8")).toBe(beforeMissingReason);

  const archived = await runCli([
    "learning", "archive", task.id,
    "--id", "L1",
    "--reason", "Only useful for this task",
    "--json",
  ], cwd);
  expect(archived.exitCode).toBe(0);
  const stored = await readJson<TaskRecord>(taskPath);
  expect(stored.learningCandidates?.[0]).toMatchObject({
    id: "L1",
    status: "archived",
    archiveReason: "Only useful for this task",
    archivedAt: expect.any(String),
  });
  expect(await snapshotDirectory(specsDirectory)).toEqual(specsBefore);
});

test("archiving the last proposed learning makes the existing finish gate eligible", async () => {
  const fixture = await createCheckingTask();
  expect((await proposeLearning(fixture.cwd, fixture.task.id, {
    id: "L1",
    domain: "testing",
    text: "Keep a fixture-only command.",
    rationale: "The command is not reusable beyond this task.",
  })).exitCode).toBe(0);
  await coverTask(fixture);

  const blocked = await runCli(["finish", fixture.task.id, "--confirmed", "--json"], fixture.cwd);
  expect(blocked.exitCode).toBe(1);
  expect(JSON.parse(blocked.stdout)).toMatchObject({
    error: {
      code: "VINEA_FINISH_GATE_FAILED",
      message: expect.stringContaining("learning"),
    },
  });

  expect((await runCli([
    "learning", "archive", fixture.task.id,
    "--id", "L1",
    "--reason", "Task-specific fixture detail",
    "--json",
  ], fixture.cwd)).exitCode).toBe(0);
  const finished = await runCli(["finish", fixture.task.id, "--confirmed", "--json"], fixture.cwd);
  expect(finished.exitCode).toBe(0);
  expect((JSON.parse(finished.stdout) as TaskRecord).status).toBe("finished");
});

interface ProposeLearningInput {
  id: string;
  domain: string;
  text: string;
  rationale: string;
}

interface CheckingFixture {
  cwd: string;
  task: TaskRecord;
  passingEvidence: EvidenceRecord;
}

async function initializedRepo(): Promise<string> {
  const cwd = await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  return cwd;
}

async function createTask(cwd: string, title: string): Promise<TaskRecord> {
  const result = await runCli([
    "propose",
    "--title", title,
    "--description", "Exercise controlled learning promotion",
    "--risk", "low",
    "--quality", "standard",
    "--execution", "single-agent",
    "--confirmed",
    "--json",
  ], cwd);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as TaskRecord;
}

function proposeLearning(cwd: string, taskId: string, input: ProposeLearningInput) {
  return runCli([
    "learning", "propose", taskId,
    "--id", input.id,
    "--domain", input.domain,
    "--text", input.text,
    "--rationale", input.rationale,
    "--json",
  ], cwd);
}

async function createCheckingTask(): Promise<CheckingFixture> {
  const cwd = await initializedRepo();
  const task = await createTask(cwd, "Finish archived learning");
  expect((await runCli([
    "task", "require", task.id,
    "--id", "R1",
    "--text", "Implementation is verified",
    "--json",
  ], cwd)).exitCode).toBe(0);
  expect((await runCli([
    "task", "accept", task.id,
    "--id", "A1",
    "--text", "Completion gates reject unsafe finish",
    "--json",
  ], cwd)).exitCode).toBe(0);
  await writeFile(join(cwd, "brief.md"), "# Brief\n\nVerify completion.\n", "utf8");
  await writeFile(join(cwd, "plan.md"), "# Plan\n\n1. Verify completion.\n", "utf8");
  expect((await runCli([
    "task", "set-brief", task.id, "--file", "brief.md", "--json",
  ], cwd)).exitCode).toBe(0);
  expect((await runCli([
    "task", "set-plan", task.id, "--file", "plan.md", "--json",
  ], cwd)).exitCode).toBe(0);
  await unlink(join(cwd, "brief.md"));
  await unlink(join(cwd, "plan.md"));
  expect((await transition(cwd, task.id, "ready")).exitCode).toBe(0);
  expect((await transition(cwd, task.id, "in_progress")).exitCode).toBe(0);
  const evidenceResult = await runCli([
    "evidence", "record", task.id,
    "--kind", "command",
    "--summary", "Focused verification passed",
    "--command", "npm test -- focused",
    "--exit-code", "0",
    "--result", "pass",
    "--json",
  ], cwd);
  expect(evidenceResult.exitCode).toBe(0);
  expect((await transition(cwd, task.id, "checking")).exitCode).toBe(0);
  return {
    cwd,
    task,
    passingEvidence: JSON.parse(evidenceResult.stdout) as EvidenceRecord,
  };
}

function transition(cwd: string, taskId: string, status: TaskRecord["status"]) {
  return runCli([
    "task", "transition", taskId,
    "--to", status,
    "--reason", `Move to ${status}`,
    "--json",
  ], cwd);
}

async function coverTask(fixture: CheckingFixture): Promise<void> {
  for (const requirementId of ["R1", "A1"]) {
    const result = await runCli([
      "check", fixture.task.id,
      "--requirement", requirementId,
      "--plan-item", `Verify ${requirementId}`,
      "--paths", "src/core/learning.ts",
      "--evidence", fixture.passingEvidence.id,
      "--result", "pass",
      "--summary", `${requirementId} passes`,
      "--json",
    ], fixture.cwd);
    expect(result.exitCode).toBe(0);
  }
}

async function snapshotDirectory(directory: string): Promise<Record<string, string>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const snapshot: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.isFile()) snapshot[entry.name] = await readFile(join(directory, entry.name), "utf8");
  }
  return snapshot;
}

function activeTaskDirectory(cwd: string, taskId: string): string {
  return join(cwd, ".vinea", "tasks", "active", taskId);
}

function parseJsonl(contents: string): Array<Record<string, unknown>> {
  return contents.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
