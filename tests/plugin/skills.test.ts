import { readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";

const names = ["brainstorm", "check", "continue", "debug", "doctor", "finish", "orient", "plan", "run"];
test("ships exactly nine host-prefixed logical entry points", async () => {
  const entries = await readdir("skills", { withFileTypes: true });
  expect(entries.filter(e => e.isDirectory()).map(e => e.name).sort()).toEqual(names);
  for (const name of names) {
    const text = await readFile(join("skills", name, "SKILL.md"), "utf8");
    expect(text).toMatch(new RegExp(`^---\nname: ${name}\ndescription: [^\n]+\n---`));
    expect(text).toContain(`vinea:${name}`);
    expect(text).toContain("bin/vinea.mjs");
    expect(text).toContain("CLI.md");
  }
});
test("shared CLI reference covers every mutation command", async () => {
  await access("hosts/public-plugin/CLI.md");
  const source = await readFile("hosts/public-plugin/CLI.md", "utf8");
  const { commands } = await import("../../src/cli/commands.js");
  for (const name of Object.keys(commands)) expect(source).toContain(`\`${name}\``);
});
