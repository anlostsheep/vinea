import { test, expect } from "vitest";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { inspectLegacy } from "../../src/legacy/read.js";
import { makeRepoFixture, fingerprintFixtureTree } from "../helpers/kernel-fixture.js";

test.each(["unknown", "malformed", "symlink", "pending-migration"])("legacy %s remains read-only and blocks import", async kind => {
  const f = await makeRepoFixture(), root = join(f.root, ".vinea");
  await mkdir(join(root, "tasks/active"), { recursive: true });
  await writeFile(join(root, "config.json"), kind === "malformed" ? '{"SECRET":"do-not-echo"' : JSON.stringify({ schemaVersion: kind === "unknown" ? 99 : 2 }));
  if (kind === "symlink") await symlink(f.linkedRoot, join(root, "tasks/active/linked"));
  if (kind === "pending-migration") {
    await mkdir(join(root, ".runtime"));
    await writeFile(join(root, ".runtime/schema-migration.json"), JSON.stringify({ phase: "intent" }));
  }
  const report = await inspectLegacy(root);
  expect(report.issues.length).toBeGreaterThan(0);
  expect(JSON.stringify(report)).not.toContain("do-not-echo");
  expect(await fingerprintFixtureTree(join(f.root, ".git/vinea"))).toBe(await fingerprintFixtureTree(join(f.root, "absent")));
});
