import { createHash, randomUUID } from "node:crypto";
import { assertEntry, assertOwner, assertContract, getTask } from "./policy.js";
import { assertExecution, currentDocuments, taskWorkflow } from "./workflow-policy.js";
import { mutateState, readState } from "./store.js";
import { readManaged, writeManaged } from "./io.js";
import { decisionRule, executionRequestRule, one, text } from "./schema.js";
import { KernelError, requireThat } from "./errors.js";
import type { RepositoryContext, Meta, Task, PlanningArtifact, ExecutionRequest, ExecutionAuthorization, Decision } from "./types.js";

type TaskVersion = { taskId: string; contractVersion: number; ownerEpoch: number };

export async function validatePlanningArtifacts(ctx: RepositoryContext, task: Task): Promise<void> {
  for (const document of currentDocuments(task)) {
    try {
      const content = await readManaged(ctx, document.path);
      requireThat(createHash("sha256").update(content).digest("hex") === document.sha256,
        "PLANNING_ARTIFACT_INVALID", "Planning artifact content changed");
    } catch (error) {
      if (error instanceof KernelError && error.code === "UNSAFE_PATH") throw error;
      throw new KernelError("PLANNING_ARTIFACT_INVALID", "A current planning artifact is missing or changed", { path: document.path });
    }
  }
}
export async function recordPlanningDocument(ctx: RepositoryContext, meta: Meta, input: TaskVersion & {
  kind: "brief" | "plan"; content: string;
}): Promise<PlanningArtifact> {
  text(input.content); one("brief", "plan")(input.kind);
  const receipt = await mutateState(ctx, meta, { command: "task.document", input }, async state => {
    const task = getTask(state, input.taskId);
    assertEntry(meta, task, "state-write"); assertOwner(task, meta, input.ownerEpoch); assertContract(task, input.contractVersion);
    const workflow = taskWorkflow(task), authorization = workflow.authorizations.at(-1);
    requireThat(!authorization || authorization.revoked || authorization.contractVersion !== input.contractVersion,
      "PLANNING_LOCKED", "Suspend execution before changing authorized planning documents");
    workflow.planningRequired = true;
    const sha256 = createHash("sha256").update(input.content).digest("hex");
    const path = `tasks/${task.id}/planning/v${input.contractVersion}/${input.kind}-${sha256}.md`;
    await writeManaged(ctx, meta, path, input.content, true);
    const document: PlanningArtifact = { id: randomUUID(), kind: input.kind, contractVersion: input.contractVersion, path, sha256 };
    workflow.documents.push(document); return [document.id];
  });
  return taskWorkflow((await readState(ctx)).tasks[input.taskId]!).documents.find(d => d.id === receipt.resourceIds[0])!;
}
export async function authorizeExecution(ctx: RepositoryContext, meta: Meta, input: TaskVersion & {
  request: ExecutionRequest;
}): Promise<ExecutionAuthorization> {
  executionRequestRule(input.request);
  requireThat(["implementation-request", "implementation-confirmation"].includes(input.request.kind),
    "EXECUTION_REQUEST_REQUIRED", "Continuation and plan approval cannot authorize implementation");
  requireThat(input.request.kind !== "implementation-confirmation" || input.request.action,
    "EXECUTION_ACTION_REQUIRED", "Confirmation must identify the concrete implementation action shown to the user");
  requireThat(meta.invocation.activation !== "bound-followup",
    "EXECUTION_REQUEST_REQUIRED", "A follow-up or continuation cannot mint new execution authority");
  assertEntry(meta, null, "business-write");
  requireThat(["run", "debug"].includes(meta.invocation.entry), "EXECUTION_REQUEST_REQUIRED", "Use an explicit execution request, not continuation");
  const receipt = await mutateState(ctx, meta, { command: "task.authorize", input }, async state => {
    const task = getTask(state, input.taskId);
    assertOwner(task, meta, input.ownerEpoch); assertContract(task, input.contractVersion);
    const workflow = taskWorkflow(task), documents = currentDocuments(task);
    requireThat(!workflow.planningRequired || documents.length === 2, "PLANNING_INCOMPLETE", "Persist the current brief and plan before authorization");
    await validatePlanningArtifacts(ctx, task);
    const previous = workflow.authorizations.at(-1);
    requireThat(!previous || previous.revoked || previous.contractVersion !== input.contractVersion,
      "EXECUTION_ALREADY_AUTHORIZED", "Reuse the current authorization instead of replacing its provenance");
    requireThat(!workflow.authorizations.some(a => a.request.reference === input.request.reference),
      "AUTHORIZATION_REFERENCE_REUSED", "A revoked or superseded approval cannot authorize a new execution attempt");
    const authorization: ExecutionAuthorization = { id: randomUUID(), contractVersion: input.contractVersion,
      documentIds: documents.map(d => d.id), request: structuredClone(input.request), actor: meta.actor,
      recordedAt: new Date().toISOString(), revoked: null };
    workflow.authorizations.push(authorization); assertExecution(task); return [authorization.id];
  });
  const task = getTask(await readState(ctx), input.taskId);
  assertOwner(task, meta, input.ownerEpoch); assertContract(task, input.contractVersion);
  const authorization = assertExecution(task);
  requireThat(authorization.id === receipt.resourceIds[0], "EXECUTION_NOT_AUTHORIZED", "The replayed authorization is no longer current");
  await validatePlanningArtifacts(ctx, task);
  return authorization;
}
export async function suspendExecution(ctx: RepositoryContext, meta: Meta, input: TaskVersion & { decision: Decision }): Promise<void> {
  decisionRule(input.decision);
  await mutateState(ctx, meta, { command: "task.suspend", input }, state => {
    const task = getTask(state, input.taskId);
    assertEntry(meta, task, "state-write"); assertOwner(task, meta, input.ownerEpoch); assertContract(task, input.contractVersion);
    const workflow = taskWorkflow(task);
    for (const authorization of workflow.authorizations) if (!authorization.revoked) authorization.revoked = structuredClone(input.decision);
    for (const claim of Object.values(state.claims).filter(c => c.taskId === task.id && ["writer", "restore-target"].includes(c.state))) {
      const key = JSON.stringify([claim.taskId, claim.assignmentId]);
      state.epochs[key] = (state.epochs[key] ?? claim.epoch) + 1;
      // Revocation is not evidence that another process has stopped writing.
      state.claims[claim.workspaceId] = claim.instanceId === meta.actor.instanceId && claim.workspaceId === ctx.workspaceId
        ? { ...claim, state: "released", recovery: null }
        : { ...claim, state: "unknown-writer-hold" };
    }
    task.diagnostics.push({ id: randomUUID(), kind: "change", text: `Execution suspended: ${input.decision.summary}; inspect business changes separately`,
      evidenceIds: [], actor: meta.actor, createdAt: new Date().toISOString() });
    return [task.id];
  });
}
