import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = join(projectRoot, "dist/vinea.mjs");

export async function createTempRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "vinea-"));
  await git(cwd, ["init"]);
  return cwd;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export function runCli(args: string[], cwd: string): Promise<CommandResult> {
  return run(process.execPath, [cliPath, ...args], cwd);
}

export function git(cwd: string, args: string[]): Promise<CommandResult> {
  return run("git", args, cwd);
}

function run(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
