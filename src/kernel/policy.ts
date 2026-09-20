import { KernelError, requireThat } from "./errors.js";
import { assertPersistence } from "./io.js";
import { metaRule, id } from "./schema.js";
import type { Meta, Task, RepositoryState, Contract } from "./types.js";
import { assertExecution } from "./workflow-policy.js";

export function getTask(state: RepositoryState, taskId: string, mutable = true): Task {
  id(taskId);
  const task = state.tasks[taskId];
  requireThat(task, "TASK_NOT_FOUND", "Task was not found");
  if (mutable) requireThat(task.status === "active", "TASK_READ_ONLY", "Delivered and archived tasks are immutable; open a linked repair");
  return task;
}
export function currentContract(task: Task): Contract { return task.contracts[task.contracts.length - 1]!; }
export function assertContract(task: Task, version: number): void {
  requireThat(currentContract(task).version === version, "CONTRACT_VERSION_CHANGED", "Read the current contract before continuing");
}
export function assertOwner(task: Task, meta: Meta, epoch: number): void {
  requireThat(task.owner.instanceId === meta.actor.instanceId && task.owner.epoch === epoch, "OWNER_CHANGED", "Delivery ownership has changed");
}
export function assertEntry(meta: Meta, task: Task | null, capability: "state-write" | "business-write" | "delegate"): void {
  metaRule(meta); assertPersistence(meta);
  requireThat(meta.invocation.activation !== "none", "ACTIVATION_REQUIRED", "Explicit Vinea activation is required");
  requireThat(!["orient", "doctor"].includes(meta.invocation.entry), "ENTRY_SCOPE_DENIED", "This entry is read-only");
  if (meta.invocation.activation === "bound-followup") requireThat(task, "BINDING_REQUIRED", "A bound task is required");
  if (capability !== "state-write") {
    requireThat(["run", "continue", "debug"].includes(meta.invocation.entry) && !meta.invocation.analysisOnly,
      "ENTRY_SCOPE_DENIED", "This entry does not authorize business changes or delegation");
  }
  if (task && capability === "business-write") {
    const grant = currentContract(task).grant;
    requireThat(grant.businessWrite && grant.allowedPaths.length > 0, "BUSINESS_WRITE_NOT_GRANTED", "No business paths are writable");
  }
  if (task && capability === "delegate") requireThat(currentContract(task).grant.delegate, "DELEGATION_NOT_GRANTED", "Delegation is not authorized");
  if (task && capability !== "state-write") assertExecution(task);
}
export function assertWritablePath(task: Task, path: string): void {
  const grant = currentContract(task).grant;
  requireThat(grant.businessWrite && grant.allowedPaths.some(root => path === root || path.startsWith(`${root}/`)),
    "PATH_NOT_GRANTED", "Path is outside the task grant");
}
