import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "vitest";
import { continueGoal, takeoverWork, clearWorkspaceHold } from "../../src/kernel/continuation.js";
import { claimWork, assertWriteToken } from "../../src/kernel/ownership.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { readState } from "../../src/kernel/store.js";
import { discoverRepository } from "../../src/kernel/repository.js";
import { makeGoalFixture, testMeta } from "../helpers/kernel-fixture.js";

test("unknown takeover retains old workspace hold and only the new epoch may submit", async () => {
  const f = await makeGoalFixture();
  const old = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  await writeFile(join(f.root, "src/app.ts"), "export const value = 2;\n");
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token: old });
  const target = await discoverRepository(f.linkedRoot), b = testMeta(f.actorB);
  const view = await continueGoal(target, b, { taskId: f.task.id, assignmentId: null });
  expect(view.writeToken).toBeNull();
  const from = view.occupiedWrites[0]!.ref;
  const next = await takeoverWork(target, b, { from, to: f.actorB, contractVersion: 1, transferOwner: true, ownerEpoch: 1,
    decision: { summary: "take over in isolated workspace", reference: null }, stopBasis: "unknown", stopReference: null, baselineSnapshotId: snapshot.id });
  expect(await readFile(join(f.linkedRoot, "src/app.ts"), "utf8")).toBe("export const value = 2;\n");
  const state = await readState(target);
  expect(state.claims[f.context.workspaceId]?.state).toBe("unknown-writer-hold");
  expect(next.epoch).toBe(old.epoch + 1);
  await expect(assertWriteToken(f.context, state, f.meta, old)).rejects.toThrow();
  await expect(claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 })).rejects.toMatchObject({ code: "WORKSPACE_OCCUPIED" });
  await clearWorkspaceHold(target, f.meta, { from, stopBasis: "holder-release", stopReference: null, decision: null });
  expect((await readState(target)).claims[f.context.workspaceId]?.state).toBe("released");
  expect((await readState(target)).claims[target.workspaceId]?.epoch).toBe(next.epoch);
});
