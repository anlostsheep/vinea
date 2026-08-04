import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { initializeWorkspace } from "../../src/core/config.js";
import { upsertCheck } from "../../src/core/check.js";
import { recordEvidence } from "../../src/core/evidence.js";
import { resolveVineaPaths } from "../../src/core/paths.js";
import { validateWorkspace } from "../../src/core/validate.js";
import { diagnoseWorkspace } from "../../src/core/doctor.js";
import { appendJsonl } from "../../src/core/json.js";
import {
  addAcceptanceCriterion,
  addRequirement,
  createTask,
  listCheckHistory,
  orientWorkspace,
  reworkTask,
  setTaskBrief,
  setTaskPlan,
  transitionTask,
} from "../../src/core/workflow.js";
import type { ReworkPersistenceOperations } from "../../src/core/workflow.js";
import type { TaskRecord } from "../../src/core/types.js";
import { createTempRepo, readJson } from "../helpers/fixture.js";

test("rework archives one current check snapshot, clears it, and opens exactly one new verification revision", async () => {
  const fixture = await createCheckingFixture();

  const reworked = await reworkTask(fixture.paths, fixture.task.id, {
    actor: "codex",
    reason: "Repair the failed requirement before another verification cycle.",
  }, () => new Date("2026-08-04T01:06:00.000Z"));

  expect(reworked).toMatchObject({ status: "in_progress", verificationRevision: 1 });
  expect(await readFile(join(fixture.directory, "check.md"), "utf8")).toBe("");
  const history = (await readFile(join(fixture.directory, "check-history.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(history).toEqual([expect.objectContaining({
    schemaVersion: 2,
    taskId: fixture.task.id,
    verificationRevision: 0,
    reworkReason: "Repair the failed requirement before another verification cycle.",
    rows: [
      expect.objectContaining({ requirementId: "R1", result: "fail", verificationRevision: 0 }),
      expect.objectContaining({ requirementId: "A1", result: "pass", verificationRevision: 0 }),
    ],
  })]);
  const journal = (await readFile(join(fixture.directory, "journal.md"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  const intent = journal.find((event) => event.type === "rework_intent")!;
  const completion = journal.find((event) => event.type === "reworked")!;
  expect(intent).toMatchObject({
    schemaVersion: 2,
    sourceVerificationRevision: 0,
    reason: "Repair the failed requirement before another verification cycle.",
    snapshot: history[0],
  });
  expect(completion).toMatchObject({
    schemaVersion: 2,
    operationId: intent.operationId,
    sourceVerificationRevision: 0,
    verificationRevision: 1,
    status: "in_progress",
  });
  expect((await readJson<TaskRecord>(join(fixture.directory, "task.json"))).verificationRevision).toBe(1);
  expect((await validateWorkspace(fixture.paths)).issues).toEqual([]);
});

test.each(["intent", "history", "check", "task", "completion"] as const)(
  "rework retries to one logical result after a %s write failure",
  async (boundary) => {
    const fixture = await createCheckingFixture();
    const timestamp = () => new Date("2026-08-04T01:06:00.000Z");
    const input = {
      actor: "codex",
      reason: "Repair the failed requirement before another verification cycle.",
    };

    await expect(reworkTask(
      fixture.paths,
      fixture.task.id,
      input,
      timestamp,
      failingReworkOperations(boundary),
    )).rejects.toThrow(boundary === "intent"
      ? "Injected rework intent failure"
      : "rework intent remains pending for retry");

    const recovered = await reworkTask(fixture.paths, fixture.task.id, input, timestamp);
    expect(recovered).toMatchObject({ status: "in_progress", verificationRevision: 1 });
    expect(await readFile(join(fixture.directory, "check.md"), "utf8")).toBe("");
    const history = (await readFile(join(fixture.directory, "check-history.jsonl"), "utf8"))
      .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(history).toHaveLength(1);
    const journal = (await readFile(join(fixture.directory, "journal.md"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(journal.filter((event) => event.type === "rework_intent")).toHaveLength(1);
    expect(journal.filter((event) => event.type === "reworked")).toHaveLength(1);
    expect((await validateWorkspace(fixture.paths)).issues).toEqual([]);
  },
);

test("ordinary task work automatically recovers a pending rework before writing new evidence", async () => {
  const fixture = await createCheckingFixture();
  const input = {
    actor: "codex",
    reason: "Repair the failed requirement before another verification cycle.",
  };
  await expect(reworkTask(
    fixture.paths,
    fixture.task.id,
    input,
    () => new Date("2026-08-04T01:06:00.000Z"),
    failingReworkOperations("task"),
  )).rejects.toThrow("rework intent remains pending for retry");

  const evidence = await recordEvidence(fixture.paths, fixture.task.id, {
    kind: "command",
    summary: "Fresh evidence after automatic rework recovery.",
    command: "npm test -- fresh",
    exitCode: 0,
    result: "pass",
    actor: "codex",
  }, () => new Date("2026-08-04T01:06:01.000Z"));

  expect(evidence.verificationRevision).toBe(1);
  expect(await readJson<TaskRecord>(join(fixture.directory, "task.json"))).toMatchObject({
    status: "in_progress",
    verificationRevision: 1,
  });
  expect((await validateWorkspace(fixture.paths)).issues).toEqual([]);
});

test("rework fails closed when a pending intent has a mismatched completion event", async () => {
  const fixture = await createCheckingFixture();
  const input = {
    actor: "codex",
    reason: "Repair the failed requirement before another verification cycle.",
  };
  await expect(reworkTask(
    fixture.paths,
    fixture.task.id,
    input,
    () => new Date("2026-08-04T01:06:00.000Z"),
    failingReworkOperations("completion"),
  )).rejects.toThrow("rework intent remains pending for retry");
  const journalPath = join(fixture.directory, "journal.md");
  const intent = (await readFile(journalPath, "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((event) => event.type === "rework_intent")!;
  await appendJsonl(journalPath, {
    schemaVersion: 2,
    type: "reworked",
    operationId: intent.operationId,
    timestamp: intent.timestamp,
    actor: intent.actor,
    reason: "A different rework reason.",
    sourceVerificationRevision: 0,
    verificationRevision: 1,
    status: "in_progress",
  }, fixture.paths.repoRoot);

  await expect(reworkTask(fixture.paths, fixture.task.id, input)).rejects.toThrow("does not match its rework intent");
});

test("check-history readers reject duplicate operation IDs and task revisions", async () => {
  const fixture = await createCheckingFixture();
  await reworkTask(fixture.paths, fixture.task.id, {
    actor: "codex",
    reason: "Repair the failed requirement before another verification cycle.",
  });
  const historyPath = join(fixture.directory, "check-history.jsonl");
  const snapshot = JSON.parse(await readFile(historyPath, "utf8")) as Record<string, unknown>;
  await appendJsonl(historyPath, snapshot, fixture.paths.repoRoot);

  await expect(listCheckHistory(fixture.paths, fixture.task.id)).rejects.toThrow("duplicate");
});

test("two consecutive checking and rework cycles preserve separate immutable snapshots", async () => {
  const fixture = await createCheckingFixture();
  await reworkTask(fixture.paths, fixture.task.id, {
    actor: "codex",
    reason: "Repair revision-zero failure.",
  }, () => new Date("2026-08-04T01:06:00.000Z"));
  await transitionTask(fixture.paths, fixture.task.id, "checking", {
    actor: "codex",
    reason: "Verify revision-one implementation.",
    now: () => new Date("2026-08-04T01:06:01.000Z"),
  });
  await upsertCheck(fixture.paths, fixture.task.id, {
    requirementId: "R1",
    planItem: "Exercise a new revision-one failure",
    paths: ["src/core/workflow.ts"],
    evidenceIds: [],
    result: "fail",
    summary: "The next revision still needs repair.",
    actor: "codex",
  }, () => new Date("2026-08-04T01:06:02.000Z"));
  await reworkTask(fixture.paths, fixture.task.id, {
    actor: "codex",
    reason: "Repair revision-one failure.",
  }, () => new Date("2026-08-04T01:06:03.000Z"));

  const history = await listCheckHistory(fixture.paths, fixture.task.id);
  expect(history.revisions).toEqual([
    expect.objectContaining({ verificationRevision: 0, reworkReason: "Repair revision-zero failure." }),
    expect.objectContaining({ verificationRevision: 1, reworkReason: "Repair revision-one failure." }),
  ]);
  expect(await readFile(join(fixture.directory, "check.md"), "utf8")).toBe("");
  expect(await readJson<TaskRecord>(join(fixture.directory, "task.json"))).toMatchObject({
    status: "in_progress",
    verificationRevision: 2,
  });
  expect((await validateWorkspace(fixture.paths)).issues).toEqual([]);
});

test("doctor identifies a recoverable pending rework without mutating it", async () => {
  const fixture = await createCheckingFixture();
  await expect(reworkTask(
    fixture.paths,
    fixture.task.id,
    {
      actor: "codex",
      reason: "Repair the failed requirement before another verification cycle.",
    },
    () => new Date("2026-08-04T01:06:00.000Z"),
    failingReworkOperations("history"),
  )).rejects.toThrow("rework intent remains pending for retry");

  const report = await diagnoseWorkspace(fixture.paths);
  expect(report).toMatchObject({
    healthy: false,
    rework: [{
      taskId: fixture.task.id,
      status: "pending",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "REWORK_INTENT_UNCOMMITTED" }),
      ]),
    }],
  });
  expect(await readJson<TaskRecord>(join(fixture.directory, "task.json"))).toMatchObject({
    status: "checking",
    verificationRevision: 0,
  });
});

test("orient resumes a pending rework before it presents the current task revision", async () => {
  const fixture = await createCheckingFixture();
  await expect(reworkTask(
    fixture.paths,
    fixture.task.id,
    {
      actor: "codex",
      reason: "Repair the failed requirement before another verification cycle.",
    },
    () => new Date("2026-08-04T01:06:00.000Z"),
    failingReworkOperations("task"),
  )).rejects.toThrow("rework intent remains pending for retry");

  const oriented = await orientWorkspace(fixture.paths, { host: "codex" });
  expect(oriented.candidates).toEqual([expect.objectContaining({
    id: fixture.task.id,
    status: "in_progress",
    verificationRevision: 1,
    reworkEligible: false,
    nextAction: "checking",
  })]);
});

test.each(["planning", "ready", "in_progress", "finished", "blocked", "archived"] as const)(
  "rework rejects a task in %s instead of using the normal transition route",
  async (status) => {
    const cwd = await createTempRepo();
    const paths = resolveVineaPaths(cwd);
    await initializeWorkspace(paths);
    const created = await createTask(paths, {
      title: `Reject ${status} rework`,
      risk: { level: "low", reasons: [] },
      qualityMode: "standard",
      executionMode: "single-agent",
      confirmation: "user",
    });
    let directory = created.directory;
    if (status === "archived") {
      directory = join(paths.archivedTasks, created.task.id);
      await rename(created.directory, directory);
    }
    await writeFile(join(directory, "task.json"), `${JSON.stringify({
      ...created.task,
      status,
    }, null, 2)}\n`, "utf8");

    await expect(reworkTask(paths, created.task.id, {
      actor: "codex",
      reason: "Attempt an invalid rework.",
    })).rejects.toThrow(status === "archived" ? "active" : "status checking");
  },
);

test("rework requires a reason and a failed or uncovered current-revision check", async () => {
  const fixture = await createCheckingFixture();
  await expect(reworkTask(fixture.paths, fixture.task.id, {
    actor: "codex",
    reason: "   ",
  })).rejects.toThrow("Rework reason must not be empty");

  await upsertCheck(fixture.paths, fixture.task.id, {
    requirementId: "R1",
    planItem: "Exercise passing requirement",
    paths: ["src/core/workflow.ts"],
    evidenceIds: [fixture.passEvidenceId],
    result: "pass",
    summary: "The requirement now passes.",
    actor: "codex",
  }, () => new Date("2026-08-04T01:05:11.000Z"));

  await expect(reworkTask(fixture.paths, fixture.task.id, {
    actor: "codex",
    reason: "All checks already pass.",
  })).rejects.toThrow("failed or uncovered current verification check");
});

test("a previous revision failure cannot authorize another rework", async () => {
  const fixture = await createCheckingFixture();
  const firstInput = {
    actor: "codex",
    reason: "Repair the original failed requirement.",
  };
  await reworkTask(fixture.paths, fixture.task.id, firstInput, () => new Date("2026-08-04T01:06:00.000Z"));
  await transitionTask(fixture.paths, fixture.task.id, "checking", {
    actor: "codex",
    reason: "Verify the repaired implementation.",
    now: () => new Date("2026-08-04T01:06:01.000Z"),
  });
  const currentEvidence = await recordEvidence(fixture.paths, fixture.task.id, {
    kind: "command",
    summary: "Current revision proof passes.",
    command: "npm test -- current",
    exitCode: 0,
    result: "pass",
    actor: "codex",
  }, () => new Date("2026-08-04T01:06:02.000Z"));
  for (const requirementId of ["R1", "A1"]) {
    await upsertCheck(fixture.paths, fixture.task.id, {
      requirementId,
      planItem: `Check ${requirementId} in the current revision`,
      paths: ["src/core/workflow.ts"],
      evidenceIds: [currentEvidence.id],
      result: "pass",
      summary: `${requirementId} passes in revision 1.`,
      actor: "codex",
    }, () => new Date("2026-08-04T01:06:03.000Z"));
  }

  await expect(reworkTask(fixture.paths, fixture.task.id, {
    actor: "codex",
    reason: "Do not rely on historical failure.",
  })).rejects.toThrow("failed or uncovered current verification check");
});

function failingReworkOperations(
  boundary: "intent" | "history" | "check" | "task" | "completion",
): Partial<ReworkPersistenceOperations> {
  if (boundary === "history") {
    return {
      appendHistory: async () => {
        throw new Error("Injected rework history failure");
      },
    };
  }
  if (boundary === "check") {
    return {
      writeCheck: async () => {
        throw new Error("Injected rework check failure");
      },
    };
  }
  if (boundary === "task") {
    return {
      writeTask: async () => {
        throw new Error("Injected rework task failure");
      },
    };
  }
  return {
    appendJournal: async (filename, value, repoRoot) => {
      const type = typeof value === "object" && value !== null && "type" in value
        ? (value as Record<string, unknown>).type
        : undefined;
      if ((boundary === "intent" && type === "rework_intent")
        || (boundary === "completion" && type === "reworked")) {
        throw new Error(`Injected rework ${boundary} failure`);
      }
      await appendJsonl(filename, value, repoRoot);
    },
  };
}

async function createCheckingFixture() {
  const cwd = await createTempRepo();
  const paths = resolveVineaPaths(cwd);
  await initializeWorkspace(paths);
  const task = await createTask(paths, {
    title: "Recover failed checks",
    risk: { level: "medium", reasons: ["behavior"] },
    qualityMode: "standard",
    executionMode: "single-agent",
    confirmation: "user",
  }, () => new Date("2026-08-04T01:05:00.000Z"));
  await addRequirement(paths, task.task.id, {
    id: "R1",
    text: "A failed check can be reworked.",
    actor: "codex",
  }, () => new Date("2026-08-04T01:05:01.000Z"));
  await addAcceptanceCriterion(paths, task.task.id, {
    id: "A1",
    text: "Current verification evidence is retained as history.",
    actor: "codex",
  }, () => new Date("2026-08-04T01:05:02.000Z"));
  await writeFile(join(cwd, "brief-source.md"), "# Brief\n\nRecover failed checks.\n", "utf8");
  await writeFile(join(cwd, "plan-source.md"), "# Plan\n\n1. Repair and verify.\n", "utf8");
  await setTaskBrief(paths, task.task.id, "brief-source.md", "codex", () => new Date("2026-08-04T01:05:03.000Z"));
  await setTaskPlan(paths, task.task.id, "plan-source.md", "codex", () => new Date("2026-08-04T01:05:04.000Z"));
  await transitionTask(paths, task.task.id, "ready", {
    actor: "codex",
    reason: "Plan is ready.",
    now: () => new Date("2026-08-04T01:05:05.000Z"),
  });
  await transitionTask(paths, task.task.id, "in_progress", {
    actor: "codex",
    reason: "Start implementation.",
    now: () => new Date("2026-08-04T01:05:06.000Z"),
  });
  const pass = await recordEvidence(paths, task.task.id, {
    kind: "command",
    summary: "Acceptance proof passes.",
    command: "npm test -- acceptance",
    exitCode: 0,
    result: "pass",
    actor: "codex",
  }, () => new Date("2026-08-04T01:05:07.000Z"));
  await transitionTask(paths, task.task.id, "checking", {
    actor: "codex",
    reason: "Begin checking.",
    now: () => new Date("2026-08-04T01:05:08.000Z"),
  });
  await upsertCheck(paths, task.task.id, {
    requirementId: "R1",
    planItem: "Exercise failure",
    paths: ["src/core/workflow.ts"],
    evidenceIds: [],
    result: "fail",
    summary: "The requirement still fails.",
    actor: "codex",
  }, () => new Date("2026-08-04T01:05:09.000Z"));
  await upsertCheck(paths, task.task.id, {
    requirementId: "A1",
    planItem: "Exercise passing acceptance",
    paths: ["src/core/workflow.ts"],
    evidenceIds: [pass.id],
    result: "pass",
    summary: "The acceptance proof passes.",
    actor: "codex",
  }, () => new Date("2026-08-04T01:05:10.000Z"));
  return { cwd, paths, task: task.task, directory: task.directory, passEvidenceId: pass.id };
}
