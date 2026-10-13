import { test, expect, vi } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeGoalFixture, testMeta, git, authorizeFixtureTask } from "../helpers/kernel-fixture.js";
import { controlInput } from "../helpers/task-control.js";
import { discoverRepository } from "../../src/kernel/repository.js";
import { claimWork, assertWriteToken } from "../../src/kernel/ownership.js";
import { takeOverTask, cancelTask, reopenTask } from "../../src/kernel/task-control.js";
import { resumeWork, type ResumeInput } from "../../src/kernel/resumption.js";
import { captureSnapshot } from "../../src/kernel/snapshots.js";
import { readState } from "../../src/kernel/store.js";
const fault = vi.hoisted(() => ({ enabled: false }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: async (from: string, to: string) => {
    if (fault.enabled && from.endsWith(".vinea-restore") && to.endsWith("new.ts")) {
      fault.enabled = false; throw new Error("injected write failure");
    }
    return actual.rename(from, to);
  } };
});

async function fixture(snapshot: boolean) {
  const f = await makeGoalFixture(), target = await discoverRepository(f.linkedRoot), b = testMeta(f.actorB, "continue");
  const token = await claimWork(f.context, f.meta, { taskId: f.task.id, assignmentId: null, contractVersion: 1 });
  await writeFile(join(f.root, "src/app.ts"), "export const value = 2;\n");
  if (snapshot) await writeFile(join(f.root, "src/new.ts"), "new file\n");
  const saved = snapshot ? await captureSnapshot(f.context, f.meta, { taskId: f.task.id, paths: ["src"], token }) : null;
  await takeOverTask(target, b, await controlInput(target, f.task.id, "takeover"));
  const ticket = (await readState(target)).tasks[f.task.id]!.control!.recoveries.at(-1)!;
  const input: ResumeInput = { taskId: f.task.id, recoveryId: ticket.id, contractVersion: 1,
    request: { action: "resume", userMessage: "Resume on the explicitly selected baseline", reference: "fixture:resume" },
    mode: saved ? "snapshot" : "baseline", stopBasis: "unknown", stopReference: null, snapshotId: saved?.id ?? null,
    baseCommit: saved ? null : (await git(f.linkedRoot, "rev-parse", "HEAD")).trim(), abandonUncaptured: !saved };
  return { ...f, get meta() { return testMeta(f.actorA); }, target, b: testMeta(f.actorB, "continue"), input, token };
}

test("unknown writer with no snapshot can restart same task on an explicitly selected isolated baseline", async () => {
  const f = await fixture(false);
  const next = await resumeWork(f.target, f.b, f.input);
  expect(next.taskId).toBe(f.task.id);
  expect(await readFile(join(f.linkedRoot, "src/app.ts"), "utf8")).toBe("export const value = 1;\n");
  expect(await readFile(join(f.root, "src/app.ts"), "utf8")).toBe("export const value = 2;\n");
  expect((await readState(f.context)).claims[f.context.workspaceId]!.state).toBe("unknown-writer-hold");
  await assertWriteToken(f.target, await readState(f.target), f.b, next);
  expect(await resumeWork(f.target, f.b, f.input)).toEqual(next);
});

test.each(["no-decision", "dirty", "wrong-base", "same-directory"])("baseline continuation refuses %s", async mode => {
  const f = await fixture(false);
  if (mode === "no-decision") f.input.abandonUncaptured = false;
  if (mode === "dirty") await writeFile(join(f.linkedRoot, "src/local.ts"), "preserve me");
  if (mode === "wrong-base") f.input.baseCommit = "0".repeat(40);
  const before = await readState(f.target);
  await expect(resumeWork(mode === "same-directory" ? f.context : f.target, f.b, f.input)).rejects.toThrow();
  expect(await readState(f.target)).toEqual(before);
  if (mode === "dirty") expect(await readFile(join(f.linkedRoot, "src/local.ts"), "utf8")).toBe("preserve me");
});

test("confirmed stopped writer can resume existing files in the same directory", async () => {
  const f = await fixture(false);
  const input: ResumeInput = { ...f.input, mode: "existing", stopBasis: "user-declared-stop", stopReference: "fixture:user-stopped-A",
    baseCommit: null, abandonUncaptured: false };
  const token = await resumeWork(f.context, f.b, input);
  expect(await readFile(join(f.root, "src/app.ts"), "utf8")).toBe("export const value = 2;\n");
  await assertWriteToken(f.context, await readState(f.context), f.b, token);
});

test("existing files cannot resume with an unknown stop or missing stop reference", async () => {
  const f = await fixture(false);
  const input: ResumeInput = { ...f.input, mode: "existing", baseCommit: null, abandonUncaptured: false };
  await expect(resumeWork(f.context, f.b, input)).rejects.toMatchObject({ code: "STOP_EVIDENCE_REQUIRED" });
  await expect(resumeWork(f.context, testMeta(f.actorB), { ...input, stopBasis: "host-stop-receipt" })).rejects.toMatchObject({ code: "STOP_EVIDENCE_REQUIRED" });
});

test("isolated snapshot resume restores captured contents and fences old token", async () => {
  const f = await fixture(true);
  const token = await resumeWork(f.target, f.b, f.input);
  expect(await readFile(join(f.linkedRoot, "src/app.ts"), "utf8")).toBe("export const value = 2;\n");
  await assertWriteToken(f.target, await readState(f.target), f.b, token);
  await expect(assertWriteToken(f.context, await readState(f.context), f.meta, f.token)).rejects.toThrow();
});

test("partial restore remains retryable, but cancellation and reopen abort the original reservation", async () => {
  const f = await fixture(true);
  fault.enabled = true;
  try { await expect(resumeWork(f.target, f.b, f.input)).rejects.toThrow("injected write failure"); }
  finally { fault.enabled = false; }
  expect(await readFile(join(f.linkedRoot, "src/app.ts"), "utf8")).toBe("export const value = 2;\n");
  expect((await readState(f.target)).claims[f.target.workspaceId]!.state).toBe("restore-target");
  await cancelTask(f.context, f.meta, await controlInput(f.context, f.task.id, "cancel"));
  await reopenTask(f.context, f.meta, await controlInput(f.context, f.task.id, "reopen"));
  const task = (await readState(f.context)).tasks[f.task.id]!;
  await authorizeFixtureTask(f.context, f.actorA, task.id, 2, task.owner.epoch);
  await expect(resumeWork(f.target, f.b, f.input)).rejects.toMatchObject({ code: "RECOVERY_ABORTED" });
  expect((await readState(f.target)).claims[f.target.workspaceId]!.state).toBe("unknown-writer-hold");
});

test("same operation can retry a failed restore without repeating takeover", async () => {
  const f = await fixture(true);
  fault.enabled = true;
  try { await expect(resumeWork(f.target, f.b, f.input)).rejects.toThrow("injected write failure"); }
  finally { fault.enabled = false; }
  const token = await resumeWork(f.target, f.b, f.input);
  await assertWriteToken(f.target, await readState(f.target), f.b, token);
});
