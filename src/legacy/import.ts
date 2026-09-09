import { inspectLegacy } from "./read.js";
import { mutateState, readState } from "../kernel/store.js";
import { assertPersistence } from "../kernel/io.js";
import { assertEntry } from "../kernel/policy.js";
import { decisionRule } from "../kernel/schema.js";
import { makeTask } from "../kernel/contracts.js";
import { requireThat } from "../kernel/errors.js";
import type { RepositoryContext, Meta, Decision, Id } from "../kernel/types.js";

export async function importLegacy(ctx: RepositoryContext, meta: Meta, input: { sourceRoot: string; expectedFingerprint: string; decision: Decision }): Promise<Id[]> {
  assertPersistence(meta); decisionRule(input.decision); assertEntry(meta, null, "state-write");
  const source = await inspectLegacy(input.sourceRoot);
  requireThat(source.issues.length === 0, "LEGACY_INVALID", "Legacy source has unresolved diagnostics");
  requireThat(source.fingerprint === input.expectedFingerprint, "LEGACY_SOURCE_CHANGED", "Preview and explicitly approve the current source");
  const receipt = await mutateState(ctx, meta, { command: "legacy.import", input }, state => source.records.map(record => {
    const existing = Object.values(state.tasks).find(t => t.legacySource?.path === record.path && t.legacySource.fingerprint === source.fingerprint);
    if (existing) return existing.id;
    const task = makeTask(record.title, { goal: record.goal, scope: [], constraints: record.constraints,
      acceptance: [{ id: "review-import", text: "Review imported requirements before authorizing execution" }], quality: record.quality,
      grant: { businessWrite: false, delegate: false, commit: false, deploy: false, allowedPaths: [] } }, input.decision, meta);
    task.legacySource = { path: record.path, fingerprint: source.fingerprint, originalStatus: record.originalStatus };
    task.diagnostics.push({ id: `legacy-${task.id}`, kind: "fact", text: `Imported historical task ${record.originalId}; ${record.historicalEvidence.length} historical evidence records remain at the source and are not current verification`,
      evidenceIds: [], actor: meta.actor, createdAt: new Date().toISOString() });
    state.tasks[task.id] = task; return task.id;
  }));
  return receipt.resourceIds;
}
