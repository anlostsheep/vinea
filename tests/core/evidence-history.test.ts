import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { initializeWorkspace } from "../../src/core/config.js";
import { recordEvidence } from "../../src/core/evidence.js";
import { resolveVineaPaths } from "../../src/core/paths.js";
import { createTask } from "../../src/core/workflow.js";
import { createTempRepo } from "../helpers/fixture.js";

test("recording v2 evidence appends after immutable v1 history without rewriting it", async () => {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const created = await createTask(paths, {
    title: "Preserve historic evidence",
    risk: { level: "low", reasons: [] },
    qualityMode: "standard",
    executionMode: "single-agent",
    confirmation: "user",
  }, () => new Date("2026-08-04T01:03:00.000Z"));
  const evidencePath = join(created.directory, "evidence.jsonl");
  const legacy = `${JSON.stringify({
    schemaVersion: 1,
    id: "legacy-evidence",
    kind: "command",
    summary: "Original v1 evidence bytes stay intact.",
    result: "pass",
    recordedAt: "2026-08-04T01:02:00.000Z",
    command: "npm test -- legacy",
    exitCode: 0,
    actor: "cli",
  })}\n`;
  await writeFile(evidencePath, legacy, "utf8");

  const recorded = await recordEvidence(paths, created.task.id, {
    kind: "command",
    summary: "New v2 evidence is appended.",
    command: "npm test -- current",
    exitCode: 0,
    result: "pass",
    actor: "codex",
  }, () => new Date("2026-08-04T01:03:01.000Z"));

  expect(recorded).toMatchObject({ schemaVersion: 2, verificationRevision: 0 });
  const persisted = await readFile(evidencePath, "utf8");
  expect(persisted.startsWith(legacy)).toBe(true);
  const lines = persisted.trim().split("\n");
  expect(JSON.parse(lines[0]!)).toEqual(JSON.parse(legacy));
  expect(JSON.parse(lines[1]!)).toMatchObject({
    schemaVersion: 2,
    verificationRevision: 0,
    id: recorded.id,
  });
});
