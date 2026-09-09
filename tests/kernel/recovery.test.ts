import { test, expect, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeGoalFixture, testMeta } from "../helpers/kernel-fixture.js";
import { claimWork } from "../../src/kernel/ownership.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { takeoverWork, continueGoal } from "../../src/kernel/continuation.js";
import { discoverRepository } from "../../src/kernel/repository.js";
import { readState } from "../../src/kernel/store.js";

const fault = vi.hoisted(() => ({ enabled: false }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: async (from: string, to: string) => {
    if (fault.enabled && from.endsWith(".vinea-restore") && to.endsWith("new.ts")) {
      fault.enabled = false; throw new Error("injected restore publication failure");
    }
    return actual.rename(from, to);
  } };
});

test("interrupted content restore remains fenced and resumes the same reservation", async () => {
  const f = await makeGoalFixture(), other = await discoverRepository(f.linkedRoot), b = testMeta(f.actorB);
  const token = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  await writeFile(join(f.root, "src/app.ts"), "updated\n");
  await writeFile(join(f.root, "src/new.ts"), "new\n");
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token });
  const view = await continueGoal(other, b, { taskId: f.task.id, assignmentId: null });
  const input = { from: view.occupiedWrites[0]!.ref, to: f.actorB, contractVersion: 1, transferOwner: true, ownerEpoch: 1,
    decision: { summary: "recover", reference: null }, stopBasis: "unknown" as const, stopReference: null, baselineSnapshotId: snapshot.id };
  fault.enabled = true;
  await expect(takeoverWork(other, b, input)).rejects.toThrow("injected restore");
  const failed = await readState(other);
  expect(failed.claims[other.workspaceId]!.state).toBe("restore-target");
  expect(failed.claims[f.context.workspaceId]!.state).toBe("unknown-writer-hold");
  expect(await readFile(join(f.linkedRoot, "src/app.ts"), "utf8")).toBe("updated\n");
  await expect(claimWork(other, testMeta(f.actorB), { taskId: f.task.id, assignmentId: null, contractVersion: 1 })).rejects.toMatchObject({ code: "WORKSPACE_OCCUPIED" });
  const next = await takeoverWork(other, b, input);
  expect(next.epoch).toBe(token.epoch + 1);
  expect(await readFile(join(f.linkedRoot, "src/new.ts"), "utf8")).toBe("new\n");
  expect((await readState(other)).claims[other.workspaceId]!.state).toBe("writer");
});

test("dirty recovery target is preserved without changing ownership", async () => {
  const f = await makeGoalFixture(), other = await discoverRepository(f.linkedRoot), b = testMeta(f.actorB);
  const token = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  const snapshot = await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token });
  const view = await continueGoal(other, b, { taskId: f.task.id, assignmentId: null });
  await writeFile(join(f.linkedRoot, "unrelated.txt"), "preserve\n");
  await expect(takeoverWork(other, b, { from: view.occupiedWrites[0]!.ref, to: f.actorB, contractVersion: 1,
    transferOwner: true, ownerEpoch: 1, decision: { summary: "recover", reference: null }, stopBasis: "unknown", stopReference: null, baselineSnapshotId: snapshot.id })).rejects.toMatchObject({ code: "RECOVERY_CONFLICT" });
  expect((await readState(other)).claims[f.context.workspaceId]!.state).toBe("writer");
  expect(await readFile(join(f.linkedRoot, "unrelated.txt"), "utf8")).toBe("preserve\n");
});
