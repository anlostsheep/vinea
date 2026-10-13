import { createHash } from "node:crypto";
import { requireThat } from "./errors.js";
import { assertControlRequest, newTaskControl } from "./control-policy.js";
import { assertRepositoryState, canonicalJson } from "./schema.js";
import { readState, withLock } from "./store.js";
import { readManaged, writeManaged, writeJson } from "./io.js";
import type { ControlRequest, Meta, RepositoryContext } from "./types.js";

const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export async function previewUpgrade(ctx: RepositoryContext) {
  const state = await readState(ctx);
  const bytes = await readManaged(ctx, "tasks/state.json");
  requireThat(canonicalJson(JSON.parse(bytes.toString())) === canonicalJson(state), "UPGRADE_SOURCE_CHANGED", "Refresh the upgrade preview");
  const occupied = Object.values(state.claims).filter(c => c.state !== "released").map(c => ({ workspaceId: c.workspaceId, state: c.state }));
  return { from: state.kernelSchemaVersion, to: 2, expectedRevision: state.revision, expectedFingerprint: digest(bytes),
    occupied, ready: state.kernelSchemaVersion === 1 && occupied.length === 0,
    nextAction: "Explicit store upgrade after all writers and holds are resolved; never switch an active task's pinned CLI" };
}

export async function upgradeStore(ctx: RepositoryContext, meta: Meta, input: {
  expectedRevision: number; expectedFingerprint: string; request: ControlRequest;
}) {
  assertControlRequest(meta, input.request, "upgrade");
  const requestHash = digest(canonicalJson({ command: "store.upgrade", input, actor: meta.actor, invocation: meta.invocation }));
  return withLock(ctx, meta, async () => {
    const state = await readState(ctx), previous = state.operations[meta.operationId];
    if (previous) {
      requireThat(previous.requestHash === requestHash, "OPERATION_ID_REUSED", "Upgrade operation differs");
      return { schemaVersion: state.kernelSchemaVersion, backup: `backups/schema-1-${previous.resourceIds[0]}.json`, replayed: true };
    }
    requireThat(state.kernelSchemaVersion === 1, "STORE_ALREADY_UPGRADED", "Schema 2 is already installed; no downgrade is available");
    const bytes = await readManaged(ctx, "tasks/state.json");
    requireThat(state.revision === input.expectedRevision && digest(bytes) === input.expectedFingerprint,
      "UPGRADE_SOURCE_CHANGED", "State changed since the preview; inspect it again");
    requireThat(Object.values(state.claims).every(c => c.state === "released"), "WORKSPACE_OCCUPIED", "Resolve all writers, restorations and holds before upgrading");
    const backup = `backups/schema-1-${input.expectedFingerprint}.json`;
    await writeManaged(ctx, meta, backup, bytes, true);
    state.kernelSchemaVersion = 2;
    for (const task of Object.values(state.tasks)) if (task.status === "active") task.control = newTaskControl();
    state.revision++;
    state.operations[meta.operationId] = { operationId: meta.operationId, requestHash, revision: state.revision, resourceIds: [input.expectedFingerprint] };
    assertRepositoryState(state);
    await writeJson(ctx, meta, "tasks/state.json", state);
    return { schemaVersion: 2, backup, replayed: false };
  });
}
