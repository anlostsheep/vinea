import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import { createTempRepo, git } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const publicCli = join(projectRoot, "plugins", "vinea", "bin", "vinea.mjs");

beforeAll(async () => {
  await execFileAsync("npm", ["run", "package:plugin"], { cwd: projectRoot });
});

test("public CLI serializes two processes and preserves one retried archive intent", async () => {
  const cwd = await createTempRepo();
  await writeFile(join(cwd, "brief-source.md"), "# Brief\n\nCross-process fixture.\n", "utf8");
  await writeFile(join(cwd, "plan-source.md"), "# Plan\n\n1. Verify.\n", "utf8");
  expect((await git(cwd, ["add", "brief-source.md", "plan-source.md"])).exitCode).toBe(0);
  expect((await git(cwd, ["-c", "user.name=Vinea Test", "-c", "user.email=vinea@example.invalid", "commit", "-m", "seed fixture"])).exitCode).toBe(0);

  await runPublic(["init", "--json"], cwd);
  const task = await runJson<{ id: string }>([
    "propose", "--title", "Process-safe task", "--description", "Exercise task lock", "--risk", "low",
    "--quality", "standard", "--execution", "single-agent", "--confirmed", "--json",
  ], cwd);
  await runPublic([
    "learning", "propose", task.id, "--id", "L1", "--domain", "process-lock",
    "--text", "Serialize task writers across processes.", "--rationale", "Shared task state needs ordering.", "--json",
  ], cwd);

  const runtime = join(cwd, ".vinea", ".runtime");
  const promotionLock = join(runtime, "learning-promotion.lock");
  await mkdir(promotionLock);
  await writeFile(join(promotionLock, "owner.json"), "{\"token\":\"test-holder\"}\n", "utf8");

  const accepted = startPublic([
    "learning", "accept", task.id, "--id", "L1", "--confirmed-by", "user", "--json",
  ], cwd);
  await waitForFile(join(runtime, "task-locks", `${task.id}.lock`, "owner.json"));

  const startedMarker = join(runtime, "second-process-started");
  const second = startMarkedPublic(startedMarker, [
    "task", "require", task.id, "--id", "R1", "--text", "The task remains recoverable", "--json",
  ], cwd);
  await waitForFile(startedMarker);
  await rm(promotionLock, { recursive: true, force: true });

  expect((await accepted).exitCode).toBe(0);
  expect((await second).exitCode).toBe(0);
  const activeJournal = await readFile(join(cwd, ".vinea", "tasks", "active", task.id, "journal.md"), "utf8");
  const events = jsonl(activeJournal);
  expect(events.findIndex(({ type }) => type === "learning_accepted"))
    .toBeLessThan(events.findIndex(({ type }) => type === "requirement_added"));

  for (const command of [
    ["task", "set-brief", task.id, "--file", "brief-source.md", "--json"],
    ["task", "set-plan", task.id, "--file", "plan-source.md", "--json"],
    ["task", "transition", task.id, "--to", "ready", "--reason", "Planning complete", "--json"],
    ["task", "transition", task.id, "--to", "in_progress", "--reason", "Start work", "--json"],
  ]) await runPublic(command, cwd);
  const evidence = await runJson<{ id: string }>([
    "evidence", "record", task.id, "--kind", "command", "--summary", "Focused check passed",
    "--command", "npm test -- focused", "--exit-code", "0", "--result", "pass", "--json",
  ], cwd);
  await runPublic(["task", "transition", task.id, "--to", "checking", "--reason", "Ready to check", "--json"], cwd);
  await runPublic([
    "check", task.id, "--requirement", "R1", "--plan-item", "Verify process lock", "--paths", "README.md",
    "--evidence", evidence.id, "--result", "pass", "--summary", "Passing evidence", "--json",
  ], cwd);
  await runPublic(["finish", task.id, "--confirmed", "--json"], cwd);

  const collision = join(cwd, ".vinea", "tasks", "archive", task.id);
  await writeFile(collision, "occupied\n", "utf8");
  const failedArchive = await runPublic(["archive", task.id, "--confirmed", "--json"], cwd, false);
  expect(failedArchive.exitCode).toBe(1);
  await rm(collision);
  await runPublic(["archive", task.id, "--confirmed", "--json"], cwd);
  const archiveJournal = jsonl(await readFile(join(cwd, ".vinea", "tasks", "archive", task.id, "journal.md"), "utf8"));
  expect(archiveJournal.filter(({ type, oldStatus }) => type === "transition_intent" && oldStatus === "finished")).toHaveLength(1);
  expect(await runJson(["validate", "--json"], cwd)).toEqual({ issues: [] });
});

async function runJson<T>(args: string[], cwd: string): Promise<T> {
  const result = await runPublic(args, cwd);
  return JSON.parse(result.stdout) as T;
}

async function runPublic(args: string[], cwd: string, expectSuccess = true): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await startPublic(args, cwd);
  if (expectSuccess) {
    expect(result.exitCode, `${args.join(" ")}\n${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stderr).toBe("");
  }
  return result;
}

function startPublic(args: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runProcess(process.execPath, [publicCli, ...args], cwd);
}

function startMarkedPublic(
  marker: string,
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const launcher = join(cwd, ".vinea", ".runtime", "launch-public-cli.mjs");
  const source = [
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    "const child = spawn(process.execPath, [process.argv[3], ...process.argv.slice(4)], { stdio: 'inherit' });",
    "writeFileSync(process.argv[2], 'started');",
    "child.on('exit', (code) => process.exitCode = code ?? 1);",
  ].join("\n");
  return writeFile(launcher, source, "utf8").then(() => runProcess(process.execPath, [launcher, marker, publicCli, ...args], cwd));
}

function runProcess(command: string, args: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
  });
}

async function waitForFile(filename: string, timeoutMilliseconds = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  for (;;) {
    try {
      await access(filename);
      return;
    } catch {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for test barrier ${filename}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

function jsonl(contents: string): Array<Record<string, unknown>> {
  return contents.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}
