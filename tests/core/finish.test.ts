import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import { SchemaError } from "../../src/core/errors.js";
import { resolveVineaPaths } from "../../src/core/paths.js";
import type { EvidenceRecord, LearningCandidate, TaskRecord } from "../../src/core/types.js";
import { archiveTask, readTask } from "../../src/core/workflow.js";
import { createTempRepo, readJson, runCli, writeJson } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("finish blocks missing requirement or acceptance coverage and failed or uncovered check rows", async () => {
  const missingAcceptance = await createCheckingTask();
  await addCheck(
    missingAcceptance.cwd,
    missingAcceptance.task.id,
    "R1",
    missingAcceptance.passingEvidence.id,
    "pass",
  );
  await expectFinishBlocked(missingAcceptance.cwd, missingAcceptance.task.id, "coverage");

  const missingRequirement = await createCheckingTask();
  await addCheck(
    missingRequirement.cwd,
    missingRequirement.task.id,
    "A1",
    missingRequirement.passingEvidence.id,
    "pass",
  );
  await expectFinishBlocked(missingRequirement.cwd, missingRequirement.task.id, "R1");

  const failed = await createCheckingTask();
  await addCheck(failed.cwd, failed.task.id, "R1", failed.passingEvidence.id, "pass");
  await addCheck(failed.cwd, failed.task.id, "A1", failed.failingEvidence.id, "fail");
  await expectFinishBlocked(failed.cwd, failed.task.id, "failed");

  const uncovered = await createCheckingTask();
  await addCheck(uncovered.cwd, uncovered.task.id, "R1", uncovered.passingEvidence.id, "pass");
  await addCheck(uncovered.cwd, uncovered.task.id, "A1", undefined, "uncovered");
  await expectFinishBlocked(uncovered.cwd, uncovered.task.id, "uncovered");

  const onlyFailedEvidence = await createCheckingTask();
  await addCheck(
    onlyFailedEvidence.cwd,
    onlyFailedEvidence.task.id,
    "R1",
    onlyFailedEvidence.passingEvidence.id,
    "pass",
  );
  await addCheck(
    onlyFailedEvidence.cwd,
    onlyFailedEvidence.task.id,
    "A1",
    onlyFailedEvidence.failingEvidence.id,
    "pass",
  );
  await expectFinishBlocked(onlyFailedEvidence.cwd, onlyFailedEvidence.task.id, "passing evidence");
});

test("finish blocks a TDD task whose evidence no longer has red before green", async () => {
  const fixture = await createCheckingTask("tdd");
  await addCheck(fixture.cwd, fixture.task.id, "R1", fixture.passingEvidence.id, "pass");
  await addCheck(fixture.cwd, fixture.task.id, "A1", fixture.passingEvidence.id, "pass");
  await writeFile(
    evidenceArtifact(fixture.cwd, fixture.task.id),
    `${JSON.stringify(fixture.passingEvidence)}\n`,
    "utf8",
  );

  await expectFinishBlocked(fixture.cwd, fixture.task.id, "tdd-red");
});

test("finish blocks business-dirty files but permits .vinea-only changes", async () => {
  const dirty = await createCheckingTask();
  await coverTask(dirty);
  const dirtyPath = "business source\nfile.ts";
  await writeFile(join(dirty.cwd, dirtyPath), "export const dirty = true;\n", "utf8");
  await expectFinishBlocked(dirty.cwd, dirty.task.id, dirtyPath);

  const clean = await createCheckingTask();
  await coverTask(clean);
  const result = await finish(clean.cwd, clean.task.id);
  expect(result.exitCode).toBe(0);
  expect((JSON.parse(result.stdout) as TaskRecord).status).toBe("finished");
  await expect(readFile(join(clean.cwd, ".vinea", "tasks", "active", clean.task.id, "task.json"), "utf8"))
    .resolves.toContain('"status": "finished"');
});

test("finish fails closed outside a Git repository", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "vinea-nongit-"));
  const fixture = await createCheckingTask("standard", cwd);
  await coverTask(fixture);

  await expectFinishBlocked(cwd, fixture.task.id, "gitUnavailable");
});

test("finish fails closed when Vinea is nested below a different Git root", async () => {
  const parent = await createTempRepo();
  const nested = join(parent, "nested-vinea");
  await mkdir(nested);
  const fixture = await createCheckingTask("standard", nested);
  await coverTask(fixture);

  await expectFinishBlocked(nested, fixture.task.id, "gitUnavailable");
});

test("finish blocks unclassified learning candidates and accepts classified candidates", async () => {
  const proposed = await createCheckingTask();
  await coverTask(proposed);
  await setLearningCandidates(proposed, [{
    schemaVersion: 1,
    id: "L1",
    domain: "testing",
    text: "Keep finish gates fail closed.",
    rationale: "Prevents unverified completion.",
    status: "proposed",
    proposedAt: "2026-07-31T08:20:00.000Z",
  }]);
  await expectFinishBlocked(proposed.cwd, proposed.task.id, "learning");

  const classified = await createCheckingTask();
  await coverTask(classified);
  await setLearningCandidates(classified, [{
    schemaVersion: 1,
    id: "L1",
    domain: "testing",
    text: "Keep finish gates fail closed.",
    rationale: "Prevents unverified completion.",
    status: "archived",
    proposedAt: "2026-07-31T08:20:00.000Z",
    archivedAt: "2026-07-31T08:21:00.000Z",
    archiveReason: "Task-specific",
  }]);
  expect((await finish(classified.cwd, classified.task.id)).exitCode).toBe(0);
});

test("archive preserves task artifacts, removes only bindings for that task, and excludes it from active tasks", async () => {
  const fixture = await createCheckingTask();
  await coverTask(fixture);
  const other = await createTask(fixture.cwd, "Other active task", "standard");
  expect((await runCli([
    "continue", fixture.task.id,
    "--host", "codex",
    "--session-id", "target-session",
    "--confirmed",
    "--json",
  ], fixture.cwd)).exitCode).toBe(0);
  expect((await runCli([
    "continue", other.id,
    "--host", "codex",
    "--session-id", "other-session",
    "--confirmed",
    "--json",
  ], fixture.cwd)).exitCode).toBe(0);
  const activeDirectory = taskDirectory(fixture.cwd, fixture.task.id, "active");
  await writeFile(join(activeDirectory, "extra-artifact.txt"), "preserve me\n", "utf8");
  const artifactsBeforeArchive = (await readdir(activeDirectory)).sort();

  expect((await finish(fixture.cwd, fixture.task.id)).exitCode).toBe(0);
  const archived = await runCli(["archive", fixture.task.id, "--confirmed", "--json"], fixture.cwd);
  expect(archived.exitCode).toBe(0);
  expect((JSON.parse(archived.stdout) as TaskRecord).status).toBe("archived");

  const archiveDirectory = taskDirectory(fixture.cwd, fixture.task.id, "archive");
  expect((await readdir(archiveDirectory)).sort()).toEqual(artifactsBeforeArchive);
  expect(await readFile(join(archiveDirectory, "extra-artifact.txt"), "utf8")).toBe("preserve me\n");
  expect(await readFile(join(archiveDirectory, "check.md"), "utf8")).toContain("| R1 |");
  const active = await runCli(["task", "list", "--status", "active", "--json"], fixture.cwd);
  expect((JSON.parse(active.stdout) as TaskRecord[]).map(({ id }) => id)).toEqual([other.id]);

  const bindingFiles = await readdir(join(fixture.cwd, ".vinea", ".runtime", "sessions"));
  expect(bindingFiles).toHaveLength(1);
  const remainingBinding = await readJson<{ taskId: string }>(
    join(fixture.cwd, ".vinea", ".runtime", "sessions", bindingFiles[0]!),
  );
  expect(remainingBinding.taskId).toBe(other.id);
});

test("archive retries a durable move whose final archived status write did not complete", async () => {
  const fixture = await createCheckingTask();
  await coverTask(fixture);
  expect((await finish(fixture.cwd, fixture.task.id)).exitCode).toBe(0);
  await rename(
    taskDirectory(fixture.cwd, fixture.task.id, "active"),
    taskDirectory(fixture.cwd, fixture.task.id, "archive"),
  );

  const recovered = await runCli(["archive", fixture.task.id, "--confirmed", "--json"], fixture.cwd);

  expect(recovered.exitCode).toBe(0);
  expect((JSON.parse(recovered.stdout) as TaskRecord).status).toBe("archived");
  expect((await readJson<TaskRecord>(
    join(taskDirectory(fixture.cwd, fixture.task.id, "archive"), "task.json"),
  )).status).toBe("archived");
});

test("archive treats a missing runtime session directory as an empty binding set", async () => {
  const fixture = await createCheckingTask();
  await coverTask(fixture);
  expect((await finish(fixture.cwd, fixture.task.id)).exitCode).toBe(0);
  await rm(join(fixture.cwd, ".vinea", ".runtime", "sessions"), { force: true, recursive: true });

  const archived = await runCli(["archive", fixture.task.id, "--confirmed", "--json"], fixture.cwd);

  expect(archived.exitCode).toBe(0);
  expect((JSON.parse(archived.stdout) as TaskRecord).status).toBe("archived");
});

test("archive cleanup failure leaves the finished task and all bindings recoverable before transition", async () => {
  const fixture = await createCheckingTask();
  await coverTask(fixture);
  const other = await createTask(fixture.cwd, "Unrelated task", "standard");
  await bindTask(fixture.cwd, fixture.task.id, "target-cleanup-session");
  await bindTask(fixture.cwd, other.id, "other-cleanup-session");
  expect((await finish(fixture.cwd, fixture.task.id)).exitCode).toBe(0);
  const paths = resolveVineaPaths(fixture.cwd);
  const archiveWithInjectedFailure = archiveTask as unknown as (
    paths: ReturnType<typeof resolveVineaPaths>,
    taskId: string,
    input: { confirmed: boolean; actor: string },
    operations: { removeTaskSessionBindings: () => Promise<string[]> },
  ) => Promise<TaskRecord>;

  await expect(archiveWithInjectedFailure(paths, fixture.task.id, {
    confirmed: true,
    actor: "test",
  }, {
    removeTaskSessionBindings: async () => {
      throw new SchemaError("Injected binding cleanup failure");
    },
  })).rejects.toMatchObject({ code: "VINEA_SCHEMA_INVALID" });

  expect((await readTask(paths, fixture.task.id)).status).toBe("finished");
  const sessionDirectory = join(fixture.cwd, ".vinea", ".runtime", "sessions");
  const bindingsAfterFailure = await readdir(sessionDirectory);
  expect(bindingsAfterFailure).toHaveLength(2);

  const archived = await runCli(["archive", fixture.task.id, "--confirmed", "--json"], fixture.cwd);
  expect(archived.exitCode).toBe(0);
  const bindingsAfterRetry = await readdir(sessionDirectory);
  expect(bindingsAfterRetry).toHaveLength(1);
  expect((await readJson<{ taskId: string }>(join(sessionDirectory, bindingsAfterRetry[0]!))).taskId).toBe(other.id);
});

test("finished tasks cannot continue and archive removes their preexisting binding", async () => {
  const fixture = await createCheckingTask();
  await coverTask(fixture);
  const other = await createTask(fixture.cwd, "Unrelated active task", "standard");
  await bindTask(fixture.cwd, fixture.task.id, "target-before-finish");
  await bindTask(fixture.cwd, other.id, "unrelated-before-finish");
  expect((await finish(fixture.cwd, fixture.task.id)).exitCode).toBe(0);

  const activeDirectory = taskDirectory(fixture.cwd, fixture.task.id, "active");
  const journalPath = join(activeDirectory, "journal.md");
  const sessionsDirectory = join(fixture.cwd, ".vinea", ".runtime", "sessions");
  const journalBeforeContinue = await readFile(journalPath, "utf8");
  const bindingsBeforeContinue = (await readdir(sessionsDirectory)).sort();

  const continued = await runCli([
    "continue", fixture.task.id,
    "--host", "codex",
    "--session-id", "recreated-after-finish",
    "--confirmed",
    "--json",
  ], fixture.cwd);

  expect(continued.exitCode).toBe(1);
  expect(JSON.parse(continued.stdout)).toEqual({
    error: {
      code: "VINEA_VALIDATION_INVALID",
      message: `Task is finished and cannot be continued: ${fixture.task.id}`,
    },
  });
  expect(await readFile(journalPath, "utf8")).toBe(journalBeforeContinue);
  expect((await readdir(sessionsDirectory)).sort()).toEqual(bindingsBeforeContinue);

  const archived = await runCli(["archive", fixture.task.id, "--confirmed", "--json"], fixture.cwd);
  expect(archived.exitCode).toBe(0);
  const remainingBindings = await readdir(sessionsDirectory);
  expect(remainingBindings).toHaveLength(1);
  expect((await readJson<{ taskId: string }>(join(sessionsDirectory, remainingBindings[0]!))).taskId).toBe(other.id);
});

test("terminal tasks reject all task-local writers before archive and cannot gain uncovered requirements", async () => {
  const fixture = await createCheckingTask();
  await coverTask(fixture);
  expect((await finish(fixture.cwd, fixture.task.id)).exitCode).toBe(0);
  const activeDirectory = taskDirectory(fixture.cwd, fixture.task.id, "active");
  const briefSource = join(fixture.cwd, "terminal-brief.md");
  const planSource = join(fixture.cwd, "terminal-plan.md");
  const contextSource = join(fixture.cwd, "terminal-context.ts");
  await writeFile(briefSource, "# Replacement brief\n", "utf8");
  await writeFile(planSource, "# Replacement plan\n", "utf8");
  await writeFile(contextSource, "export const terminal = true;\n", "utf8");
  const beforeTask = await readFile(join(activeDirectory, "task.json"), "utf8");
  const beforeJournal = await readFile(join(activeDirectory, "journal.md"), "utf8");
  const beforeEvidence = await readFile(join(activeDirectory, "evidence.jsonl"), "utf8");
  const beforeContext = await readFile(join(activeDirectory, "context.jsonl"), "utf8");

  const terminalMutations = [
    ["task", "require", fixture.task.id, "--id", "R2", "--text", "Must not be added", "--json"],
    ["task", "accept", fixture.task.id, "--id", "A2", "--text", "Must not be added", "--json"],
    ["task", "set-brief", fixture.task.id, "--file", "terminal-brief.md", "--json"],
    ["task", "set-plan", fixture.task.id, "--file", "terminal-plan.md", "--json"],
    ["context", "add", fixture.task.id, "--path", "terminal-context.ts", "--purpose", "Must not be added", "--json"],
    ["evidence", "record", fixture.task.id, "--kind", "manual", "--summary", "Must not be added", "--result", "pass", "--json"],
  ];
  for (const args of terminalMutations) {
    const result = await runCli(args, fixture.cwd);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: "VINEA_VALIDATION_INVALID" } });
  }
  expect(await readFile(join(activeDirectory, "task.json"), "utf8")).toBe(beforeTask);
  expect(await readFile(join(activeDirectory, "journal.md"), "utf8")).toBe(beforeJournal);
  expect(await readFile(join(activeDirectory, "evidence.jsonl"), "utf8")).toBe(beforeEvidence);
  expect(await readFile(join(activeDirectory, "context.jsonl"), "utf8")).toBe(beforeContext);

  expect((await runCli(["archive", fixture.task.id, "--confirmed", "--json"], fixture.cwd)).exitCode).toBe(0);
  const archivedMutation = await runCli([
    "task", "require", fixture.task.id,
    "--id", "R2",
    "--text", "Must not be added after archive",
    "--json",
  ], fixture.cwd);
  expect(archivedMutation.exitCode).toBe(1);
  const archivedTask = await readJson<TaskRecord>(join(
    taskDirectory(fixture.cwd, fixture.task.id, "archive"),
    "task.json",
  ));
  expect(archivedTask.requirements.map(({ id }) => id)).toEqual(["R1"]);
});

interface CheckingFixture {
  cwd: string;
  task: TaskRecord;
  passingEvidence: EvidenceRecord;
  failingEvidence: EvidenceRecord;
}

async function createCheckingTask(
  quality: "standard" | "tdd" = "standard",
  providedCwd?: string,
): Promise<CheckingFixture> {
  const cwd = providedCwd ?? await createTempRepo();
  expect((await runCli(["init"], cwd)).exitCode).toBe(0);
  const task = await createTask(cwd, `Finish ${quality}`, quality);
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
  const briefSource = "brief-source.md";
  const planSource = "plan-source.md";
  await writeFile(join(cwd, briefSource), "# Brief\n\nVerify completion.\n", "utf8");
  await writeFile(join(cwd, planSource), "# Plan\n\n1. Exercise completion gates.\n", "utf8");
  expect((await runCli([
    "task", "set-brief", task.id, "--file", briefSource, "--json",
  ], cwd)).exitCode).toBe(0);
  expect((await runCli([
    "task", "set-plan", task.id, "--file", planSource, "--json",
  ], cwd)).exitCode).toBe(0);
  await unlink(join(cwd, briefSource));
  await unlink(join(cwd, planSource));
  expect((await transition(cwd, task.id, "ready")).exitCode).toBe(0);
  expect((await transition(cwd, task.id, "in_progress")).exitCode).toBe(0);

  if (quality === "tdd") {
    expect((await recordEvidence(cwd, task.id, {
      kind: "tdd-red",
      summary: "Focused regression failed before implementation",
      command: "npm test -- focused",
      exitCode: 1,
      result: "fail",
    })).exitCode).toBe(0);
  }
  const passingEvidence = await recordEvidence(cwd, task.id, {
    kind: quality === "tdd" ? "tdd-green" : "command",
    summary: "Focused regression passed",
    command: "npm test -- focused",
    exitCode: 0,
    result: "pass",
  });
  const failingEvidence = await recordEvidence(cwd, task.id, {
    kind: "manual",
    summary: "Manual verification failed",
    result: "fail",
  });
  expect((await transition(cwd, task.id, "checking")).exitCode).toBe(0);
  return {
    cwd,
    task,
    passingEvidence: JSON.parse(passingEvidence.stdout) as EvidenceRecord,
    failingEvidence: JSON.parse(failingEvidence.stdout) as EvidenceRecord,
  };
}

async function createTask(
  cwd: string,
  title: string,
  quality: "standard" | "tdd",
): Promise<TaskRecord> {
  const result = await runCli([
    "propose",
    "--title", title,
    "--description", "Exercise completion gates",
    "--risk", "low",
    "--quality", quality,
    "--execution", "single-agent",
    "--confirmed",
    "--json",
  ], cwd);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as TaskRecord;
}

function transition(cwd: string, taskId: string, status: TaskRecord["status"]) {
  return runCli([
    "task", "transition", taskId,
    "--to", status,
    "--reason", `Move to ${status}`,
    "--json",
  ], cwd);
}

function recordEvidence(
  cwd: string,
  taskId: string,
  input: {
    kind: EvidenceRecord["kind"];
    summary: string;
    command?: string;
    exitCode?: number;
    result: EvidenceRecord["result"];
  },
) {
  const args = [
    "evidence", "record", taskId,
    "--kind", input.kind,
    "--summary", input.summary,
    "--result", input.result,
  ];
  if (input.command !== undefined) args.push("--command", input.command);
  if (input.exitCode !== undefined) args.push("--exit-code", String(input.exitCode));
  args.push("--json");
  return runCli(args, cwd);
}

async function addCheck(
  cwd: string,
  taskId: string,
  requirementId: string,
  evidenceId: string | undefined,
  result: "pass" | "fail" | "uncovered",
): Promise<void> {
  const args = [
    "check", taskId,
    "--requirement", requirementId,
    "--plan-item", `Verify ${requirementId}`,
    "--paths", "src/core/workflow.ts",
    "--result", result,
    "--summary", `${requirementId} ${result}`,
    "--json",
  ];
  if (evidenceId !== undefined) args.splice(8, 0, "--evidence", evidenceId);
  const recorded = await runCli(args, cwd);
  expect(recorded.exitCode).toBe(0);
}

async function coverTask(fixture: CheckingFixture): Promise<void> {
  await addCheck(fixture.cwd, fixture.task.id, "R1", fixture.passingEvidence.id, "pass");
  await addCheck(fixture.cwd, fixture.task.id, "A1", fixture.passingEvidence.id, "pass");
}

function finish(cwd: string, taskId: string) {
  return runCli(["finish", taskId, "--confirmed", "--json"], cwd);
}

async function bindTask(cwd: string, taskId: string, sessionId: string): Promise<void> {
  const result = await runCli([
    "continue", taskId,
    "--host", "codex",
    "--session-id", sessionId,
    "--confirmed",
    "--json",
  ], cwd);
  expect(result.exitCode).toBe(0);
}

async function expectFinishBlocked(cwd: string, taskId: string, message: string): Promise<void> {
  const result = await finish(cwd, taskId);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    error: {
      code: "VINEA_FINISH_GATE_FAILED",
      message: expect.stringContaining(message),
    },
  });
  const shown = await runCli(["task", "show", taskId, "--json"], cwd);
  expect((JSON.parse(shown.stdout) as TaskRecord).status).toBe("checking");
}

async function setLearningCandidates(
  fixture: CheckingFixture,
  learningCandidates: LearningCandidate[],
): Promise<void> {
  const filename = join(taskDirectory(fixture.cwd, fixture.task.id, "active"), "task.json");
  const task = await readJson<TaskRecord>(filename);
  await writeJson(filename, { ...task, learningCandidates });
}

function taskDirectory(
  cwd: string,
  taskId: string,
  scope: "active" | "archive",
): string {
  return join(cwd, ".vinea", "tasks", scope, taskId);
}

function evidenceArtifact(cwd: string, taskId: string): string {
  return join(taskDirectory(cwd, taskId, "active"), "evidence.jsonl");
}
