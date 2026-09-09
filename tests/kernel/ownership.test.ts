import { rm } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, vi } from "vitest";
import { claimWork, releaseWork, assertWriteToken, executionKey, addAssignment } from "../../src/kernel/ownership.js";
import { bindSession, resolveActor } from "../../src/kernel/sessions.js";
import { readState, mutateState } from "../../src/kernel/store.js";
import { discoverRepository } from "../../src/kernel/repository.js";
import { makeGoalFixture, testMeta } from "../helpers/kernel-fixture.js";
import { fingerprintFixtureTree } from "../helpers/kernel-fixture.js";
import { handoffWork, continueGoal } from "../../src/kernel/continuation.js";
import * as io from "../../src/kernel/io.js";

test("binding removal does not release the writer and explicit identities survive CLI-style resolution", async () => {
  const f = await makeGoalFixture();
  await bindSession(f.context, f.meta, { taskId: f.task.id, assignmentId: null });
  const token = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  await rm(join(f.context.storeRoot, "runtime/bindings"), { recursive: true, force: true });
  await expect(claimWork(f.context, testMeta(f.actorB), { taskId: f.task.id, assignmentId: null, contractVersion: 1 })).rejects.toMatchObject({ code: "WORKSPACE_OCCUPIED" });
  expect(await resolveActor(f.context, { host: f.actorA.host, instanceId: f.actorA.instanceId })).toEqual(f.actorA);
  await expect(resolveActor(f.context, { host: "codex" })).rejects.toMatchObject({ code: "ACTOR_RESOLUTION_REQUIRED" });
  await releaseWork(f.context, f.meta, token);
  const next = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  expect(next.epoch).toBe(token.epoch + 1);
  const state = await readState(f.context);
  expect(() => assertWriteToken(f.context, state, f.meta, token)).toThrow();
});
test("unknown holds block new work even when the task has a newer writer elsewhere", async () => {
  const f = await makeGoalFixture();
  const first = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  await mutateState(f.context, f.meta, { test: "hold" }, state => {
    state.claims[first.workspaceId] = { ...first, state: "unknown-writer-hold", recovery: null };
    state.epochs[executionKey(first.taskId, null)] = first.epoch + 1;
    return [];
  });
  await expect(claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 })).rejects.toMatchObject({ code: "WORKSPACE_OCCUPIED" });
});
test("separate assignments can claim separate worktrees without inventing roles", async () => {
  const f = await makeGoalFixture();
  const assignment = await addAssignment(f.context, f.meta, { taskId: f.task.id, ownerEpoch: 1,
    assignment: { outcome: "independent change", dependsOn: [], assignee: f.actorB.instanceId, businessWrite: true } });
  await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const other = await discoverRepository(f.linkedRoot);
  const token = await claimWork(other, testMeta(f.actorB), { taskId: f.task.id, assignmentId: assignment.id, contractVersion: 1 });
  expect(token.workspaceId).toBe(other.workspaceId);
});

test("handoff ownership survives a later runtime binding write failure", async () => {
  const f = await makeGoalFixture(), old = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const { contractVersion: _, ...from } = old;
  const token = await handoffWork(f.context, f.meta, { from, to: f.actorB, contractVersion: 1, transferOwner: false, ownerEpoch: null, decision: null });
  const real = io.writeJson, b = testMeta(f.actorB, "continue");
  const failing = vi.spyOn(io, "writeJson").mockImplementation(async (...args) => {
    if (args[2].startsWith("runtime/bindings/")) throw new Error("injected binding failure");
    await real(...args);
  });
  try { await expect(continueGoal(f.context, b, { taskId: f.task.id, assignmentId: null })).rejects.toThrow("binding failure"); }
  finally { failing.mockRestore(); }
  expect((await readState(f.context)).claims[f.context.workspaceId]!.instanceId).toBe(f.actorB.instanceId);
  expect((await continueGoal(f.context, b, { taskId: f.task.id, assignmentId: null })).writeToken).toEqual(token);
});

test("first-time read-only join allocates local identity without inventing a host session or borrowing an owner", async () => {
  const f = await makeGoalFixture();
  await bindSession(f.context, f.meta, { taskId: f.task.id, assignmentId: null });
  await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const ctx = await discoverRepository(f.linkedRoot), before = await fingerprintFixtureTree(ctx.storeRoot);
  const joining = await resolveActor(ctx, { host: "claude", newInstance: true });
  expect(joining.instanceId).not.toBe(f.actorA.instanceId);
  expect(joining.hostSessionId).toBeUndefined();
  expect(await fingerprintFixtureTree(ctx.storeRoot)).toBe(before);
  const view = await continueGoal(ctx, testMeta(joining, "continue"), { taskId: f.task.id, assignmentId: null });
  expect(view.binding.actor).toEqual(joining); expect(view.writeToken).toBeNull();
  expect(view.owner.instanceId).toBe(f.actorA.instanceId);
});
