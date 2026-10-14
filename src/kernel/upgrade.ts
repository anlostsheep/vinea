import { createHash } from "node:crypto";
import { KernelError, requireThat } from "./errors.js";
import { assertControlRequest, matchesOccupancy, newTaskControl } from "./control-policy.js";
import { assertRepositoryState, canonicalJson, object, integer, text, array, one, occupancyRule, controlRequestRule } from "./schema.js";
import { readState, withLock } from "./store.js";
import { readManaged, writeManaged, writeJson } from "./io.js";
import { executionKey } from "./ownership.js";
import type { Claim, ControlRequest, Meta, OccupancyRef, RepositoryContext, RepositoryState } from "./types.js";

export interface StoppedLegacyWriter {
  from: OccupancyRef;
  stopBasis: "user-declared-stop" | "host-stop-receipt";
  stopReference: string;
  userMessage: string;
}
export interface UpgradeInput {
  expectedRevision: number; expectedFingerprint: string; request: ControlRequest;
  stoppedLegacyWriters?: StoppedLegacyWriter[];
}
export const upgradeInputRule = object({ expectedRevision: integer, expectedFingerprint: text, request: controlRequestRule }, {
  stoppedLegacyWriters: array(object({ from: occupancyRule, stopBasis: one("user-declared-stop", "host-stop-receipt"), stopReference: text, userMessage: text }))
});

const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function eligibleLegacyWriter(state: RepositoryState, claim: Claim): boolean {
  return claim.state === "writer" && claim.recovery === null && !state.tasks[claim.taskId]!.workflow;
}
function occupiedSummary(state: RepositoryState) {
  return Object.values(state.claims).filter(c => c.state !== "released").map(c => {
    const { taskId, assignmentId, workspaceId, instanceId, epoch } = c;
    return { workspaceId, state: c.state, ref: { taskId, assignmentId, workspaceId, instanceId, epoch },
      taskProtocol: state.tasks[taskId]!.workflow?.protocol ?? null,
      canResolveStoppedLegacyWriter: state.kernelSchemaVersion === 1 && eligibleLegacyWriter(state, c) };
  });
}
function legacyTaskIds(state: RepositoryState) {
  return Object.values(state.tasks).filter(t => t.status === "active" && !t.workflow).map(t => t.id);
}
function afterUpgrade(state: RepositoryState) {
  const retainedLegacyTaskIds = legacyTaskIds(state);
  return { retainedLegacyTaskIds, nextAction: retainedLegacyTaskIds.length
    ? "Store upgrade is complete; legacy active tasks remain non-executable and doctor may report TASK_PROTOCOL_REQUIRED. New tasks can run. Keep legacy tasks read-only or explicitly task cancel them; no execution protocol was fabricated"
    : "Store upgrade is complete; use the current schema-2 CLI and retain the backup" };
}
export async function previewUpgrade(ctx: RepositoryContext) {
  const state = await readState(ctx);
  const bytes = await readManaged(ctx, "tasks/state.json");
  requireThat(canonicalJson(JSON.parse(bytes.toString())) === canonicalJson(state), "UPGRADE_SOURCE_CHANGED", "Refresh the upgrade preview");
  const occupied = occupiedSummary(state);
  return { from: state.kernelSchemaVersion, to: 2, expectedRevision: state.revision, expectedFingerprint: digest(bytes),
    occupied, ready: state.kernelSchemaVersion === 1 && occupied.length === 0,
    retainedLegacyTaskIds: legacyTaskIds(state),
    nextAction: state.kernelSchemaVersion === 2 ? "Store already uses schema 2; no upgrade is needed"
      : occupied.some(c => c.canResolveStoppedLegacyWriter)
        ? "For each explicitly confirmed stopped legacy writer, copy occupied[].ref into stoppedLegacyWriters with its stop basis, user words and stop reference. All other occupancies must be resolved first. Eligibility is not proof of stopping"
        : "Explicit store upgrade after all writers and holds are resolved; never switch an active task's pinned CLI" };
}

export async function upgradeStore(ctx: RepositoryContext, meta: Meta, input: UpgradeInput) {
  upgradeInputRule(input);
  assertControlRequest(meta, input.request, "upgrade");
  const requestHash = digest(canonicalJson({ command: "store.upgrade", input, actor: meta.actor, invocation: meta.invocation }));
  const receiptPath = `artifacts/${meta.operationId}/upgrade.json`;
  return withLock(ctx, meta, async () => {
    const state = await readState(ctx), previous = state.operations[meta.operationId];
    if (previous) {
      requireThat(previous.requestHash === requestHash, "OPERATION_ID_REUSED", "Upgrade operation differs");
      requireThat(state.kernelSchemaVersion === 2, "UPGRADE_RECEIPT_INVALID", "An admitted upgrade must describe a schema-2 store");
      // Version 3.0.0 receipts have only the source fingerprint, without an audit artifact.
      if (previous.resourceIds[1]) {
        try {
          const audit = JSON.parse((await readManaged(ctx, receiptPath)).toString("utf8"));
          requireThat(digest(canonicalJson(audit)) === previous.resourceIds[1], "UPGRADE_RECEIPT_INVALID", "Upgrade audit content changed");
        } catch (error) {
          if (error instanceof KernelError && error.code === "UNSAFE_PATH") throw error;
          throw new KernelError("UPGRADE_RECEIPT_INVALID", "Upgrade committed but its audit receipt is missing or changed; inspect state without reapplying it");
        }
      }
      return { schemaVersion: state.kernelSchemaVersion, backup: `backups/schema-1-${previous.resourceIds[0]}.json`,
        receipt: previous.resourceIds[1] ? receiptPath : null, replayed: true, ...afterUpgrade(state) };
    }
    requireThat(state.kernelSchemaVersion === 1, "STORE_ALREADY_UPGRADED", "Schema 2 is already installed; no downgrade is available");
    const bytes = await readManaged(ctx, "tasks/state.json");
    requireThat(state.revision === input.expectedRevision && digest(bytes) === input.expectedFingerprint,
      "UPGRADE_SOURCE_CHANGED", "State changed since the preview; inspect it again");
    const stops = input.stoppedLegacyWriters ?? [];
    const selected = new Set<string>();
    for (const stop of stops) {
      requireThat(!selected.has(stop.from.workspaceId), "DUPLICATE_OCCUPANCY", "Each stopped legacy writer must be selected exactly once");
      selected.add(stop.from.workspaceId);
      const claim = state.claims[stop.from.workspaceId];
      requireThat(matchesOccupancy(claim, stop.from), "OCCUPANCY_CHANGED", "Selected legacy occupancy changed; refresh its exact public reference");
      requireThat(eligibleLegacyWriter(state, claim!), "LEGACY_WRITER_REQUIRED", "This exception only handles stopped writers on tasks without an execution protocol; normal writers, holds and restorations remain protected");
    }
    const remaining = occupiedSummary(state).filter(c => !selected.has(c.workspaceId));
    if (remaining.length) throw new KernelError("WORKSPACE_OCCUPIED",
      "Unselected writers, restorations or holds remain; no selected occupancy was released", { occupied: remaining });
    const backup = `backups/schema-1-${input.expectedFingerprint}.json`;
    await writeManaged(ctx, meta, backup, bytes, true);
    const resolved = stops.map(stop => {
      const claim = state.claims[stop.from.workspaceId]!, key = executionKey(claim.taskId, claim.assignmentId);
      const fencedEpoch = (state.epochs[key] ?? claim.epoch) + 1;
      state.epochs[key] = fencedEpoch;
      state.claims[claim.workspaceId] = { ...claim, state: "released", recovery: null };
      return { ...structuredClone(stop), previousState: "writer", state: "released", fencedEpoch };
    });
    state.kernelSchemaVersion = 2;
    for (const task of Object.values(state.tasks)) if (task.status === "active") task.control = newTaskControl();
    state.revision++;
    // Deterministic bytes make a failed-publication retry safe. This prepared audit
    // is committed only when state.operations admits its content hash atomically.
    const audit = { operationId: meta.operationId, requestHash, actor: meta.actor, request: input.request,
      fromSchema: 1, toSchema: 2, sourceRevision: input.expectedRevision, sourceFingerprint: input.expectedFingerprint,
      resultRevision: state.revision, backup, resolvedLegacyWriters: resolved };
    await writeJson(ctx, meta, receiptPath, audit, true);
    state.operations[meta.operationId] = { operationId: meta.operationId, requestHash, revision: state.revision,
      resourceIds: [input.expectedFingerprint, digest(canonicalJson(audit))] };
    assertRepositoryState(state);
    await writeJson(ctx, meta, "tasks/state.json", state);
    return { schemaVersion: 2, backup, receipt: receiptPath, replayed: false, ...afterUpgrade(state) };
  });
}
