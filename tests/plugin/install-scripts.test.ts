import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();

async function readInstaller(name: string): Promise<string> {
  const path = join(repositoryRoot, "scripts", name);
  await execFileAsync("bash", ["-n", path], { cwd: repositoryRoot });
  return readFile(path, "utf8");
}

function expectSafeStaticInstaller(source: string): void {
  expect(source).toContain("npm run package:plugin");
  expect(source).toContain("plugins/vinea");
  expect(source).toMatch(/new (Codex|Claude Code) session/i);
  expect(source).not.toMatch(/\/Users\//);
  expect(source).not.toMatch(/(?:password|token|secret|credential)/i);
}

test("Codex helper packages Vinea and writes the documented personal marketplace entry", async () => {
  const source = await readInstaller("install-codex-plugin.sh");

  expectSafeStaticInstaller(source);
  expect(source).toContain("$home_dir/.codex/plugins/vinea");
  expect(source).toContain("$home_dir/.agents/plugins/marketplace.json");
  expect(source).toContain('path: "./.codex/plugins/vinea"');
  expect(source).toContain("codex plugin marketplace add");
  expect(source).toContain("codex plugin add");
});

test("Claude Code helper packages Vinea and uses the documented marketplace lifecycle", async () => {
  const source = await readInstaller("install-claude-plugin.sh");

  expectSafeStaticInstaller(source);
  expect(source).toContain("$home_dir/.claude/plugins/marketplaces/vinea-local");
  expect(source).toContain('plugin_root="$marketplace_root/plugins/vinea"');
  expect(source).toContain("$marketplace_root/.claude-plugin/marketplace.json");
  expect(source).toContain('source: "./plugins/vinea"');
  expect(source).toContain("claude plugin validate");
  expect(source).toContain("claude plugin marketplace add");
  expect(source).toContain("claude plugin marketplace update vinea-local");
  expect(source).toContain("claude plugin install vinea@vinea-local --scope user");
});
