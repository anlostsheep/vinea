import { requireThat } from "./errors.js";
import type { Task, TaskWorkflow, PlanningArtifact, ExecutionAuthorization } from "./types.js";

export const TASK_PROTOCOL = "planning-authorization-v1" as const;

export function taskWorkflow(task: Task): TaskWorkflow {
  requireThat(task.workflow?.protocol === TASK_PROTOCOL, "TASK_PROTOCOL_REQUIRED",
    "This task predates the execution protocol; inspect it without migrating or switching CLI versions");
  return task.workflow!;
}
export function currentDocuments(task: Task): PlanningArtifact[] {
  const version = task.contracts.at(-1)!.version;
  return (["brief", "plan"] as const).flatMap(kind => {
    const document = taskWorkflow(task).documents.filter(d => d.kind === kind && d.contractVersion === version).at(-1);
    return document ? [document] : [];
  });
}
export function assertExecution(task: Task): ExecutionAuthorization {
  const workflow = taskWorkflow(task), authorization = workflow.authorizations.at(-1);
  requireThat(authorization && !authorization.revoked && authorization.contractVersion === task.contracts.at(-1)!.version,
    "EXECUTION_NOT_AUTHORIZED", "Record an explicit implementation request for the current contract before acquiring business writes");
  const documents = currentDocuments(task);
  requireThat(!workflow.planningRequired || documents.length === 2, "PLANNING_INCOMPLETE", "Current brief and plan are required");
  requireThat(documents.length === authorization!.documentIds.length
    && documents.every(d => authorization!.documentIds.includes(d.id)), "PLANNING_CHANGED", "Planning changed since authorization");
  return authorization!;
}
