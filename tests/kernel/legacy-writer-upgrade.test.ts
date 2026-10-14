import { test, expect, vi } from "vitest";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { makeGoalFixture, testMeta, authorizeFixtureTask } from "../helpers/kernel-fixture.js";
import { claimWork, addAssignment, executionKey, assertWriteToken } from "../../src/kernel/ownership.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { occupancyRef } from "../../src/kernel/continuation.js";
import { createGoal } from "../../src/kernel/contracts.js";
import { readState, inspectStore } from "../../src/kernel/store.js";
import { upgradeStore, previewUpgrade } from "../../src/kernel/upgrade.js";
import { discoverRepository } from "../../src/kernel/repository.js";
import { executeCommand } from "../../src/application.js";
import { cancelTask } from "../../src/kernel/task-control.js";
import { controlInput } from "../helpers/task-control.js";
import * as io from "../../src/kernel/io.js";
import { canonicalJson } from "../../src/kernel/schema.js";

async function fixture(kind: "legacy" | "modern" | "hold" | "restore" = "legacy", extra = false) {
  const f = await makeGoalFixture();
  const old = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: old });
  const target = await discoverRepository(f.linkedRoot);
  if (extra) {
    const a = await addAssignment(f.context, f.meta, { taskId: f.task.id, ownerEpoch: 1,
      assignment: { outcome: "unselected work", dependsOn: [], assignee: f.actorB.instanceId, businessWrite: true } });
    await claimWork(target, testMeta(f.actorB), { taskId: f.task.id, contractVersion: 1, assignmentId: a.id });
  }
  const state = await readState(f.context); state.kernelSchemaVersion = 1;
  const task = state.tasks[f.task.id]!; delete task.control;
  if (kind !== "modern") delete task.workflow;
  if (kind === "hold") state.claims[f.context.workspaceId] = { ...old, state: "unknown-writer-hold", recovery: null };
  if (kind === "restore") state.claims[f.context.workspaceId] = { ...old, state: "restore-target", recovery: { snapshotId: snapshot.id, operationId: "old-restore" } };
  const path = join(f.context.storeRoot, "tasks/state.json"); await writeFile(path, JSON.stringify(state));
  const before = await readFile(path), p = await previewUpgrade(target);
  const stopped = { from: occupancyRef(old), stopBasis: "user-declared-stop" as const,
    stopReference: "fixture:user:legacy-writer-stopped", userMessage: "The old writer has stopped; release this exact claim during upgrade" };
  const input = { expectedRevision: p.expectedRevision, expectedFingerprint: p.expectedFingerprint,
    request: { action: "upgrade" as const, userMessage: "Upgrade this store and resolve the explicitly stopped legacy writer", reference: "fixture:user:upgrade" },
    stoppedLegacyWriters: [stopped] };
  return { ...f, get meta() { return testMeta(f.actorA); }, target, old, state, path, before, input, stopped, snapshot };
}

test("reported deadlock: a different actor in a linked worktree can resolve an explicitly stopped legacy writer while upgrading", async () => {
  const f = await fixture();
  const preview = await previewUpgrade(f.target);
  expect(preview.ready).toBe(false);
  const meta = testMeta(f.actorB, "continue"), result = await upgradeStore(f.target, meta, f.input);
  expect(preview.occupied[0]).toMatchObject({ ref: f.stopped.from, canResolveStoppedLegacyWriter: true });
  expect(result.schemaVersion).toBe(2);
  const after = await readState(f.context), task = after.tasks[f.task.id]!;
  const { control: _, ...preserved } = task;
  expect(preserved).toEqual(f.state.tasks[f.task.id]);
  expect(task.workflow).toBeUndefined(); expect(task.owner.instanceId).toBe(f.actorA.instanceId);
  expect(after.claims[f.context.workspaceId]).toEqual({ ...f.state.claims[f.context.workspaceId], state: "released", recovery: null });
  expect(after.epochs[executionKey(f.task.id, null)]).toBe(f.old.epoch + 1);
  expect(after.snapshots).toEqual(f.state.snapshots);
  expect((await readFile(join(f.context.storeRoot, result.backup))).equals(f.before)).toBe(true);
  const audit = JSON.parse(await readFile(join(f.context.storeRoot, result.receipt!), "utf8"));
  expect(audit).toMatchObject({ actor: f.actorB, request: f.input.request, sourceFingerprint: f.input.expectedFingerprint,
    resolvedLegacyWriters: [{ ...f.stopped, previousState: "writer", state: "released", fencedEpoch: f.old.epoch + 1 }] });
  expect(after.operations[meta.operationId]!.resourceIds[1]).toBe(createHash("sha256").update(canonicalJson(audit)).digest("hex"));
  expect(result.retainedLegacyTaskIds).toEqual([f.task.id]);
  expect(result.nextAction).toContain("TASK_PROTOCOL_REQUIRED");
  expect((await upgradeStore(f.target, meta, f.input)).replayed).toBe(true);
  expect(await readState(f.context)).toEqual(after);
  await expect(assertWriteToken(f.context, after, f.meta, f.old)).rejects.toThrow();
  await expect(claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 })).rejects.toMatchObject({ code: "TASK_PROTOCOL_REQUIRED" });
  expect((await inspectStore(f.context)).issues.some(i => i.code === "TASK_PROTOCOL_REQUIRED")).toBe(true);
  const { version: __, decision, ...contract } = task.contracts[0]!;
  const fresh = await createGoal(f.context, testMeta(f.actorB), { title: "New schema-2 task", contract, decision });
  await authorizeFixtureTask(f.context, f.actorB, fresh.id);
  await claimWork(f.context, testMeta(f.actorB), { taskId: fresh.id, assignmentId: null, contractVersion: 1 });
  // Closing the legacy task remains a separate explicit decision, not an upgrade side effect.
  await cancelTask(f.target, testMeta(f.actorB), await controlInput(f.target, f.task.id, "cancel"));
  expect((await readState(f.context)).tasks[f.task.id]!.status).toBe("cancelled");
});

test.each(["modern", "hold", "restore"] as const)("stopped legacy writer exception does not accept %s occupancy", async kind => {
  const f = await fixture(kind);
  await expect(upgradeStore(f.target, testMeta(f.actorB), f.input)).rejects.toMatchObject({ code: "LEGACY_WRITER_REQUIRED" });
  expect((await readFile(f.path)).equals(f.before)).toBe(true);
});

test("all unselected occupancies still block the whole upgrade, without partially releasing selected writers", async () => {
  const f = await fixture("legacy", true);
  await expect(upgradeStore(f.target, testMeta(f.actorB), f.input)).rejects.toMatchObject({ code: "WORKSPACE_OCCUPIED" });
  expect((await readFile(f.path)).equals(f.before)).toBe(true);
  await expect(access(join(f.context.storeRoot, "backups"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("stale occupancy and duplicate selections cannot release another generation", async () => {
  const f = await fixture();
  await expect(upgradeStore(f.target, testMeta(f.actorB), { ...f.input,
    stoppedLegacyWriters: [{ ...f.stopped, from: { ...f.stopped.from, epoch: f.old.epoch + 1 } }] })).rejects.toMatchObject({ code: "OCCUPANCY_CHANGED" });
  await expect(upgradeStore(f.target, testMeta(f.actorB), { ...f.input,
    stoppedLegacyWriters: [f.stopped, f.stopped] })).rejects.toMatchObject({ code: "DUPLICATE_OCCUPANCY" });
  expect((await readFile(f.path)).equals(f.before)).toBe(true);
});

test.each(["missing-reference", "missing-message", "unknown-stop", "force"])("CLI rejects %s rather than interpreting implicit approval", async kind => {
  const f = await fixture();
  const payload: any = structuredClone(f.input);
  if (kind === "missing-reference") payload.stoppedLegacyWriters[0].stopReference = "";
  if (kind === "missing-message") delete payload.stoppedLegacyWriters[0].userMessage;
  if (kind === "unknown-stop") payload.stoppedLegacyWriters[0].stopBasis = "unknown";
  if (kind === "force") payload.force = true;
  const result = await executeCommand(f.target, "store upgrade", { meta: testMeta(f.actorB, "continue"), payload });
  expect(result.error?.code).toBe("SCHEMA_INVALID");
  expect((await readFile(f.path)).equals(f.before)).toBe(true);
});

test("failure before publication preserves the original writer and retries one deterministic receipt", async () => {
  const f = await fixture(), meta = testMeta(f.actorB), real = io.writeJson;
  const fault = vi.spyOn(io, "writeJson").mockImplementation(async (...args) => {
    if (args[2] === "tasks/state.json") throw new Error("injected state publication failure");
    return real(...args);
  });
  try { await expect(upgradeStore(f.target, meta, f.input)).rejects.toThrow("injected state publication failure"); }
  finally { fault.mockRestore(); }
  expect((await readFile(f.path)).equals(f.before)).toBe(true);
  await upgradeStore(f.target, meta, f.input);
  expect((await readState(f.context)).claims[f.context.workspaceId]!.state).toBe("released");
  expect((await upgradeStore(f.target, meta, f.input)).replayed).toBe(true);
});

test.each(["missing", "modified"])("a committed upgrade cannot report a valid %s audit receipt", async mode => {
  const f = await fixture(), meta = testMeta(f.actorB);
  const result = await upgradeStore(f.target, meta, f.input), state = await readFile(f.path);
  const path = join(f.context.storeRoot, result.receipt!);
  if (mode === "missing") await (await import("node:fs/promises")).unlink(path);
  else await writeFile(path, '{}\n');
  await expect(upgradeStore(f.target, meta, f.input)).rejects.toMatchObject({ code: "UPGRADE_RECEIPT_INVALID" });
  expect((await readFile(f.path)).equals(state)).toBe(true);
});

test("a changed source snapshot invalidates the stop selections before any release", async () => {
  const f = await fixture(); f.state.revision++;
  await writeFile(f.path, JSON.stringify(f.state)); const changed = await readFile(f.path);
  await expect(upgradeStore(f.target, testMeta(f.actorB), f.input)).rejects.toMatchObject({ code: "UPGRADE_SOURCE_CHANGED" });
  expect((await readFile(f.path)).equals(changed)).toBe(true);
});

test.each(["bound-followup", "analysis-only", "read-only-entry", "no-persistence"])("upgrade stop exception rejects %s authority", async mode => {
  const f = await fixture(), meta = testMeta(f.actorB, "continue");
  if (mode === "bound-followup") meta.invocation.activation = "bound-followup";
  if (mode === "analysis-only") meta.invocation.analysisOnly = true;
  if (mode === "read-only-entry") meta.invocation.entry = "doctor";
  if (mode === "no-persistence") meta.invocation.persist = false;
  await expect(upgradeStore(f.target, meta, f.input)).rejects.toThrow();
  expect((await readFile(f.path)).equals(f.before)).toBe(true);
});
