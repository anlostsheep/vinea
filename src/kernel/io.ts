import { lstat, mkdir, open, readFile, rename, unlink, link } from "node:fs/promises";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { KernelError } from "./errors.js";
import { canonicalJson } from "./schema.js";
import type { Meta, RepositoryContext } from "./types.js";

export function assertPersistence(meta: Pick<Meta, "invocation">): void {
  if (!meta.invocation.persist) throw new KernelError("PERSISTENCE_DISABLED", "This invocation must not write files");
}
export async function safePath(root: string, target: string): Promise<string> {
  const full = resolve(target), rel = relative(root, full);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new KernelError("UNSAFE_PATH", "Path escapes its authorized root");
  }
  let current = resolve(root);
  for (const part of ["", ...rel.split(/[\\/]/).filter(Boolean)]) {
    if (part) current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new KernelError("UNSAFE_PATH", "Symbolic links are not allowed in managed paths");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return full;
}
export async function storagePath(ctx: RepositoryContext, rel: string): Promise<string> {
  const target = resolve(ctx.storeRoot, rel);
  await safePath(ctx.storeRoot, target);
  return safePath(ctx.commonGitDir, target);
}
export async function readManaged(ctx: RepositoryContext, rel: string): Promise<Buffer> {
  const file = await storagePath(ctx, rel);
  const info = await lstat(file);
  if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new KernelError("STATE_INVALID", "Invalid or oversized managed file");
  return readFile(file);
}
export async function writeManaged(ctx: RepositoryContext, meta: Meta, rel: string, bytes: Buffer | string, immutable = false): Promise<void> {
  assertPersistence(meta);
  if (Buffer.byteLength(bytes) > 64 * 1024 * 1024) throw new KernelError("STATE_TOO_LARGE", "Managed files cannot exceed the read limit of 64 MiB");
  const path = await storagePath(ctx, rel);
  await mkdir(dirname(path), { recursive: true });
  await storagePath(ctx, rel);
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    if (immutable) {
      try { await link(temp, path); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (!(await readManaged(ctx, rel)).equals(Buffer.from(bytes))) throw new KernelError("ARTIFACT_CONFLICT", "Immutable artifact differs");
      }
    } else await rename(temp, path);
  } finally { await unlink(temp).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
export async function writeJson(ctx: RepositoryContext, meta: Meta, rel: string, value: unknown, immutable = false): Promise<void> {
  await writeManaged(ctx, meta, rel, `${canonicalJson(value)}\n`, immutable);
}
