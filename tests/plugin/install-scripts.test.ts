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

test("Codex helper packages Vinea and refreshes the configured personal marketplace", async () => {
  const source = await readInstaller("install-codex-plugin.sh");

  expectSafeStaticInstaller(source);
  expect(source).toContain("$home_dir/.codex/plugins/vinea");
  expect(source).toContain("$home_dir/.agents/plugins/marketplace.json");
  expect(source).toContain("./.codex/plugins/vinea");
  expect(source).toContain("update_plugin_cachebuster.py");
  expect(source).toContain('python3 "$cachebuster_script" "$plugin_root"');
  expect(source).toContain("codex plugin add");
  expect(source).not.toContain("codex plugin marketplace add");
  expect(source).not.toContain("marketplace.plugins = marketplace.plugins.filter");
  expect(source).not.toContain("writeFile");
  expect(source).not.toContain("rename");
  expect(source).toContain("command -v codex");
  expect(source).toContain("Codex CLI is unavailable; plugin activation was not performed.");
  expect(source).toContain("When Codex is available, run:");
  expect(source).toContain("codex plugin add vinea@");
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
  expect(source).toContain("claude plugin list");
  expect(source).toContain("claude plugin update vinea@vinea-local --scope user");
  expect(source).toContain("claude plugin install vinea@vinea-local --scope user");
  expect(source).toContain("command -v claude");
  expect(source).toContain("Claude Code CLI is unavailable; plugin activation was not performed.");
  expect(source).toContain("When Claude Code is available, run:");
  expect(source).toContain("claude plugin install vinea@vinea-local --scope user");
});
