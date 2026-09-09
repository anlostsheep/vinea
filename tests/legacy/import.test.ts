import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "vitest";
import { inspectLegacy } from "../../src/legacy/read.js";
import { importLegacy } from "../../src/legacy/import.js";
import { readState } from "../../src/kernel/store.js";
import { claimWork } from "../../src/kernel/ownership.js";
import { makeGoalFixture, fingerprintFixtureTree } from "../helpers/kernel-fixture.js";

test.each([1, 2])("legacy schema %i imports without granting execution or changing source", async version => {
  const f = await makeGoalFixture(), source = join(f.root, ".vinea"), taskPath = join(source, "tasks/active/old");
  await mkdir(taskPath, { recursive: true });
  await writeFile(join(source, "config.json"), JSON.stringify({ schemaVersion: version }));
  await writeFile(join(taskPath, "task.json"), JSON.stringify({ schemaVersion: version, id: "old", title: "Old task", status: "in_progress",
    qualityMode: "tdd", requirements: [{ id: "R1", text: "Do not change the API" }] }));
  await writeFile(join(taskPath, "evidence.jsonl"), "");
  const preview = await inspectLegacy(source), before = await fingerprintFixtureTree(source);
  expect(preview.records).toHaveLength(1);
  const meta = f.meta;
  const input = { sourceRoot: source, expectedFingerprint: preview.fingerprint, decision: { summary: "import history only", reference: null } };
  const ids = await importLegacy(f.context, meta, input);
  expect(await importLegacy(f.context, meta, input)).toEqual(ids);
  const task = (await readState(f.context)).tasks[ids[0]!]!;
  expect(task.contracts[0]!.grant).toEqual({ businessWrite: false, delegate: false, commit: false, deploy: false, allowedPaths: [] });
  await expect(claimWork(f.context, f.meta, { taskId: task.id, assignmentId: null, contractVersion: 1 })).rejects.toMatchObject({ code: "BUSINESS_WRITE_NOT_GRANTED" });
  expect(await fingerprintFixtureTree(source)).toBe(before);
});
