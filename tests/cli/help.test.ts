import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
import { createTempRepo, runCli } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("help lists every planned top-level command", async () => {
  const cwd = await createTempRepo();
  const result = await runCli(["--help"], cwd);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  for (const command of [
    "init",
    "orient",
    "propose",
    "continue",
    "check",
    "finish",
    "doctor",
    "validate",
  ]) {
    expect(result.stdout).toContain(command);
  }
  expect(result.stdout).toContain("task rework");
  expect(result.stdout).toContain("check history");
});

test("version comes from the root package metadata", async () => {
  const cwd = await createTempRepo();
  const result = await runCli(["--version"], cwd);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(`${packageJson.version}\n`);
});

test("unknown commands return a usage error", async () => {
  const cwd = await createTempRepo();
  const result = await runCli(["unknown"], cwd);

  expect(result.exitCode).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Unknown command: unknown");
});
