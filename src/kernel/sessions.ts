import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { KernelError, requireThat } from "./errors.js";
import { actorRule, object, id, nullable } from "./schema.js";
import { getTask, assertEntry } from "./policy.js";
import { newActor } from "./repository.js";
import { readState } from "./store.js";
import { readManaged, storagePath, writeJson } from "./io.js";
import type { RepositoryContext, Meta, Actor, ActorSelector, Binding, Id } from "./types.js";

const bindingRule = object({ actor: actorRule, workspaceId: id, taskId: id, assignmentId: nullable(id) });
export async function readBindings(ctx: RepositoryContext): Promise<Binding[]> {
  let names: string[];
  try { names = await readdir(await storagePath(ctx, "runtime/bindings")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const out: Binding[] = [];
  for (const name of names.sort()) {
    requireThat(/^[a-f0-9]{64}\.json$/.test(name), "BINDING_INVALID", "Unexpected binding artifact");
    const value: unknown = JSON.parse((await readManaged(ctx, `runtime/bindings/${name}`)).toString("utf8"));
    bindingRule(value); out.push(value as Binding);
  }
  return out;
}
export async function resolveActor(ctx: RepositoryContext, selector: ActorSelector): Promise<Actor> {
  requireThat(typeof selector.host === "string" && !!selector.host.trim(), "ACTOR_RESOLUTION_REQUIRED", "Host is required");
  requireThat(!(selector.newInstance && selector.instanceId), "ACTOR_IDENTITY_MISMATCH", "New and existing identities cannot be combined");
  const all = await readBindings(ctx);
  const matches = all.filter(b => b.actor.host === selector.host && !!selector.hostSessionId && b.actor.hostSessionId === selector.hostSessionId);
  const ids = new Set(matches.map(b => b.actor.instanceId));
  requireThat(ids.size <= 1, "ACTOR_IDENTITY_MISMATCH", "Host session has ambiguous instances");
  if (selector.instanceId) {
    id(selector.instanceId);
    const previous = all.find(b => b.actor.instanceId === selector.instanceId)?.actor;
    requireThat(!previous || (previous.host === selector.host && (!selector.hostSessionId || !previous.hostSessionId || previous.hostSessionId === selector.hostSessionId)),
      "ACTOR_IDENTITY_MISMATCH", "Instance host/session differs");
    requireThat(matches.every(b => b.actor.instanceId === selector.instanceId), "ACTOR_IDENTITY_MISMATCH", "Host session belongs to another instance");
    const actor = { ...(previous ?? {}), instanceId: selector.instanceId, host: selector.host,
      ...(selector.hostSessionId ? { hostSessionId: selector.hostSessionId } : {}) };
    actorRule(actor); return actor;
  }
  if (matches.length) return matches[0]!.actor;
  if (selector.newInstance) return newActor(selector.host, selector.hostSessionId);
  throw new KernelError("ACTOR_RESOLUTION_REQUIRED", "Reuse the echoed instance ID, resolve a real host session, or explicitly open a new instance");
}
export async function bindSession(ctx: RepositoryContext, meta: Meta, input: { taskId: Id; assignmentId: Id | null }): Promise<Binding> {
  const task = getTask(await readState(ctx), input.taskId, false);
  requireThat(input.assignmentId === null || task.assignments[input.assignmentId], "ASSIGNMENT_NOT_FOUND", "Assignment does not exist");
  const binding: Binding = { actor: meta.actor, workspaceId: ctx.workspaceId, ...input };
  bindingRule(binding);
  if (meta.invocation.persist) {
    assertEntry(meta, task, "state-write");
    const hash = createHash("sha256").update(JSON.stringify([meta.actor.instanceId, ctx.workspaceId])).digest("hex");
    await writeJson(ctx, meta, `runtime/bindings/${hash}.json`, binding);
  }
  return binding;
}
