import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import { createTempRepo, runCli } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });
});

test("unknown commands honor JSON mode and never expose a stack trace", async () => {
  const cwd = await createTempRepo();
  const result = await runCli(["unknown", "--json"], cwd);

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    error: {
      code: "VINEA_VALIDATION_INVALID",
      message: "Unknown command: unknown",
    },
  });
  expect(result.stdout).not.toMatch(/\n\s+at\s/u);
  expect(result.stdout).not.toContain("Error:");
});

test("unknown and duplicate options fail closed before command side effects", async () => {
  const cwd = await createTempRepo();

  const unknown = await runCli(["init", "--repo", "/tmp/elsewhere", "--json"], cwd);
  expect(unknown.exitCode).toBe(2);
  expect(unknown.stderr).toBe("");
  expect(JSON.parse(unknown.stdout)).toMatchObject({
    error: {
      code: "VINEA_VALIDATION_INVALID",
      message: "Unknown option: --repo",
    },
  });
  await expect(access(join(cwd, ".vinea"))).rejects.toMatchObject({ code: "ENOENT" });

  const duplicate = await runCli(["doctor", "--json", "--json"], cwd);
  expect(duplicate.exitCode).toBe(2);
  expect(duplicate.stderr).toBe("");
  expect(JSON.parse(duplicate.stdout)).toMatchObject({
    error: {
      code: "VINEA_VALIDATION_INVALID",
      message: "Duplicate option: --json",
    },
  });
});

test("runtime validation failures preserve their stable code and exit one", async () => {
  const cwd = await createTempRepo();
  const result = await runCli(["task", "list", "--json"], cwd);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({
    error: {
      code: "VINEA_SCHEMA_INVALID",
      message: expect.any(String),
    },
  });
  expect(result.stdout).not.toMatch(/\n\s+at\s/u);
});
