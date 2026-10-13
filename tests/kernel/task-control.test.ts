import { controlInput } from "../helpers/task-control.js";
import { test, expect } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeGoalFixture, testMeta, git, authorizeFixtureTask } from "../helpers/kernel-fixture.js";
import { newActor, discoverRepository } from "../../src/kernel/repository.js";
import { takeOverTask, replaceExecutor, pauseTask, cancelTask, reopenTask, type ControlInput } from "../../src/kernel/task-control.js";
import { claimWork, assertWriteToken, addAssignment } from "../../src/kernel/ownership.js";
import { handoffWork, continueGoal } from "../../src/kernel/continuation.js";
import { readState } from "../../src/kernel/store.js";
import { createGoal, reviseContract } from "../../src/kernel/contracts.js";
import { executeCommand, executeReadCommand } from "../../src/application.js";
import { recordPlanningDocument, authorizeExecution } from "../../src/kernel/workflow.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { recordReportedEvidence } from "../../src/kernel/evidence.js";
import { recordCheckSet } from "../../src/kernel/delivery.js";
import { testEnvironment } from "../helpers/kernel-fixture.js";
import { resumeWork } from "../../src/kernel/resumption.js";
import type { ControlAction, RepositoryContext } from "../../src/kernel/types.js";


test.each(["no-claim", "read-only", "expired", "paused"])("new unbound actor takes over %s without business authority", async mode => {
  const f = await makeGoalFixture();
  if (mode === "read-only") {
    const { version: _, decision: __, ...draft } = structuredClone(f.task.contracts[0]!);
    draft.grant = { businessWrite: false, allowedPaths: [], delegate: false, commit: false, deploy: false };
    const task = await createGoal(f.context, testMeta(f.actorA, "plan"), { title: "Planning only", contract: draft, decision: { summary: "plan", reference: null } });
    f.task = task;
  }
  if (mode === "expired") {
    const { version: _, decision: __, ...contract } = f.task.contracts[0]!;
    await reviseContract(f.context, f.meta, { taskId: f.task.id, expectedVersion: 1, ownerEpoch: 1, contract, decision: { summary: "revise", reference: null } });
  }
  if (mode === "paused") await pauseTask(f.context, f.meta, await controlInput(f.context, f.task.id, "pause"));
  const meta = testMeta(f.actorB, "continue");
  const result = await executeCommand(f.context, "task takeover", { meta, payload: await controlInput(f.context, f.task.id, "takeover") });
  expect(result.error).toBeUndefined();
  const state = await readState(f.context);
  expect(state.tasks[f.task.id]!.owner.instanceId).toBe(f.actorB.instanceId);
  expect(Object.values(state.claims)).toHaveLength(0);
  if (mode !== "no-claim") await expect(claimWork(f.context, meta, { taskId: f.task.id, assignmentId: null,
    contractVersion: state.tasks[f.task.id]!.contracts.at(-1)!.version })).rejects.toThrow();
});

test("replacing an owner fences its work while retaining another writer's exact token", async () => {
  const f = await makeGoalFixture(), c = newActor("third"), bctx = await discoverRepository(f.linkedRoot);
  const assignment = await addAssignment(f.context, f.meta, { taskId: f.task.id, ownerEpoch: 1,
    assignment: { outcome: "retained collaborator", dependsOn: [], assignee: f.actorB.instanceId, businessWrite: true } });
  const old = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const retained = await claimWork(bctx, testMeta(f.actorB), { taskId: f.task.id, assignmentId: assignment.id, contractVersion: 1 });
  const before = await readState(f.context);
  await takeOverTask(f.context, testMeta(c, "continue"), await controlInput(f.context, f.task.id, "takeover"));
  const after = await readState(f.context);
  expect(after.claims[bctx.workspaceId]).toEqual(before.claims[bctx.workspaceId]);
  expect(after.tasks[f.task.id]!.workflow).toEqual(before.tasks[f.task.id]!.workflow);
  await assertWriteToken(bctx, after, testMeta(f.actorB), retained);
  await expect(assertWriteToken(f.context, after, f.meta, old)).rejects.toThrow();
  await expect(claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 })).rejects.toMatchObject({ code: "EXECUTOR_REPLACED" });
  expect(after.claims[f.context.workspaceId]!.state).toBe("unknown-writer-hold");
});

test.each([false, true])("replacing a collaborator (claimed=%s) preserves owner and other work", async claimed => {
  const f = await makeGoalFixture(), c = newActor("third"), bctx = await discoverRepository(f.linkedRoot);
  const assignment = await addAssignment(f.context, f.meta, { taskId: f.task.id, ownerEpoch: 1,
    assignment: { outcome: "replace collaborator", dependsOn: [], assignee: f.actorB.instanceId, businessWrite: true } });
  const owner = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  if (claimed) await claimWork(bctx, testMeta(f.actorB), { taskId: f.task.id, assignmentId: assignment.id, contractVersion: 1 });
  const input = { ...await controlInput(f.context, f.task.id, "replace-executor"), fromInstanceId: f.actorB.instanceId, to: c };
  await replaceExecutor(f.context, f.meta, input);
  const state = await readState(f.context), task = state.tasks[f.task.id]!;
  expect(task.owner).toEqual(f.task.owner);
  expect(task.assignments[assignment.id]!.assignee).toBe(c.instanceId);
  await assertWriteToken(f.context, state, f.meta, owner);
  await expect(claimWork(bctx, testMeta(f.actorB), { taskId: f.task.id, assignmentId: assignment.id, contractVersion: 1 })).rejects.toMatchObject({ code: "EXECUTOR_REPLACED" });
  if (!claimed) await claimWork(bctx, testMeta(c), { taskId: f.task.id, assignmentId: assignment.id, contractVersion: 1 });
  else expect(task.control!.recoveries[0]!.toInstanceId).toBe(c.instanceId);
});

test("owner change preserves a handed-off main writer", async () => {
  const f = await makeGoalFixture(), c = newActor("third");
  const first = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const { contractVersion: _, ...from } = first;
  const retained = await handoffWork(f.context, f.meta, { from, to: f.actorB, contractVersion: 1, transferOwner: false, ownerEpoch: null, decision: null });
  await takeOverTask(f.context, testMeta(c), await controlInput(f.context, f.task.id, "takeover"));
  await assertWriteToken(f.context, await readState(f.context), testMeta(f.actorB), retained);
});

test("replacing a handed-off main writer does not require transferring delivery ownership", async () => {
  const f = await makeGoalFixture(), c = newActor("third");
  const first = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const { contractVersion: _, ...from } = first;
  await handoffWork(f.context, f.meta, { from, to: f.actorB, contractVersion: 1, transferOwner: false, ownerEpoch: null, decision: null });
  await replaceExecutor(f.context, f.meta, { ...await controlInput(f.context, f.task.id, "replace-executor"), fromInstanceId: f.actorB.instanceId, to: c });
  const task = (await readState(f.context)).tasks[f.task.id]!;
  expect(task.owner).toEqual(f.task.owner);
  const token = await resumeWork(f.context, testMeta(c, "continue"), { taskId: task.id, recoveryId: task.control!.recoveries.at(-1)!.id,
    contractVersion: 1, request: { action: "resume", userMessage: "B stopped; continue its files", reference: "fixture:stopped-B" },
    mode: "existing", stopBasis: "user-declared-stop", stopReference: "fixture:stopped-B", snapshotId: null, baseCommit: null, abandonUncaptured: false });
  await assertWriteToken(f.context, await readState(f.context), testMeta(c), token);
  expect((await readState(f.context)).tasks[f.task.id]!.owner).toEqual(f.task.owner);
});

test("replacing a historical writer cannot steal an assignment already given to another actor", async () => {
  const f = await makeGoalFixture(), c = newActor("third");
  const assignment = await addAssignment(f.context, f.meta, { taskId: f.task.id, ownerEpoch: 1,
    assignment: { outcome: "reassigned work", dependsOn: [], assignee: f.actorB.instanceId, businessWrite: true } });
  await replaceExecutor(f.context, f.meta, { ...await controlInput(f.context, f.task.id, "replace-executor"), fromInstanceId: f.actorB.instanceId, to: c });
  await expect(replaceExecutor(f.context, f.meta, { ...await controlInput(f.context, f.task.id, "replace-executor"), fromInstanceId: f.actorB.instanceId, to: f.actorA }))
    .rejects.toMatchObject({ code: "EXECUTOR_NOT_ASSIGNED" });
  expect((await readState(f.context)).tasks[f.task.id]!.assignments[assignment.id]!.assignee).toBe(c.instanceId);
});

test("double takeover preserves source and historical retries do not claim current ownership", async () => {
  const f = await makeGoalFixture(), c = newActor("third");
  await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const input = await controlInput(f.context, f.task.id, "takeover"), b = testMeta(f.actorB);
  await takeOverTask(f.context, b, input);
  await takeOverTask(f.context, testMeta(c), await controlInput(f.context, f.task.id, "takeover"));
  const replay = await takeOverTask(f.context, b, input);
  expect(replay.stillCurrent).toBe(false);
  expect(replay.current.owner.instanceId).toBe(c.instanceId);
  const pending = (await readState(f.context)).tasks[f.task.id]!.control!.recoveries.filter(r => r.state === "pending");
  expect(pending).toHaveLength(1);
  expect(pending[0]!.from.instanceId).toBe(f.actorA.instanceId);
  expect(pending[0]!.toInstanceId).toBe(c.instanceId);
});

test("concurrent takeovers allow exactly one winner", async () => {
  const f = await makeGoalFixture(), input = await controlInput(f.context, f.task.id, "takeover");
  const result = await Promise.allSettled([takeOverTask(f.context, testMeta(f.actorB), input), takeOverTask(f.context, testMeta(newActor("third")), input)]);
  expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(result.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "CONTROL_CHANGED" } });
});

test.each(["orient", "doctor", "check", "plan", "finish", "brainstorm"] as const)("%s cannot control tasks", async entry => {
  const f = await makeGoalFixture();
  await expect(cancelTask(f.context, testMeta(f.actorB, entry), await controlInput(f.context, f.task.id, "cancel"))).rejects.toMatchObject({ code: "ENTRY_SCOPE_DENIED" });
});

test.each(["none", "bound-followup", "analysis", "ephemeral"])("control rejects %s invocation", async mode => {
  const f = await makeGoalFixture(), meta = testMeta(f.actorB, "continue");
  if (mode === "none" || mode === "bound-followup") meta.invocation.activation = mode;
  if (mode === "analysis") meta.invocation.analysisOnly = true;
  if (mode === "ephemeral") meta.invocation.persist = false;
  const before = await readState(f.context);
  await expect(cancelTask(f.context, meta, await controlInput(f.context, f.task.id, "cancel"))).rejects.toThrow();
  expect(await readState(f.context)).toEqual(before);
});

test("nonowner cancels and reopens same ID; old execution, assignments and evidence do not revive", async () => {
  const f = await makeGoalFixture(), b = testMeta(f.actorB, "continue");
  const token = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const assignment = await addAssignment(f.context, f.meta, { taskId: f.task.id, ownerEpoch: 1,
    assignment: { outcome: "old work", dependsOn: [], assignee: f.actorA.instanceId, businessWrite: true } });
  const bytes = await readFile(join(f.root, "src/app.ts"));
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token });
  const evidence = await recordReportedEvidence(f.context, f.meta, { taskId: f.task.id, contractVersion: 1, snapshotId: snapshot.id,
    result: "pass", phase: null, argv: null, exitCode: null, summary: "old evidence", environment: testEnvironment() });
  await cancelTask(f.context, b, await controlInput(f.context, f.task.id, "cancel"));
  expect((await readFile(join(f.root, "src/app.ts"))).equals(bytes)).toBe(true);
  const view = await continueGoal(f.context, b, { taskId: f.task.id, assignmentId: null });
  expect(view.writeToken).toBeNull(); expect(view.missing).toContain("TASK_READ_ONLY");
  const orient = await executeReadCommand(f.context, "orient", {});
  expect((orient.data as { tasks: unknown[] }).tasks).toHaveLength(0);
  await reopenTask(f.context, testMeta(f.actorB, "continue"), await controlInput(f.context, f.task.id, "reopen"));
  const task = (await readState(f.context)).tasks[f.task.id]!;
  expect(task.status).toBe("active"); expect(task.control!.round).toBe(2);
  expect(task.contracts.at(-1)!.version).toBe(2);
  expect(task.assignments[assignment.id]!.status).toBe("cancelled");
  expect(task.workflow!.authorizations.every(a => a.revoked)).toBe(true);
  expect(task.evidence[evidence.id]).toEqual(evidence);
  await expect(assertWriteToken(f.context, await readState(f.context), f.meta, token)).rejects.toThrow();
  await expect(recordCheckSet(f.context, testMeta(f.actorB), { taskId: task.id, contractVersion: 2, snapshotId: snapshot.id, independent: false,
    rows: [{ acceptanceId: "A1", result: "pass", evidenceIds: [evidence.id], summary: "stale", gapDecision: null }],
    verification: [{ evidenceId: evidence.id, argv: null, environment: evidence.environment }] })).rejects.toMatchObject({ code: "EVIDENCE_VERSION_MISMATCH" });
  const bctx = await discoverRepository(f.linkedRoot);
  await authorizeFixtureTask(bctx, f.actorB, task.id, 2, task.owner.epoch);
  await expect(claimWork(bctx, testMeta(f.actorB), { taskId: task.id, contractVersion: 2, assignmentId: null }))
    .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  const { contractVersion: _, ...from } = token;
  await resumeWork(bctx, testMeta(f.actorB), { taskId: task.id, contractVersion: 2, recoveryId: null, from,
    request: { action: "resume", userMessage: "Use the original snapshot for the reopened task", reference: "fixture:reopen-recovery" },
    mode: "snapshot", stopBasis: "unknown", stopReference: null, snapshotId: snapshot.id, baseCommit: null, abandonUncaptured: false });
});

test("invalid planning artifacts cannot prevent cancellation", async () => {
  const f = await makeGoalFixture();
  await pauseTask(f.context, f.meta, await controlInput(f.context, f.task.id, "pause"));
  const doc = await recordPlanningDocument(f.context, f.meta, { taskId: f.task.id, contractVersion: 1, ownerEpoch: 1, kind: "brief", content: "brief" });
  await writeFile(join(f.context.storeRoot, doc.path), "tampered");
  await cancelTask(f.context, testMeta(f.actorB), await controlInput(f.context, f.task.id, "cancel"));
  expect((await readState(f.context)).tasks[f.task.id]!.status).toBe("cancelled");
});
