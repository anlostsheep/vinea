import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const publicRoot = join(repositoryRoot, "plugins", "vinea");
const skillNames = [
  "brainstorm",
  "check",
  "continue",
  "doctor",
  "finish",
  "orient",
  "plan",
  "propose",
] as const;

beforeAll(async () => {
  await execFileAsync("npm", ["run", "package:plugin"], { cwd: repositoryRoot });
});

test("packages parity manifests, all public skills, and one host-independent CLI", async () => {
  const rootPackage = await readJson(join(repositoryRoot, "package.json"));
  const codexManifest = await readJson(join(publicRoot, ".codex-plugin", "plugin.json"));
  const claudeManifest = await readJson(join(publicRoot, ".claude-plugin", "plugin.json"));

  expect(codexManifest.version).toBe(rootPackage.version);
  expect(claudeManifest.version).toBe(rootPackage.version);
  expect(codexManifest).toMatchObject({
    name: "vinea",
    description: expect.stringMatching(/shared task state.*Codex.*Claude Code/i),
    author: { name: "dengzhen" },
    skills: "./skills/",
    interface: {
      displayName: "Vinea",
      shortDescription: "Shared AI-coding task workflows",
      longDescription: expect.stringMatching(/\S/),
      developerName: "dengzhen",
      category: "Developer Tools",
      capabilities: expect.arrayContaining(["Read", "Write", "Interactive"]),
      defaultPrompt: expect.arrayContaining([expect.any(String)]),
    },
  });
  expect(claudeManifest).toMatchObject({
    name: "vinea",
    description: expect.stringMatching(/shared task state.*Codex.*Claude Code/i),
    author: { name: "dengzhen" },
    skills: "./skills/",
  });
  expect(codexManifest.skills).toBe("./skills/");
  expect(claudeManifest.skills).toBe("./skills/");
  expect(codexManifest).not.toHaveProperty("mcpServers");
  expect(claudeManifest).not.toHaveProperty("mcpServers");
  expect(codexManifest).not.toHaveProperty("hooks");
  expect(claudeManifest).not.toHaveProperty("apps");

  const codexMarketplace = await readJson(join(repositoryRoot, ".agents", "plugins", "marketplace.json"));
  const claudeMarketplace = await readJson(join(repositoryRoot, ".claude-plugin", "marketplace.json"));
  expect(codexMarketplace).toMatchObject({
    name: "vinea",
    version: rootPackage.version,
    interface: { displayName: "Vinea" },
    plugins: [{
      name: "vinea",
      version: rootPackage.version,
      source: { source: "local", path: "./plugins/vinea" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Developer Tools",
    }],
  });
  expect(claudeMarketplace).toMatchObject({
    name: "vinea",
    owner: { name: "dengzhen" },
    metadata: { version: rootPackage.version },
    plugins: [{
      name: "vinea",
      version: rootPackage.version,
      author: { name: "dengzhen" },
      source: "./plugins/vinea",
    }],
  });

  const publicReadme = await readFile(join(publicRoot, "README.md"), "utf8");
  expect(publicReadme).toContain("node bin/vinea.mjs --help");
  expect(publicReadme).toMatch(/install/i);
  expect(publicReadme).toContain("Codex");
  expect(publicReadme).toContain("Claude Code");
  expect(publicReadme).not.toMatch(/\bnpm\b|\bdist\/|\bpackage\.json\b|plugins\/vinea\b/);

  for (const name of skillNames) {
    const source = await readFile(join(publicRoot, "skills", name, "SKILL.md"), "utf8");
    expect(source).toContain(`name: ${name}`);
    expect(source).toContain(`vinea:${name}`);
  }
  const cliPath = join(publicRoot, "bin", "vinea.mjs");
  await access(cliPath);
  expect((await stat(cliPath)).mode & 0o111).not.toBe(0);
});

test("the public CLI initializes and validates a fresh repository", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "vinea-public-plugin-"));
  try {
    const initialized = await runPublicCli(["init", "--json"], fixtureRoot);
    expect(JSON.parse(initialized.stdout)).toEqual({ initialized: true });

    const validated = await runPublicCli(["validate", "--json"], fixtureRoot);
    expect(JSON.parse(validated.stdout)).toEqual({ issues: [] });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function runPublicCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(process.execPath, [join(publicRoot, "bin", "vinea.mjs"), ...args], { cwd });
  return { stdout: result.stdout, stderr: result.stderr };
}
