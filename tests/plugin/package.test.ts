import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const publicRoot = join(repositoryRoot, "plugins", "vinea");
const iconRelativePath = "./assets/vinea-loop.png";
const sourceIconPath = join(repositoryRoot, "assets", "vinea-loop.svg");
const packagedIconPath = join(publicRoot, "assets", "vinea-loop.png");
const languageSwitch = "[简体中文](README.md) | [English](README.en.md)";
const operationalCommands = [
  "codex plugin marketplace add anlostsheep/vinea",
  "codex plugin add vinea@vinea",
  "codex plugin marketplace add anlostsheep/vinea --ref v0.3.1",
  "claude plugin marketplace add anlostsheep/vinea",
  "claude plugin install vinea@vinea --scope user",
  "claude plugin marketplace add anlostsheep/vinea@v0.3.1",
  "codex plugin marketplace upgrade vinea",
  "codex plugin remove vinea@vinea",
  "claude plugin marketplace update vinea",
  "claude plugin update vinea@vinea --scope user",
  "codex plugin remove vinea@personal",
  "claude plugin uninstall vinea@vinea-local --scope user",
  "codex plugin list",
  "claude plugin list",
] as const;
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

  await expect(access(sourceIconPath)).resolves.toBeUndefined();
  expect(await readFile(sourceIconPath, "utf8")).toContain('viewBox="0 0 1024 1024"');
  await expect(access(packagedIconPath)).resolves.toBeUndefined();
  expect((await readFile(packagedIconPath)).subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(rootPackage.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(codexManifest.version).toBe(rootPackage.version);
  expect(claudeManifest.version).toBe(rootPackage.version);
  expect(codexManifest).toMatchObject({
    name: "vinea",
    description: expect.stringMatching(/shared task state.*Codex.*Claude Code/i),
    author: { name: "dengzhen" },
    repository: "https://github.com/anlostsheep/vinea",
    skills: "./skills/",
    interface: {
      displayName: "Vinea",
      shortDescription: "Shared AI-coding task workflows",
      longDescription: expect.stringMatching(/\S/),
      developerName: "dengzhen",
      category: "Developer Tools",
      capabilities: expect.arrayContaining(["Read", "Write", "Interactive"]),
      defaultPrompt: expect.arrayContaining([expect.any(String)]),
      composerIcon: iconRelativePath,
      logo: iconRelativePath,
      logoDark: iconRelativePath,
    },
  });
  expect(claudeManifest).toMatchObject({
    name: "vinea",
    description: expect.stringMatching(/shared task state.*Codex.*Claude Code/i),
    author: { name: "dengzhen" },
    repository: "https://github.com/anlostsheep/vinea",
    homepage: "https://github.com/anlostsheep/vinea#readme",
    license: "MIT",
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
      author: { name: "dengzhen" },
      source: "./plugins/vinea",
      repository: "https://github.com/anlostsheep/vinea",
      homepage: "https://github.com/anlostsheep/vinea#readme",
      license: "MIT",
    }],
  });
  expect((claudeMarketplace.plugins as Array<Record<string, unknown>>)[0]).not.toHaveProperty("version");

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

test("packages Chinese-first bilingual READMEs with equivalent operational commands", async () => {
  const rootChinese = await readFile(join(repositoryRoot, "README.md"), "utf8");
  const rootEnglish = await readFile(join(repositoryRoot, "README.en.md"), "utf8");
  const sourceChinese = await readFile(join(repositoryRoot, "hosts", "public-plugin", "README.md"), "utf8");
  const sourceEnglish = await readFile(join(repositoryRoot, "hosts", "public-plugin", "README.en.md"), "utf8");
  const packagedChinese = await readFile(join(publicRoot, "README.md"), "utf8");
  const packagedEnglish = await readFile(join(publicRoot, "README.en.md"), "utf8");

  expect(rootChinese).toContain("## 通过 Git marketplace 安装");
  expect(rootEnglish).toContain("## Install from the Git marketplace");
  expect(sourceChinese).toContain("## 为宿主安装");
  expect(sourceEnglish).toContain("## Install for your host");
  for (const readme of [rootChinese, rootEnglish, sourceChinese, sourceEnglish]) {
    expect(readme).toContain(languageSwitch);
    for (const command of operationalCommands) expect(readme).toContain(command);
  }

  expect(packagedChinese).toBe(sourceChinese);
  expect(packagedEnglish).toBe(sourceEnglish);
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
