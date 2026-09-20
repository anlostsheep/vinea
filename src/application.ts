import { resolveActor, bindSession, readBindings } from "./kernel/sessions.js";
import { readState, inspectStore } from "./kernel/store.js";
import { getTask, currentContract } from "./kernel/policy.js";
import { inspectLegacy } from "./legacy/read.js";
import { object, id, text, bool, invocationRule, metaRule, record } from "./kernel/schema.js";
import { commands } from "./cli/commands.js";
import { requireThat, KernelError } from "./kernel/errors.js";
import { loadSnapshot } from "./kernel/snapshots.js";
import type { RepositoryContext, Meta, ActorSelector, Actor, Task, Snapshot } from "./kernel/types.js";

export interface CommandEnvelope { meta: Omit<Meta, "actor"> & { actor: ActorSelector }; payload: unknown }
export interface CommandResponse {
  operationId: string | null; actor: Actor | null; workspaceId: string | null; data: unknown;
  error?: { code: string; message: string; details: Record<string, unknown> };
}
const selectorRule = object({ host: text }, { instanceId: id, hostSessionId: text, newInstance: bool });
const envelopeRule = object({ meta: object({ operationId: id, actor: selectorRule, invocation: invocationRule }), payload: () => {} });
export function taskSummary(task: Task) {
  return { id: task.id, title: task.title, status: task.status, contract: currentContract(task), owner: task.owner,
    assignments: Object.values(task.assignments), contributionIds: Object.keys(task.contributions),
    evidenceIds: Object.values(task.evidence).sort((a, b) => a.sequence - b.sequence).slice(-20).map(e => e.id),
    checkSetIds: Object.keys(task.checks), deliveryIds: Object.keys(task.deliveries), userAcceptances: task.userAcceptances,
    relatedTo: task.relatedTo, legacySource: task.legacySource, workflow: task.workflow ?? null, diagnostics: task.diagnostics.slice(-20) };
}
export async function executeCommand(ctx: RepositoryContext, command: string, envelope: CommandEnvelope): Promise<CommandResponse> {
  envelopeRule(envelope);
  requireThat(command === "session resolve" || !envelope.meta.actor.newInstance, "ACTOR_RESOLUTION_REQUIRED", "Resolve a new instance once, then reuse the returned Actor");
  const actor = await resolveActor(ctx, envelope.meta.actor), meta: Meta = { ...envelope.meta, actor };
  metaRule(meta);
  const reply = (data: unknown): CommandResponse => ({ actor, workspaceId: ctx.workspaceId, operationId: meta.operationId, data });
  try {
    if (command === "session resolve") { object({})(envelope.payload); return reply(actor); }
    requireThat(Object.hasOwn(commands, command), "COMMAND_UNKNOWN", "Unknown command; use --help");
    const entry = commands[command]!;
    entry.check(envelope.payload);
    if (meta.invocation.activation === "bound-followup") {
      const payload = record(envelope.payload);
      const taskId = payload.taskId ?? (payload.from ? record(payload.from).taskId : undefined);
      const bound = (await readBindings(ctx)).some(b => b.actor.instanceId === actor.instanceId && b.workspaceId === ctx.workspaceId && b.taskId === taskId);
      requireThat(bound, "BINDING_REQUIRED", "Follow-up has no matching task binding");
    }
    let data = await entry.handler(ctx, meta, envelope.payload as never);
    if (command === "task create" || command === "debug open") {
      const task = data as Task;
      await bindSession(ctx, meta, { taskId: task.id, assignmentId: null }); data = taskSummary(task);
    }
    if (command === "snapshot capture") {
      const s = data as Snapshot;
      data = { id: s.id, fingerprint: s.fingerprint, baseCommit: s.baseCommit, scope: s.scope,
        entries: s.entries.length, manifest: `snapshots/${s.id}.json` };
    }
    return reply(data ?? null);
  } catch (error) {
    const known = error instanceof KernelError;
    const causeCode = (error as NodeJS.ErrnoException)?.code;
    if (!known && command === "init" && (causeCode === "EPERM" || causeCode === "EACCES")) {
      return { ...reply(null), error: { code: "STORAGE_PERMISSION_DENIED",
        message: "The host denied Vinea storage access. Request access to the exact store directory; do not create alternate task state or bypass host permissions.",
        details: { storeRoot: ctx.storeRoot, causeCode } } };
    }
    return { ...reply(null), error: { code: known ? error.code : "COMMAND_FAILED",
      message: known ? error.message : "Command failed; inspect current state before retrying", details: known ? error.details : {} } };
  }
}
export async function executeReadCommand(ctx: RepositoryContext, command: string, input: { taskId?: string; sourceRoot?: string; resourceId?: string; limit?: number; after?: string }): Promise<CommandResponse> {
  let data: unknown;
  if (["doctor", "validate"].includes(command)) data = await inspectStore(ctx);
  else if (command === "snapshot show") {
    requireThat(input.resourceId, "ID_REQUIRED", "Specify --id"); data = await loadSnapshot(ctx, input.resourceId);
  } else if (command === "legacy inspect") {
    requireThat(input.sourceRoot, "SOURCE_REQUIRED", "Specify the exact legacy source root"); data = await inspectLegacy(input.sourceRoot);
  } else {
    const state = await readState(ctx);
    if (command === "task show") { requireThat(input.taskId, "TASK_REQUIRED", "Specify --task"); data = taskSummary(getTask(state, input.taskId, false)); }
    else if (["evidence show", "check show", "contribution show", "delivery show"].includes(command)) {
      requireThat(input.taskId && input.resourceId, "ID_REQUIRED", "Specify --task and --id"); id(input.resourceId);
      const task = getTask(state, input.taskId, false);
      const resources = command === "evidence show" ? task.evidence : command === "check show" ? task.checks
        : command === "contribution show" ? task.contributions : task.deliveries;
      data = resources[input.resourceId]; requireThat(data, "RESOURCE_NOT_FOUND", "Resource is absent in the selected task");
    }
    else {
      const limit = input.limit ?? 20;
      requireThat(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, "LIMIT_INVALID", "Page size must be between 1 and 100");
      if (input.after) id(input.after);
      const tasks = Object.values(state.tasks).filter(t => !input.after || t.id > input.after).sort((a, b) => a.id < b.id ? -1 : 1);
      const page = tasks.slice(0, limit);
      data = { revision: state.revision, tasks: page.map(t => ({ id: t.id, title: t.title, status: t.status,
        protocol: t.workflow?.protocol ?? null,
        goal: currentContract(t).goal, contractVersion: currentContract(t).version, owner: t.owner, relatedTo: t.relatedTo })),
        nextAfter: tasks.length > limit ? page.at(-1)!.id : null };
    }
  }
  return { actor: null, workspaceId: ctx.workspaceId, operationId: null, data };
}
