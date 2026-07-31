import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";

const skillNames = [
  "orient",
  "propose",
  "brainstorm",
  "plan",
  "continue",
  "check",
  "finish",
  "doctor",
] as const;

const repositoryRoot = process.cwd();

async function readSkill(name: typeof skillNames[number]): Promise<string> {
  const skillPath = join(repositoryRoot, "skills", name, "SKILL.md");
  await access(skillPath);
  return readFile(skillPath, "utf8");
}

test("ships exactly the eight logical Vinea skill names for host prefixing", async () => {
  const skills = await Promise.all(skillNames.map(async (name) => ({ name, source: await readSkill(name) })));

  expect(skills.map(({ name }) => name)).toEqual(skillNames);
  for (const { name, source } of skills) {
    expect(source).toMatch(new RegExp(`^---\\nname: ${name}\\n`, "m"));
    expect(source).toContain("bin/vinea.mjs");
    expect(source).toContain("vinea:" + name);
  }
});

test("uses the bundled CLI root contract without bare aliases or host automation claims", async () => {
  const sources = await Promise.all(skillNames.map(readSkill));
  const combined = sources.join("\n");
  const publishedNames = [...combined.matchAll(/^name: ([a-z0-9-]+)$/gm)].map((match) => match[1]);

  expect(combined).toContain("${CLAUDE_PLUGIN_ROOT}/bin/vinea.mjs");
  expect(combined).toContain("/skills/<current-skill>/SKILL.md");
  expect(combined).toContain("node <plugin-root>/bin/vinea.mjs");
  expect(publishedNames).toEqual(skillNames);
  expect(publishedNames).not.toContain("start");
  expect(combined).not.toContain("MCP");
  expect(combined).not.toContain("daemon");
  expect(combined).not.toContain("host hook");
  expect(combined).not.toMatch(/automatic(?:ally)? (?:recover|attach|promot)/i);
  expect(combined).not.toMatch(/auto(?:matic(?:ally)?)? (?:recover|attach|promot)/i);
});

test("brainstorming is selective and preserves user approval", async () => {
  const source = await readSkill("brainstorm");

  expect(source).toMatch(/exactly one .*question/i);
  expect(source).toMatch(/2[–-]3 options/i);
  expect(source).toMatch(/approval/i);
  expect(source).toMatch(/must not .*reusable learning/i);
});
