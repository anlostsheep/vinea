import { lstat, mkdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { SchemaError, ValidationError } from "./errors.js";

export interface VineaPaths {
  repoRoot: string;
  vineaRoot: string;
  config: string;
  gitignore: string;
  specs: string;
  specIndex: string;
  tasks: string;
  activeTasks: string;
  archivedTasks: string;
  runtime: string;
  sessions: string;
}

export function resolveVineaPaths(repoRoot: string): VineaPaths {
  const root = resolve(repoRoot);
  const vineaRoot = inside(root, ".vinea");
  const tasks = inside(vineaRoot, "tasks");
  const runtime = inside(vineaRoot, ".runtime");
  return {
    repoRoot: root,
    vineaRoot,
    config: inside(vineaRoot, "config.json"),
    gitignore: inside(vineaRoot, ".gitignore"),
    specs: inside(vineaRoot, "specs"),
    specIndex: inside(vineaRoot, "specs/index.md"),
    tasks,
    activeTasks: inside(tasks, "active"),
    archivedTasks: inside(tasks, "archive"),
    runtime,
    sessions: inside(runtime, "sessions"),
  };
}

export function assertInside(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const difference = relative(resolvedRoot, resolvedCandidate);
  if (isAbsolute(difference) || difference === ".." || difference.startsWith("../") || difference.startsWith("..\\")) {
    throw new ValidationError(`Path escapes repository root: ${candidate}`);
  }
  return resolvedCandidate;
}

export async function assertNoSymlink(root: string, candidate: string): Promise<void> {
  const resolvedRoot = resolve(root);
  const safeCandidate = assertInside(resolvedRoot, candidate);
  try {
    if ((await lstat(resolvedRoot)).isSymbolicLink()) {
      throw new SchemaError(`Unsafe symbolic link at ${resolvedRoot}`);
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const segments = relative(resolvedRoot, safeCandidate).split(/[/\\]/).filter(Boolean);
  let current = resolvedRoot;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new SchemaError(`Unsafe symbolic link at ${current}`);
      }
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
  }
}

export async function ensureDirectory(root: string, directory: string): Promise<void> {
  const safeDirectory = assertInside(root, directory);
  await assertNoSymlink(root, safeDirectory);
  await mkdir(safeDirectory, { recursive: true });
  const entry = await lstat(safeDirectory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new SchemaError(`Expected directory at ${safeDirectory}`);
  }
}

function inside(root: string, child: string): string {
  return assertInside(root, join(root, child));
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
