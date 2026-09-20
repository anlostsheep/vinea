import { randomUUID } from "node:crypto";
import { currentContract, getTask, assertEntry, assertOwner, assertContract } from "./policy.js";
import { contractDraftRule, decisionRule, text } from "./schema.js";
import { readState, mutateState } from "./store.js";
import { requireThat } from "./errors.js";
import type { ContractDraft, Contract, Decision, Meta, RepositoryContext, Task } from "./types.js";
import { TASK_PROTOCOL, taskWorkflow } from "./workflow-policy.js";

export function makeTask(title: string, draft: ContractDraft, decision: Decision, meta: Meta): Task {
  return { id: randomUUID(), title, status: "active", contracts: [{ ...structuredClone(draft), version: 1, decision }],
    owner: { instanceId: meta.actor.instanceId, epoch: 1 }, assignments: {}, contributions: {}, evidence: {}, checks: {},
    diagnostics: [], deliveries: {}, userAcceptances: [], relatedTo: null, legacySource: null,
    workflow: { protocol: TASK_PROTOCOL, planningRequired: ["brainstorm", "plan"].includes(meta.invocation.entry), documents: [], authorizations: [] } };
}
export async function createGoal(ctx: RepositoryContext, meta: Meta, input: { title: string; contract: ContractDraft; decision: Decision; planningRequired?: boolean }): Promise<Task> {
  assertEntry(meta, null, "state-write"); contractDraftRule(input.contract); decisionRule(input.decision); text(input.title);
  requireThat(["brainstorm", "plan", "run", "continue", "debug"].includes(meta.invocation.entry), "ENTRY_SCOPE_DENIED", "This entry cannot create tasks");
  requireThat(input.contract.acceptance.length > 0, "ACCEPTANCE_REQUIRED", "At least one acceptance criterion is required");
  const receipt = await mutateState(ctx, meta, { command: "task.create", input }, state => {
    const task = makeTask(input.title, input.contract, input.decision, meta);
    if (input.planningRequired) taskWorkflow(task).planningRequired = true;
    state.tasks[task.id] = task; return [task.id];
  });
  return (await readState(ctx)).tasks[receipt.resourceIds[0]!]!;
}
export async function reviseContract(ctx: RepositoryContext, meta: Meta, input: {
  taskId: string; expectedVersion: number; ownerEpoch: number; contract: ContractDraft; decision: Decision;
}): Promise<Contract> {
  contractDraftRule(input.contract); decisionRule(input.decision);
  requireThat(input.contract.acceptance.length > 0, "ACCEPTANCE_REQUIRED", "At least one acceptance criterion is required");
  const receipt = await mutateState(ctx, meta, { command: "task.revise", input }, state => {
    const task = getTask(state, input.taskId);
    assertEntry(meta, task, "state-write"); assertOwner(task, meta, input.ownerEpoch); assertContract(task, input.expectedVersion);
    taskWorkflow(task);
    requireThat(!Object.values(state.claims).some(c => c.taskId === task.id && c.state === "restore-target"),
      "RESTORE_IN_PROGRESS", "Complete the reserved recovery or explicitly suspend it before revising the contract");
    const previous = currentContract(task);
    const widensPaths = input.contract.grant.allowedPaths.some(path => !previous.grant.allowedPaths.some(root => path === root || path.startsWith(`${root}/`)));
    if (widensPaths || ["businessWrite", "delegate", "commit", "deploy"].some(key => !previous.grant[key as keyof typeof previous.grant] && input.contract.grant[key as keyof typeof previous.grant])) {
      assertEntry(meta, null, "business-write");
    }
    task.contracts.push({ ...structuredClone(input.contract), version: previous.version + 1, decision: input.decision });
    return [task.id, String(previous.version + 1)];
  });
  return (await readState(ctx)).tasks[input.taskId]!.contracts[Number(receipt.resourceIds[1]) - 1]!;
}
