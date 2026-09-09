import { randomUUID } from "node:crypto";
import { mutateState, readState } from "./store.js";
import { assertEntry, getTask, currentContract } from "./policy.js";
import { decisionRule, text, one, array, id } from "./schema.js";
import { makeTask } from "./contracts.js";
import { requireThat } from "./errors.js";
import type { RepositoryContext, Meta, Id, Diagnostic, Task, Decision } from "./types.js";

export async function recordDiagnostic(ctx: RepositoryContext, meta: Meta, input: { taskId: Id; kind: Diagnostic["kind"]; text: string; evidenceIds: Id[] }): Promise<Diagnostic> {
  text(input.text); array(id)(input.evidenceIds); one("fact", "hypothesis", "ruled-out", "change", "validation-gap")(input.kind);
  const receipt = await mutateState(ctx, meta, { command: "debug.record", input }, state => {
    const task = getTask(state, input.taskId); assertEntry(meta, task, "state-write");
    requireThat(input.evidenceIds.every(e => !!task.evidence[e]), "EVIDENCE_NOT_FOUND", "Diagnostic evidence is absent");
    const record: Diagnostic = { id: randomUUID(), kind: input.kind, text: input.text, evidenceIds: input.evidenceIds, actor: meta.actor, createdAt: new Date().toISOString() };
    task.diagnostics.push(record); return [record.id];
  });
  return (await readState(ctx)).tasks[input.taskId]!.diagnostics.find(d => d.id === receipt.resourceIds[0])!;
}
export async function openRepair(ctx: RepositoryContext, meta: Meta, input: { taskId: Id; deliveryId: Id | null; title: string; expected: string; actual: string; decision: Decision }): Promise<Task> {
  decisionRule(input.decision); text(input.title); text(input.expected); text(input.actual);
  requireThat(["run", "continue", "debug"].includes(meta.invocation.entry), "ENTRY_SCOPE_DENIED", "This entry cannot open repair work");
  const receipt = await mutateState(ctx, meta, { command: "debug.open", input }, state => {
    const source = getTask(state, input.taskId, false); assertEntry(meta, source, "state-write");
    let task = source;
    if (source.status !== "active" || input.deliveryId) {
      const candidates = Object.keys(source.deliveries);
      const deliveryId = input.deliveryId ?? (candidates.length === 1 ? candidates[0]! : null);
      requireThat(deliveryId && source.deliveries[deliveryId], "DELIVERY_SELECTION_REQUIRED", "Select a real delivery to repair");
      const original = currentContract(source);
      task = makeTask(input.title, { ...structuredClone(original), goal: input.title,
        acceptance: [{ id: "repair", text: input.expected }],
        grant: meta.invocation.analysisOnly ? { businessWrite: false, delegate: false, commit: false, deploy: false, allowedPaths: [] }
          : { ...original.grant, delegate: false, commit: false, deploy: false } }, input.decision, meta);
      task.relatedTo = { taskId: source.id, deliveryId };
      state.tasks[task.id] = task;
    }
    task.diagnostics.push({ id: randomUUID(), kind: "fact", text: `Expected: ${input.expected}\nReported actual: ${input.actual}`,
      evidenceIds: [], actor: meta.actor, createdAt: new Date().toISOString() });
    return [task.id];
  });
  return (await readState(ctx)).tasks[receipt.resourceIds[0]!]!;
}
