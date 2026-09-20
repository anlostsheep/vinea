import { test, expect } from "vitest";
import { makeGoalFixture, testMeta, fingerprintFixtureTree, authorizeFixtureTask } from "../helpers/kernel-fixture.js";
import { createGoal, reviseContract } from "../../src/kernel/contracts.js";
import { claimWork, assertWriteToken, addAssignment } from "../../src/kernel/ownership.js";
import { executeCommand } from "../../src/application.js";
import { readState, inspectStore } from "../../src/kernel/store.js";
import { authorizeExecution, recordPlanningDocument, suspendExecution } from "../../src/kernel/workflow.js";
import { continueGoal, handoffWork } from "../../src/kernel/continuation.js";
import { discoverRepository } from "../../src/kernel/repository.js";
import { readFile, writeFile, mkdir, unlink, symlink } from "node:fs/promises";
import { join } from "node:path";

async function planningFixture() {
  const f = await makeGoalFixture(), { version: _, decision, ...contract } = f.task.contracts[0]!;
  const task = await createGoal(f.context, testMeta(f.actorA, "plan"), { title: "Persistent plan", contract, decision });
  return { ...f, get meta() { return testMeta(f.actorA); }, task, input: { taskId: task.id, contractVersion: 1, ownerEpoch: 1 } };
}
const request = { kind: "implementation-request" as const, userMessage: "Implement this plan", reference: "fixture:user:execute", action: null };
async function documents(f: Awaited<ReturnType<typeof planningFixture>>) {
  const brief = await recordPlanningDocument(f.context, testMeta(f.actorA, "plan"), { ...f.input, kind: "brief", content: "# Brief\nGoal, scope, constraints and acceptance.\n" });
  const plan = await recordPlanningDocument(f.context, testMeta(f.actorA, "plan"), { ...f.input, kind: "plan", content: "# Plan\nImplement the change, then run its regression tests.\n" });
  return { brief, plan };
}

test("an explicit planning request can persist a task without granting execution", async () => {
  const f = await makeGoalFixture();
  const { version: _, decision, ...contract } = f.task.contracts[0]!;
  const task = await createGoal(f.context, testMeta(f.actorA, "plan"), { title: "Plan only", contract, decision });
  expect(task).toMatchObject({ workflow: { protocol: "planning-authorization-v1", planningRequired: true, authorizations: [] } });
  await expect(claimWork(f.context, f.meta, { taskId: task.id, assignmentId: null, contractVersion: 1 }))
    .rejects.toMatchObject({ code: "EXECUTION_NOT_AUTHORIZED" });
});

test("declaring run and businessWrite does not replace an execution request", async () => {
  const f = await makeGoalFixture();
  const { version: _, decision, ...contract } = f.task.contracts[0]!;
  const task = await createGoal(f.context, f.meta, { title: "Self-declared run", contract, decision });
  await expect(claimWork(f.context, f.meta, { taskId: task.id, assignmentId: null, contractVersion: 1 }))
    .rejects.toMatchObject({ code: "EXECUTION_NOT_AUTHORIZED" });
});

test("continuation is rejected as a fresh implementation authorization", async () => {
  const f = await makeGoalFixture();
  const result = await executeCommand(f.context, "task authorize", { meta: f.meta, payload: {
    taskId: f.task.id, contractVersion: 1, ownerEpoch: 1,
    request: { kind: "continuation", userMessage: "Continue to the next step", reference: "fixture:user:1", action: null },
  } });
  expect(result.error?.code).toBe("EXECUTION_REQUEST_REQUIRED");
});

test("suspension invalidates a current writer without changing business files", async () => {
  const f = await makeGoalFixture();
  await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const before = await fingerprintFixtureTree(`${f.root}/src`);
  const result = await executeCommand(f.context, "task suspend", { meta: testMeta(f.actorA, "plan"), payload: {
    taskId: f.task.id, contractVersion: 1, ownerEpoch: 1, decision: { summary: "Stop implementation", reference: "fixture:user:stop" },
  } });
  expect(result.error).toBeUndefined();
  expect((await readState(f.context)).claims[f.context.workspaceId]?.state).toBe("released");
  await expect(claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 }))
    .rejects.toMatchObject({ code: "EXECUTION_NOT_AUTHORIZED" });
  expect(await fingerprintFixtureTree(`${f.root}/src`)).toBe(before);
});

test("both current documents are required and stored as readable immutable Markdown", async () => {
  const f = await planningFixture();
  await expect(authorizeExecution(f.context, f.meta, { ...f.input, request })).rejects.toMatchObject({ code: "PLANNING_INCOMPLETE" });
  await recordPlanningDocument(f.context, f.meta, { ...f.input, kind: "brief", content: "# Brief\nBounded goal" });
  await expect(authorizeExecution(f.context, f.meta, { ...f.input, request })).rejects.toMatchObject({ code: "PLANNING_INCOMPLETE" });
  const { brief, plan } = await documents(f);
  expect(await readFile(join(f.context.storeRoot, plan.path), "utf8")).toContain("# Plan");
  const authorization = await authorizeExecution(f.context, f.meta, { ...f.input, request });
  expect(authorization.documentIds).toEqual([brief.id, plan.id]);
  expect(authorization.request).toEqual(request);
  await expect(claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 })).resolves.toMatchObject({ epoch: 1 });
  await expect(recordPlanningDocument(f.context, f.meta, { ...f.input, kind: "plan", content: "Different plan" })).rejects.toMatchObject({ code: "PLANNING_LOCKED" });
});

test("changed artifact bytes block claims, resumed tokens and handoff including idempotent claim retries", async () => {
  const f = await planningFixture(), { plan } = await documents(f);
  await authorizeExecution(f.context, f.meta, { ...f.input, request });
  const meta = f.meta, input = { taskId: f.task.id, assignmentId: null, contractVersion: 1 };
  const token = await claimWork(f.context, meta, input);
  await writeFile(join(f.context.storeRoot, plan.path), "tampered");
  await expect(claimWork(f.context, meta, input)).rejects.toMatchObject({ code: "PLANNING_ARTIFACT_INVALID" });
  const view = await continueGoal(f.context, f.meta, { taskId: f.task.id, assignmentId: null });
  expect(view.writeToken).toBeNull(); expect(view.missing).toContain("PLANNING_ARTIFACT_INVALID");
  const { contractVersion: _, ...from } = token;
  await expect(handoffWork(f.context, f.meta, { from, to: f.actorB, contractVersion: 1, transferOwner: false, ownerEpoch: null, decision: null }))
    .rejects.toMatchObject({ code: "PLANNING_ARTIFACT_INVALID" });
  expect((await inspectStore(f.context)).status).toBe("invalid");
});

test("a revised contract needs new planning and authorization, not reused old evidence", async () => {
  const f = await planningFixture(); await documents(f);
  await authorizeExecution(f.context, f.meta, { ...f.input, request });
  const { version: _, decision, ...contract } = f.task.contracts[0]!;
  await reviseContract(f.context, f.meta, { taskId: f.task.id, expectedVersion: 1, ownerEpoch: 1, contract, decision });
  await expect(claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 2 }))
    .rejects.toMatchObject({ code: "EXECUTION_NOT_AUTHORIZED" });
  await expect(authorizeExecution(f.context, f.meta, { ...f.input, contractVersion: 2, request }))
    .rejects.toMatchObject({ code: "PLANNING_INCOMPLETE" });
});

test("authorization requires provenance and concrete confirmation, and cannot come from a bound follow-up", async () => {
  const f = await planningFixture(); await documents(f);
  for (const badRequest of [{ ...request, reference: "" }, { ...request, reference: null }]) {
    const result = await executeCommand(f.context, "task authorize", { meta: f.meta, payload: { ...f.input, request: badRequest } });
    expect(result.error?.code).toBe("SCHEMA_INVALID");
  }
  await expect(authorizeExecution(f.context, f.meta, { ...f.input, request: { ...request, kind: "plan-approval" } }))
    .rejects.toMatchObject({ code: "EXECUTION_REQUEST_REQUIRED" });
  await expect(authorizeExecution(f.context, f.meta, { ...f.input, request: { ...request, kind: "implementation-confirmation", userMessage: "Yes" } }))
    .rejects.toMatchObject({ code: "EXECUTION_ACTION_REQUIRED" });
  const meta = f.meta; meta.invocation.activation = "bound-followup";
  await expect(authorizeExecution(f.context, meta, { ...f.input, request })).rejects.toMatchObject({ code: "EXECUTION_REQUEST_REQUIRED" });
  await expect(authorizeExecution(f.context, testMeta(f.actorA, "plan"), { ...f.input, request })).rejects.toMatchObject({ code: "ENTRY_SCOPE_DENIED" });
});

test("document and authorization retries are idempotent and suspension is not undone by replay", async () => {
  const f = await planningFixture(), documentMeta = f.meta;
  const input = { ...f.input, kind: "brief" as const, content: "Brief content" };
  const a = await recordPlanningDocument(f.context, documentMeta, input);
  expect(await recordPlanningDocument(f.context, documentMeta, input)).toEqual(a);
  await recordPlanningDocument(f.context, f.meta, { ...f.input, kind: "plan", content: "Plan content" });
  const authMeta = f.meta, authorization = await authorizeExecution(f.context, authMeta, { ...f.input, request });
  expect(await authorizeExecution(f.context, authMeta, { ...f.input, request })).toEqual(authorization);
  const token = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  await suspendExecution(f.context, f.meta, { ...f.input, decision: { summary: "Stop", reference: "fixture:stop" } });
  await expect(authorizeExecution(f.context, authMeta, { ...f.input, request })).rejects.toMatchObject({ code: "EXECUTION_NOT_AUTHORIZED" });
  await expect(authorizeExecution(f.context, f.meta, { ...f.input, request })).rejects.toMatchObject({ code: "AUTHORIZATION_REFERENCE_REUSED" });
  await expect(claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 })).rejects.toMatchObject({ code: "EXECUTION_NOT_AUTHORIZED" });
  await authorizeExecution(f.context, f.meta, { ...f.input, request: { ...request, reference: "fixture:new-approval" } });
  const state = await readState(f.context);
  await expect(assertWriteToken(f.context, state, f.meta, token)).rejects.toThrow();
  const fresh = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  expect(fresh.epoch).toBeGreaterThan(token.epoch);
});

test("suspension fences a remote contributor but retains its uncertain occupancy", async () => {
  const f = await makeGoalFixture(), peer = await discoverRepository(f.linkedRoot);
  const assignment = await addAssignment(f.context, f.meta, { taskId: f.task.id, ownerEpoch: 1,
    assignment: { outcome: "Change", dependsOn: [], assignee: f.actorB.instanceId, businessWrite: true } });
  const token = await claimWork(peer, testMeta(f.actorB), { taskId: f.task.id, assignmentId: assignment.id, contractVersion: 1 });
  await suspendExecution(f.context, testMeta(f.actorA, "plan"), { taskId: f.task.id, contractVersion: 1, ownerEpoch: 1,
    decision: { summary: "Stop all implementation", reference: "fixture:user:stop" } });
  const state = await readState(f.context);
  expect(state.claims[peer.workspaceId]?.state).toBe("unknown-writer-hold");
  await expect(assertWriteToken(peer, state, testMeta(f.actorB), token)).rejects.toThrow();
  await authorizeFixtureTask(f.context, f.actorA, f.task.id);
  await expect(claimWork(peer, testMeta(f.actorB), { taskId: f.task.id, assignmentId: assignment.id, contractVersion: 1 }))
    .rejects.toMatchObject({ code: "WORKSPACE_OCCUPIED" });
});

test("pre-protocol tasks are readable but cannot acquire execution without migration", async () => {
  const f = await makeGoalFixture(), path = join(f.context.storeRoot, "tasks/state.json");
  const state = await readState(f.context); delete state.tasks[f.task.id]!.workflow;
  await writeFile(path, JSON.stringify(state));
  const before = await fingerprintFixtureTree(f.context.storeRoot);
  expect((await readState(f.context)).tasks[f.task.id]!.workflow).toBeUndefined();
  await expect(claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 }))
    .rejects.toMatchObject({ code: "TASK_PROTOCOL_REQUIRED" });
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});

test("legacy planning records are diagnosed without hiding active kernel writers", async () => {
  const f = await makeGoalFixture(); await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const legacy = join(f.root, ".vinea/tasks/active/old-task"); await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "task.json"), JSON.stringify({ status: "planning" }));
  const before = await fingerprintFixtureTree(f.context.storeRoot);
  const report = await inspectStore(f.context);
  expect(report.status).toBe("conflicted"); expect(report.issues.map(i => i.code)).toContain("LEGACY_ACTIVE_STATE_PRESENT");
  expect((await readState(f.context)).claims[f.context.workspaceId]?.state).toBe("writer");
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});

test("ephemeral planning and unauthorized owners leave artifacts and state unchanged", async () => {
  const f = await planningFixture(), before = await fingerprintFixtureTree(f.context.storeRoot);
  const meta = f.meta; meta.invocation.persist = false;
  await expect(recordPlanningDocument(f.context, meta, { ...f.input, kind: "plan", content: "No write" })).rejects.toMatchObject({ code: "PERSISTENCE_DISABLED" });
  await expect(recordPlanningDocument(f.context, testMeta(f.actorB, "plan"), { ...f.input, kind: "brief", content: "Not owner" })).rejects.toMatchObject({ code: "OWNER_CHANGED" });
  expect(await fingerprintFixtureTree(f.context.storeRoot)).toBe(before);
});

test("choosing persistent planning on a direct task cannot leave the plan optional", async () => {
  const f = await makeGoalFixture(), input = { taskId: f.task.id, contractVersion: 1, ownerEpoch: 1 };
  await suspendExecution(f.context, f.meta, { ...input, decision: { summary: "Plan before further implementation", reference: "fixture:plan-first" } });
  await recordPlanningDocument(f.context, testMeta(f.actorA, "plan"), { ...input, kind: "brief", content: "Revised brief" });
  await expect(authorizeExecution(f.context, f.meta, { ...input, request })).rejects.toMatchObject({ code: "PLANNING_INCOMPLETE" });
  expect((await readState(f.context)).tasks[f.task.id]!.workflow!.planningRequired).toBe(true);
});

test.each(["missing", "symlink"])("%s planning content cannot authorize work", async condition => {
  const f = await planningFixture(), { plan } = await documents(f), path = join(f.context.storeRoot, plan.path);
  await unlink(path);
  if (condition === "symlink") await symlink(join(f.root, "src/app.ts"), path);
  const before = await readFile(join(f.context.storeRoot, "tasks/state.json"), "utf8");
  await expect(authorizeExecution(f.context, f.meta, { ...f.input, request }))
    .rejects.toMatchObject({ code: condition === "symlink" ? "UNSAFE_PATH" : "PLANNING_ARTIFACT_INVALID" });
  expect(await readFile(join(f.context.storeRoot, "tasks/state.json"), "utf8")).toBe(before);
});
