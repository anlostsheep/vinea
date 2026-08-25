import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vitest";

const repositoryRoot = process.cwd();
const conflictChecker = join(repositoryRoot, "scripts", "check-plugin-install-conflict.mjs");

test.each([
  {
    host: "codex",
    installing: "personal",
    installed: "vinea@vinea  installed, enabled  0.3.0  /tmp/vinea\n",
    resolution: "codex plugin remove vinea@vinea",
  },
  {
    host: "claude",
    installing: "vinea-local",
    installed: "  ❯ vinea@vinea\n    Version: 0.3.0\n    Status: ✔ enabled\n",
    resolution: "claude plugin uninstall vinea@vinea --scope user",
  },
  {
    host: "codex",
    installing: "vinea",
    installed: "vinea@personal  installed, enabled  0.2.0  /tmp/vinea\n",
    resolution: "codex plugin remove vinea@personal",
  },
  {
    host: "claude",
    installing: "vinea",
    installed: "  ❯ vinea@vinea-local\n    Version: 0.2.0\n    Status: ✔ enabled\n",
    resolution: "claude plugin uninstall vinea@vinea-local --scope user",
  },
])("blocks a $host $installing install when the other channel is installed", ({ host, installing, installed, resolution }) => {
  const result = spawnSync(process.execPath, [conflictChecker, "--host", host, "--installing", installing], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: installed,
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Vinea plugin channel conflict");
  expect(result.stderr).toContain("vinea@vinea");
  expect(result.stderr).toContain(resolution);
});

test.each([
  ["codex", "personal", "vinea@personal  installed, enabled  0.2.0  /tmp/vinea\n"],
  ["claude", "vinea-local", "  ❯ vinea@vinea-local\n    Version: 0.2.0\n    Status: ✔ enabled\n"],
])("allows the existing %s development channel to be refreshed", (host, installing, installed) => {
  const result = spawnSync(process.execPath, [conflictChecker, "--host", host, "--installing", installing], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: installed,
  });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
});

test.each([
  ["personal", "vinea@vinea  not installed  /tmp/vinea\n"],
  ["vinea", "vinea@personal  not installed  /tmp/vinea\n"],
])("allows a Codex %s install when the other channel is available but not installed", (installing, installed) => {
  const result = spawnSync(process.execPath, [conflictChecker, "--host", "codex", "--installing", installing], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: installed,
  });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
});
