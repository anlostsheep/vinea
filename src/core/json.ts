import { appendFile, lstat, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { SchemaError } from "./errors.js";
import { assertNoSymlink } from "./paths.js";

export async function readJson<T>(filename: string, repoRoot: string): Promise<T> {
  await assertNoSymlink(repoRoot, filename);
  let content: string;
  try {
    const { readFile } = await import("node:fs/promises");
    content = await readFile(filename, "utf8");
  } catch (error) {
    if (error instanceof SchemaError) throw error;
    throw new SchemaError(`Unable to read JSON file ${filename}`, error);
  }
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    throw new SchemaError(`Invalid JSON in ${filename}`, error);
  }
}

export async function writeJsonAtomic(filename: string, value: unknown, repoRoot: string): Promise<void> {
  const parent = dirname(filename);
  await assertNoSymlink(repoRoot, parent);
  await assertExistingFileIsNotSymlink(filename);
  const temporary = join(parent, `.${basename(filename)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, filename);
  } catch (error) {
    throw new SchemaError(`Unable to write JSON file ${filename}`, error);
  }
}

export async function appendJsonl(filename: string, value: unknown, repoRoot: string): Promise<void> {
  await assertNoSymlink(repoRoot, dirname(filename));
  await assertExistingFileIsNotSymlink(filename);
  try {
    await appendFile(filename, `${JSON.stringify(value)}\n`, "utf8");
  } catch (error) {
    throw new SchemaError(`Unable to append JSONL file ${filename}`, error);
  }
}

async function assertExistingFileIsNotSymlink(filename: string): Promise<void> {
  try {
    const entry = await lstat(filename);
    if (entry.isSymbolicLink()) throw new SchemaError(`Unsafe symbolic link at ${filename}`);
  } catch (error) {
    if (isMissing(error) || error instanceof SchemaError) {
      if (error instanceof SchemaError) throw error;
      return;
    }
    throw new SchemaError(`Unable to inspect ${filename}`, error);
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
