import { readState } from "../../src/kernel/store.js";
import type { ControlInput } from "../../src/kernel/task-control.js";
import type { ControlAction, RepositoryContext } from "../../src/kernel/types.js";

export async function controlInput(ctx: RepositoryContext, taskId: string, action: ControlAction): Promise<ControlInput> {
  const task = (await readState(ctx)).tasks[taskId]!;
  return { taskId, contractVersion: task.contracts.at(-1)!.version, expectedControlRevision: task.control!.revision, ownerEpoch: task.owner.epoch,
    reason: `User requested ${action}`, request: { action, userMessage: `Please ${action} this task`, reference: `fixture:${action}:${task.control!.revision}` } };
}
