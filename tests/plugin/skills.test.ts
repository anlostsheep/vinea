import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

interface SkillInventory {
  directories: string[];
  skills: Array<{ directory: string; source: string }>;
}

async function readSkillInventory(skillsRoot = join(repositoryRoot, "skills")): Promise<SkillInventory> {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const nonDirectories = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
  expect(nonDirectories).toEqual([]);
  const skills = await Promise.all(directories.map(async (directory) => {
    const contents = await readdir(join(skillsRoot, directory));
    expect(contents.sort()).toEqual(["SKILL.md"]);
    const skillPath = join(skillsRoot, directory, "SKILL.md");
    await access(skillPath);
    return { directory, source: await readFile(skillPath, "utf8") };
  }));
  return { directories, skills };
}

function assertExactSkillInventory(inventory: SkillInventory): void {
  expect(inventory.directories).toEqual([...skillNames].sort());
  const publishedNames = inventory.skills.map(({ source }) => {
    const match = source.match(/^---\nname: ([a-z0-9-]+)\n/m);
    return match?.[1];
  }).sort();
  expect(publishedNames).toEqual([...skillNames].sort());
}

test("ships exactly the eight logical Vinea skill names for host prefixing", async () => {
  const inventory = await readSkillInventory();
  assertExactSkillInventory(inventory);

  for (const { directory, source } of inventory.skills) {
    expect(source).toMatch(new RegExp(`^---\\nname: ${directory}\\n`, "m"));
    expect(source).toContain("bin/vinea.mjs");
    expect(source).toContain("vinea:" + directory);
  }
});

test("rejects an added bare alias from the skill inventory", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "vinea-skills-"));
  try {
    await Promise.all([...skillNames, "start"].map(async (name) => {
      await mkdir(join(fixtureRoot, name));
      await writeFile(join(fixtureRoot, name, "SKILL.md"), `---\nname: ${name}\n---\n`, "utf8");
    }));

    await expect(readSkillInventory(fixtureRoot).then(assertExactSkillInventory)).rejects.toThrow();
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("uses the bundled CLI root contract without host automation claims", async () => {
  const inventory = await readSkillInventory();
  const combined = inventory.skills.map(({ source }) => source).join("\n");

  expect(combined).toContain("${CLAUDE_PLUGIN_ROOT}/bin/vinea.mjs");
  expect(combined).toContain("/skills/<current-skill>/SKILL.md");
  expect(combined).toContain("node <plugin-root>/bin/vinea.mjs");
  expect(combined).not.toContain("MCP");
  expect(combined).not.toContain("daemon");
  expect(combined).not.toContain("host hook");
  expect(combined).not.toMatch(/automatic(?:ally)? (?:recover|attach|promot)/i);
  expect(combined).not.toMatch(/auto(?:matic(?:ally)?)? (?:recover|attach|promot)/i);
});

test("brainstorming is selective and preserves user approval", async () => {
  const inventory = await readSkillInventory();
  const source = inventory.skills.find(({ directory }) => directory === "brainstorm")?.source;

  expect(source).toMatch(/exactly one .*question/i);
  expect(source).toMatch(/2[–-]3 options/i);
  expect(source).toMatch(/approval/i);
  expect(source).toMatch(/must not .*reusable learning/i);
});

test("Codex session binding is explicit and Claude has no invented environment fallback", async () => {
  const inventory = await readSkillInventory();
  const orient = inventory.skills.find(({ directory }) => directory === "orient")?.source;
  const continueSkill = inventory.skills.find(({ directory }) => directory === "continue")?.source;

  expect(orient).toContain("CODEX_THREAD_ID");
  expect(orient).toContain('--session-id "$CODEX_THREAD_ID"');
  expect(orient).toMatch(/nonempty/i);
  expect(orient).toMatch(/do not invent a session ID/i);
  expect(continueSkill).toContain("CODEX_THREAD_ID");
  expect(continueSkill).toContain('--session-id "$CODEX_THREAD_ID"');
  expect(continueSkill).toMatch(/otherwise omit it/i);
  expect(`${orient}\n${continueSkill}`).not.toContain("CLAUDE_SESSION_ID");
});
