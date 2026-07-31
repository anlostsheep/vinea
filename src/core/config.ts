import { lstat, readFile, writeFile } from "node:fs/promises";
import { SchemaError } from "./errors.js";
import { readJson, writeJsonAtomic } from "./json.js";
import { assertNoSymlink, ensureDirectory, type VineaPaths } from "./paths.js";
import { assertSupportedSchema } from "./schema.js";
import { SCHEMA_VERSION, type VineaConfig } from "./types.js";

export const DEFAULT_CONFIG: VineaConfig = {
  schemaVersion: SCHEMA_VERSION,
  riskRules: {
    medium: ["behavior", "bug", "cross-file", "external", "security", "data", "deploy"],
    high: ["production", "migration", "credential", "permission", "delete"],
  },
  context: { maxFiles: 12, maxEstimatedBytes: 80000 },
};

const SPEC_INDEX = "# Vinea Specs\n\n## Indexed specs\n\n";
const RUNTIME_IGNORE = ".runtime/\n";

export async function readConfig(paths: VineaPaths): Promise<VineaConfig> {
  const config = await readJson<unknown>(paths.config, paths.repoRoot);
  assertSupportedSchema(config, paths.config);
  return config;
}

export async function initializeWorkspace(paths: VineaPaths): Promise<void> {
  await ensureDirectory(paths.repoRoot, paths.vineaRoot);
  await Promise.all([
    assertNoSymlink(paths.repoRoot, paths.config),
    assertNoSymlink(paths.repoRoot, paths.gitignore),
    assertNoSymlink(paths.repoRoot, paths.specIndex),
    assertNoSymlink(paths.repoRoot, paths.activeTasks),
    assertNoSymlink(paths.repoRoot, paths.archivedTasks),
    assertNoSymlink(paths.repoRoot, paths.sessions),
  ]);
  if (await exists(paths.config)) {
    await readConfig(paths);
  }
  if (await exists(paths.gitignore)) await ensureExactFile(paths.gitignore, RUNTIME_IGNORE, paths.repoRoot);

  await Promise.all([
    ensureDirectory(paths.repoRoot, paths.specs),
    ensureDirectory(paths.repoRoot, paths.activeTasks),
    ensureDirectory(paths.repoRoot, paths.archivedTasks),
    ensureDirectory(paths.repoRoot, paths.sessions),
  ]);
  if (!(await exists(paths.config))) await writeJsonAtomic(paths.config, DEFAULT_CONFIG, paths.repoRoot);
  await ensureExactFile(paths.gitignore, RUNTIME_IGNORE, paths.repoRoot);
  await ensureFile(paths.specIndex, SPEC_INDEX, paths.repoRoot);
}

async function ensureExactFile(filename: string, contents: string, repoRoot: string): Promise<void> {
  await assertNoSymlink(repoRoot, filename);
  if (await exists(filename)) {
    const existing = await readFile(filename, "utf8");
    if (existing !== contents) throw new SchemaError(`Unexpected managed file contents in ${filename}`);
    return;
  }
  await writeFile(filename, contents, { encoding: "utf8", flag: "wx" });
}

async function ensureFile(filename: string, contents: string, repoRoot: string): Promise<void> {
  await assertNoSymlink(repoRoot, filename);
  if (await exists(filename)) return;
  await writeFile(filename, contents, { encoding: "utf8", flag: "wx" });
}

async function exists(filename: string): Promise<boolean> {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
