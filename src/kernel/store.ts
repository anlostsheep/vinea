import { mkdir, lstat, rmdir, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { KernelError } from "./errors.js";
import { assertRepositoryState, canonicalJson, metaRule, decisionRule } from "./schema.js";
import { assertPersistence, storagePath, readManaged, writeJson, safePath } from "./io.js";
import type { RepositoryContext, RepositoryState, Meta, Decision, Id, MutationReceipt } from "./types.js";
export { assertPersistence } from "./io.js";

export async function initializeStore(ctx: RepositoryContext, meta: Meta, decision: Decision): Promise<void> {
  metaRule(meta); assertPersistence(meta); decisionRule(decision);
  if (!["named-entry", "named-request"].includes(meta.invocation.activation)) throw new KernelError("ACTIVATION_REQUIRED", "Explicit Vinea activation required");
  if (["orient", "doctor"].includes(meta.invocation.entry)) throw new KernelError("ENTRY_SCOPE_DENIED", "This entry cannot initialize storage");
  const root = await storagePath(ctx, ".");
  try { await mkdir(root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await readState(ctx); return;
  }
  const state: RepositoryState = { kernelSchemaVersion: 1, repositoryId: randomUUID(), revision: 0,
    tasks: {}, claims: {}, epochs: {}, snapshots: {}, operations: {} };
  assertRepositoryState(state);
  await writeJson(ctx, meta, "tasks/state.json", state);
}
export async function readState(ctx: RepositoryContext): Promise<RepositoryState> {
  try {
    const state: unknown = JSON.parse((await readManaged(ctx, "tasks/state.json")).toString("utf8"));
    assertRepositoryState(state); return state;
  } catch (error) {
    if (error instanceof KernelError && error.code === "UNSAFE_PATH") throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const exists = await lstat(await storagePath(ctx, ".")).then(() => true, e => {
        if (e.code === "ENOENT") return false; throw e;
      });
      throw new KernelError(exists ? "INCOMPLETE_INITIALIZATION" : "STORE_MISSING", "Shared store is unavailable; no replacement was created");
    }
    throw new KernelError("STATE_INVALID", "Shared state is malformed or unsupported; it was not repaired");
  }
}
async function withLock<T>(ctx: RepositoryContext, meta: Meta, operation: () => Promise<T>): Promise<T> {
  assertPersistence(meta);
  const path = await storagePath(ctx, "runtime/store.lock");
  await mkdir(await storagePath(ctx, "runtime"), { recursive: true });
  const deadline = Date.now() + 5000;
  for (;;) {
    await storagePath(ctx, "runtime/store.lock");
    try { await mkdir(path); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new KernelError("STORE_LOCKED", "Store is busy; locks are never automatically stolen");
      await delay(10);
    }
  }
  try {
    await writeJson(ctx, meta, "runtime/store.lock/owner.json", { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() });
    return await operation();
  } finally {
    await unlink(join(path, "owner.json")).catch(error => { if (error.code !== "ENOENT") throw error; });
    await rmdir(path);
  }
}
export async function mutateState(ctx: RepositoryContext, meta: Meta, request: unknown,
  change: (draft: RepositoryState) => Id[] | Promise<Id[]>): Promise<MutationReceipt> {
  metaRule(meta); assertPersistence(meta);
  if (meta.invocation.activation === "none") throw new KernelError("ACTIVATION_REQUIRED", "Explicit Vinea activation is required before any write");
  await readState(ctx);
  const requestHash = createHash("sha256").update(canonicalJson({ request, actor: meta.actor, invocation: meta.invocation })).digest("hex");
  return withLock(ctx, meta, async () => {
    const before = await readState(ctx), previous = before.operations[meta.operationId];
    if (previous) {
      if (previous.requestHash !== requestHash) throw new KernelError("OPERATION_ID_REUSED", "Operation payload or actor differs");
      return previous;
    }
    const state = structuredClone(before);
    const resourceIds = await change(state);
    state.revision = before.revision + 1;
    const receipt = { operationId: meta.operationId, requestHash, revision: state.revision, resourceIds };
    state.operations[meta.operationId] = receipt;
    assertRepositoryState(state);
    await writeJson(ctx, meta, "tasks/state.json", state);
    return receipt;
  });
}
export async function lookupOperation(ctx: RepositoryContext, meta: Meta, request: unknown): Promise<MutationReceipt | undefined> {
  metaRule(meta); assertPersistence(meta);
  const previous = (await readState(ctx)).operations[meta.operationId];
  if (previous && previous.requestHash !== createHash("sha256").update(canonicalJson({ request, actor: meta.actor, invocation: meta.invocation })).digest("hex")) {
    throw new KernelError("OPERATION_ID_REUSED", "Operation payload or actor differs");
  }
  return previous;
}
export async function inspectLegacyCoexistence(ctx: RepositoryContext): Promise<boolean> {
  const root = await safePath(ctx.worktreeRoot, join(ctx.worktreeRoot, ".vinea/tasks/active"));
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new KernelError("UNSAFE_PATH", "Legacy task directory is a symbolic link");
      if (!entry.isDirectory()) continue;
      const path = await safePath(ctx.worktreeRoot, join(root, entry.name, "task.json"));
      try { if ((await lstat(path)).isFile()) return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return false;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
export async function inspectStore(ctx: RepositoryContext) {
  const issues: Array<{ code: string; path: string; message: string }> = [];
  let status: "missing" | "ready" | "incomplete" | "invalid" | "locked" | "conflicted" | "blocked" = "ready";
  let state: RepositoryState | undefined;
  try { state = await readState(ctx); } catch (error) {
    const e = error as KernelError;
    status = e.code === "STORE_MISSING" ? "missing" : e.code === "INCOMPLETE_INITIALIZATION" ? "incomplete" : "invalid";
    issues.push({ code: e.code, path: ctx.storeRoot, message: e.message });
  }
  if (status !== "ready") return { status, issues };
  try {
    if (await inspectLegacyCoexistence(ctx)) {
      status = "conflicted";
      issues.push({ code: "LEGACY_ACTIVE_STATE_PRESENT", path: join(ctx.worktreeRoot, ".vinea/tasks/active"),
        message: "Legacy active tasks coexist with the kernel store. Their planning status does not release kernel writers; do not switch CLI versions or migrate automatically" });
    }
  } catch {
    status = "invalid"; issues.push({ code: "LEGACY_STATE_UNSAFE", path: ".vinea/tasks/active", message: "Legacy state cannot be inspected safely" });
  }
  const { validatePlanningArtifacts } = await import("./workflow.js");
  for (const task of Object.values(state!.tasks)) {
    if (!task.workflow) {
      if (task.status === "active") {
        if (status === "ready") status = "blocked";
        issues.push({ code: "TASK_PROTOCOL_REQUIRED", path: `tasks/${task.id}`,
          message: "Pre-protocol task remains readable; no execution authorization was inferred or migrated" });
      }
      continue;
    }
    try { await validatePlanningArtifacts(ctx, task); }
    catch (error) { status = "invalid"; issues.push({ code: "PLANNING_ARTIFACT_INVALID", path: `tasks/${task.id}/planning`, message: (error as Error).message }); }
  }
  const { validateSnapshotContents } = await import("./snapshots.js");
  for (const snapshot of Object.values(state!.snapshots)) {
    try { await validateSnapshotContents(ctx, snapshot); }
    catch {
      status = "invalid";
      issues.push({ code: "SNAPSHOT_UNAVAILABLE", path: `snapshots/${snapshot.id}.json`, message: "Admitted snapshot content is missing or invalid; no replacement was made" });
    }
  }
  for (const task of Object.values(state!.tasks)) for (const evidence of Object.values(task.evidence)) {
    if (evidence.artifactId) {
      const path = `artifacts/${evidence.artifactId}/result.json`;
      try {
        const artifact = JSON.parse((await readManaged(ctx, path)).toString("utf8"));
        if (artifact.snapshotId !== evidence.snapshotId || artifact.code !== evidence.exitCode || canonicalJson(artifact.argv) !== canonicalJson(evidence.argv)
          || canonicalJson(artifact.environment) !== canonicalJson(evidence.environment)) throw new Error("mismatch");
      } catch { status = "invalid"; issues.push({ code: "ARTIFACT_UNAVAILABLE", path, message: "Evidence artifact is missing or invalid" }); }
    }
  }
  try { await (await import("./sessions.js")).readBindings(ctx); }
  catch { status = "invalid"; issues.push({ code: "BINDING_INVALID", path: "runtime/bindings", message: "Binding data is invalid; durable ownership was not changed" }); }
  try {
    const entries = await readdir(await storagePath(ctx, "runtime/store.lock"));
    if (status === "ready") status = "locked";
    issues.push({ code: "STORE_LOCKED", path: "runtime/store.lock", message: `Lock present (${entries.length} files); inspect the owner before manual recovery` });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { status, issues };
}
