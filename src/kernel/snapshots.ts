import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, mkdir, unlink, chmod, open, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { KernelError, requireThat } from "./errors.js";
import { getTask, assertEntry, assertWritablePath, assertContract } from "./policy.js";
import { assertWriteToken, executionKey } from "./ownership.js";
import { assertPersistence, safePath, readManaged, writeManaged, writeJson } from "./io.js";
import { readState, mutateState, lookupOperation } from "./store.js";
import { gitOutput } from "./repository.js";
import { canonicalJson, pathRule, snapshotRule, id } from "./schema.js";
import type { Meta, RepositoryContext, Snapshot, SnapshotEntry, WriteToken } from "./types.js";

export interface SnapshotLimits { maxFiles: number; maxTotalBytes: number; maxFileBytes: number }
const defaults: SnapshotLimits = { maxFiles: 2000, maxTotalBytes: 64 * 1024 * 1024, maxFileBytes: 8 * 1024 * 1024 };
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export function fingerprintSnapshot(baseCommit: string | null, scope: string[], entries: SnapshotEntry[]): string {
  return hash(canonicalJson({ baseCommit, scope, entries }));
}
function safeInput(path: string): void {
  pathRule(path);
  requireThat(!path.split("/").some(p => [".git", ".vinea", ".ssh", ".aws", "credentials"].includes(p)
    || /^\.env(?:\.|$)/.test(p) || /\.(?:pem|key|p12|pfx)$/i.test(p)), "SENSITIVE_INPUT", "Sensitive or managed paths cannot be snapshotted");
}
async function head(ctx: RepositoryContext): Promise<string | null> {
  try { return (await gitOutput(ctx.worktreeRoot, ["rev-parse", "--verify", "HEAD"])).trim(); }
  catch { return null; }
}
async function collect(ctx: RepositoryContext, scope: string[], limits: SnapshotLimits) {
  scope.forEach(safeInput);
  for (const path of scope) await safePath(ctx.worktreeRoot, join(ctx.worktreeRoot, path));
  const baseCommit = await head(ctx);
  const currentPaths = await gitOutput(ctx.worktreeRoot, ["--literal-pathspecs", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...scope]);
  // Baseline paths keep staged deletions in the recoverable snapshot.
  const baselinePaths = baseCommit === null ? "" : await gitOutput(ctx.worktreeRoot, ["--literal-pathspecs", "ls-tree", "-r", "-z", "--name-only", baseCommit, "--", ...scope]);
  const names = [...new Set([...currentPaths.split("\0"), ...baselinePaths.split("\0")].filter(Boolean))].sort();
  requireThat(names.length <= limits.maxFiles, "SNAPSHOT_LIMIT", "Snapshot file limit exceeded");
  const entries: SnapshotEntry[] = [], blobs = new Map<string, Buffer>();
  let bytes = 0;
  for (const path of names) {
    safeInput(path);
    const target = await safePath(ctx.worktreeRoot, join(ctx.worktreeRoot, path));
    try {
      const info = await lstat(target);
      requireThat(info.isFile(), "UNSAFE_PATH", "Snapshot inputs must be regular files");
      requireThat(info.size <= limits.maxFileBytes && bytes + info.size <= limits.maxTotalBytes, "SNAPSHOT_LIMIT", "Snapshot byte limit exceeded");
      const contents = await readFile(target); bytes += contents.length;
      requireThat(contents.length <= limits.maxFileBytes && bytes <= limits.maxTotalBytes, "SNAPSHOT_LIMIT", "Input grew beyond snapshot limit");
      requireThat(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(contents.toString("utf8")), "SENSITIVE_INPUT", "Private key material cannot be snapshotted");
      const sha256 = hash(contents); blobs.set(sha256, contents);
      entries.push({ path, kind: "file", sha256, mode: info.mode & 0o111 ? "100755" : "100644" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      entries.push({ path, kind: "deleted", sha256: null, mode: null });
    }
  }
  return { baseCommit, entries, blobs, fingerprint: fingerprintSnapshot(baseCommit, scope, entries) };
}
export async function captureSnapshot(ctx: RepositoryContext, meta: Meta, input: {
  taskId: string; paths: string[]; token: WriteToken | null; limits?: SnapshotLimits;
}): Promise<Snapshot> {
  assertPersistence(meta);
  const state = await readState(ctx), task = getTask(state, input.taskId);
  assertEntry(meta, task, "state-write");
  if (input.token) assertWriteToken(ctx, state, meta, input.token);
  requireThat(Array.isArray(input.paths) && input.paths.length > 0, "SNAPSHOT_SCOPE_REQUIRED", "Explicit snapshot scope is required");
  const request = { command: "snapshot.capture", input, workspaceId: ctx.workspaceId };
  const previous = await lookupOperation(ctx, meta, request);
  if (previous) return (await readState(ctx)).snapshots[previous.resourceIds[0]!]!;
  const scope = [...new Set(input.paths)].sort(), limits = input.limits ?? defaults;
  requireThat(Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0), "SNAPSHOT_LIMIT", "Limits must be positive integers");
  requireThat((Object.keys(defaults) as Array<keyof SnapshotLimits>).every(key => limits[key] <= defaults[key]), "SNAPSHOT_LIMIT", "Custom limits may tighten, not exceed, the recovery limits");
  const first = await collect(ctx, scope, limits), second = await collect(ctx, scope, limits);
  requireThat(first.fingerprint === second.fingerprint, "SNAPSHOT_CHANGED", "Inputs changed during capture");
  const snapshot: Snapshot = { id: randomUUID(), fingerprint: first.fingerprint, baseCommit: first.baseCommit,
    scope, entries: first.entries, workspaceId: ctx.workspaceId, createdBy: meta.actor.instanceId, capturedAt: new Date().toISOString() };
  for (const [sha, bytes] of first.blobs) await writeManaged(ctx, meta, `blobs/${sha}`, bytes, true);
  await writeJson(ctx, meta, `snapshots/${snapshot.id}.json`, snapshot, true);
  const receipt = await mutateState(ctx, meta, request, current => {
    assertEntry(meta, getTask(current, input.taskId), "state-write");
    if (input.token) assertWriteToken(ctx, current, meta, input.token);
    current.snapshots[snapshot.id] = snapshot; return [snapshot.id];
  });
  return (await readState(ctx)).snapshots[receipt.resourceIds[0]!]!;
}
export async function compareSnapshot(ctx: RepositoryContext, snapshot: Snapshot) {
  snapshotRule(snapshot);
  const now = await collect(ctx, snapshot.scope, defaults);
  const previous = new Map(snapshot.entries.map(e => [e.path, canonicalJson(e)]));
  const next = new Map(now.entries.map(e => [e.path, canonicalJson(e)]));
  const changedPaths = [...new Set([...previous.keys(), ...next.keys()])].filter(p => previous.get(p) !== next.get(p));
  return { matches: snapshot.fingerprint === now.fingerprint, changedPaths,
    missingInputs: now.baseCommit !== snapshot.baseCommit ? ["Git baseline changed"] : [] };
}
export async function loadSnapshot(ctx: RepositoryContext, snapshotId: string): Promise<Snapshot> {
  id(snapshotId);
  const snapshot = (await readState(ctx)).snapshots[snapshotId];
  requireThat(snapshot, "SNAPSHOT_UNAVAILABLE", "Snapshot is not admitted in the shared store");
  return validateSnapshotContents(ctx, snapshot);
}
export async function validateSnapshotContents(ctx: RepositoryContext, snapshot: Snapshot): Promise<Snapshot> {
  try {
    const manifest: unknown = JSON.parse((await readManaged(ctx, `snapshots/${snapshot.id}.json`)).toString("utf8"));
    snapshotRule(manifest);
    requireThat(canonicalJson(manifest) === canonicalJson(snapshot), "SNAPSHOT_UNAVAILABLE", "Snapshot manifest changed");
    requireThat(fingerprintSnapshot(snapshot.baseCommit, snapshot.scope, snapshot.entries) === snapshot.fingerprint, "SNAPSHOT_UNAVAILABLE", "Snapshot fingerprint is invalid");
    for (const entry of snapshot.entries) if (entry.sha256) {
      requireThat(hash(await readManaged(ctx, `blobs/${entry.sha256}`)) === entry.sha256,
        "SNAPSHOT_UNAVAILABLE", "Snapshot content is corrupt");
    }
  } catch { throw new KernelError("SNAPSHOT_UNAVAILABLE", "Snapshot content is missing or corrupt; no current file was substituted"); }
  return snapshot;
}
export async function restoreSnapshot(ctx: RepositoryContext, meta: Meta, input: {
  taskId: string; snapshotId: string; token: WriteToken; expectedTargetBase: string | null;
}): Promise<void> {
  assertPersistence(meta);
  const snapshot = await loadSnapshot(ctx, input.snapshotId), state = await readState(ctx), task = getTask(state, input.taskId);
  assertEntry(meta, task, "business-write"); assertContract(task, input.token.contractVersion);
  const claim = state.claims[ctx.workspaceId];
  requireThat(claim?.state === "restore-target" && claim.recovery.snapshotId === snapshot.id
    && claim.instanceId === meta.actor.instanceId && input.token.instanceId === claim.instanceId && claim.taskId === input.taskId
    && claim.epoch === input.token.epoch && claim.workspaceId === input.token.workspaceId
    && state.epochs[executionKey(claim.taskId, claim.assignmentId)] === claim.epoch, "STALE_WRITE_TOKEN", "Restore reservation is stale");
  requireThat(snapshot.baseCommit === input.expectedTargetBase && await head(ctx) === input.expectedTargetBase, "SNAPSHOT_UNAVAILABLE", "Restore baseline is unavailable or changed");
  const contents = new Map<string, Buffer>();
  for (const entry of snapshot.entries) {
    safeInput(entry.path); assertWritablePath(task, entry.path);
    await safePath(ctx.worktreeRoot, join(ctx.worktreeRoot, entry.path));
    if (entry.sha256) {
      const bytes = await readManaged(ctx, `blobs/${entry.sha256}`);
      requireThat(hash(bytes) === entry.sha256, "SNAPSHOT_UNAVAILABLE", "Snapshot content is missing or corrupt");
      contents.set(entry.path, bytes);
    }
  }
  // Only unchanged baseline files or this recovery's target contents can be overwritten.
  const status = (await gitOutput(ctx.worktreeRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).split("\0").filter(Boolean);
  for (const line of status) {
    requireThat(line.length > 3 && !/[RC]/.test(line.slice(0, 2)), "RECOVERY_CONFLICT", "Unconfirmed rename or dirty target");
    const path = line.slice(3), expected = snapshot.entries.find(e => e.path === path);
    requireThat(expected, "RECOVERY_CONFLICT", "Unconfirmed target changes are preserved");
    const bytes = await readFile(await safePath(ctx.worktreeRoot, join(ctx.worktreeRoot, path))).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    requireThat(expected.kind === "deleted" ? bytes === null : bytes !== null && hash(bytes) === expected.sha256, "RECOVERY_CONFLICT", "Target differs from baseline and recovery contents");
  }
  for (const entry of snapshot.entries) {
    const file = await safePath(ctx.worktreeRoot, join(ctx.worktreeRoot, entry.path));
    if (entry.kind === "deleted") await unlink(file).catch(error => { if (error.code !== "ENOENT") throw error; });
    else {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${randomUUID()}.vinea-restore`;
      try {
        const handle = await open(tmp, "wx", entry.mode === "100755" ? 0o755 : 0o644);
        try { await handle.writeFile(contents.get(entry.path)!); await handle.sync(); } finally { await handle.close(); }
        await rename(tmp, file); await chmod(file, entry.mode === "100755" ? 0o755 : 0o644);
      } finally { await unlink(tmp).catch(error => { if (error.code !== "ENOENT") throw error; }); }
    }
  }
  requireThat((await compareSnapshot(ctx, snapshot)).matches, "RECOVERY_CONFLICT", "Restored inputs do not match snapshot");
  await mutateState(ctx, { ...meta, operationId: `restore-${hash(claim.recovery.operationId)}` }, { command: "restore.publish", input }, current => {
    const held = current.claims[ctx.workspaceId];
    requireThat(held?.state === "restore-target" && held.epoch === claim.epoch && held.instanceId === meta.actor.instanceId,
      "STALE_WRITE_TOKEN", "Restore ownership changed before publication");
    assertContract(getTask(current, input.taskId), claim.contractVersion);
    current.claims[ctx.workspaceId] = { ...held, state: "writer", recovery: null }; return [ctx.workspaceId];
  });
}
