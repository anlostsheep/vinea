import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { initializeWorkspace } from "../../src/core/config.js";
import { addContextReference } from "../../src/core/context.js";
import { resolveVineaPaths } from "../../src/core/paths.js";
import { createTask } from "../../src/core/workflow.js";
import { createTempRepo } from "../helpers/fixture.js";

test("adding v2 context appends after immutable v1 history without rewriting it", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const created = await createTask(paths, {
    title: "Preserve historic context",
    risk: { level: "low", reasons: [] },
    qualityMode: "standard",
    executionMode: "single-agent",
    confirmation: "user",
  }, () => new Date("2026-08-04T01:04:00.000Z"));
  await mkdir(join(cwd, "src"));
  await writeFile(join(cwd, "README.md"), "legacy context\n", "utf8");
  await writeFile(join(cwd, "src", "current.ts"), "export const current = true;\n", "utf8");
  const contextPath = join(created.directory, "context.jsonl");
  const legacy = `${JSON.stringify({
    schemaVersion: 1,
    path: "README.md",
    purpose: "Original v1 context bytes stay intact.",
    estimatedBytes: 15,
    addedAt: "2026-08-04T01:03:00.000Z",
  })}\n`;
  await writeFile(contextPath, legacy, "utf8");

  const added = await addContextReference(paths, created.task.id, {
    path: "src/current.ts",
    purpose: "New v2 context is appended.",
    actor: "codex",
  }, () => new Date("2026-08-04T01:04:01.000Z"));

  expect(added).toMatchObject({ schemaVersion: 2, path: "src/current.ts" });
  const persisted = await readFile(contextPath, "utf8");
  expect(persisted.startsWith(legacy)).toBe(true);
  const lines = persisted.trim().split("\n");
  expect(JSON.parse(lines[0]!)).toEqual(JSON.parse(legacy));
  expect(JSON.parse(lines[1]!)).toMatchObject({ schemaVersion: 2, path: "src/current.ts" });
});
