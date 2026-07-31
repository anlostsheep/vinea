import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { upsertCheck } from "../../src/core/check.js";
import { initializeWorkspace } from "../../src/core/config.js";
import { addContextReference } from "../../src/core/context.js";
import { recordEvidence } from "../../src/core/evidence.js";
import { acceptLearning, proposeLearning } from "../../src/core/learning.js";
import { resolveVineaPaths, type VineaPaths } from "../../src/core/paths.js";
import { validateWorkspace } from "../../src/core/validate.js";
import {
  addRequirement,
  createTask,
  setTaskBrief,
  setTaskPlan,
} from "../../src/core/workflow.js";
import { createTempRepo } from "../helpers/fixture.js";

const faults = vi.hoisted(() => ({
  artifact: null as string | null,
  completion: null as string | null,
}));

vi.mock("../../src/core/json.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/json.js")>();
  return {
    ...actual,
    appendJsonl: async (...args: Parameters<typeof actual.appendJsonl>) => {
      const value = args[1] as Record<string, unknown>;
      if (faults.completion === value.type) {
        faults.completion = null;
        throw new Error(`Injected ${String(value.type)} completion failure`);
      }
      return actual.appendJsonl(...args);
    },
  };
});

vi.mock("../../src/core/task-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/task-store.js")>();
  return {
    ...actual,
    writeManagedMutationTarget: async (...args: Parameters<typeof actual.writeManagedMutationTarget>) => {
      if (faults.artifact !== null && args[2].endsWith(`/${faults.artifact}`)) {
        const failed = faults.artifact;
        faults.artifact = null;
        throw new Error(`Injected ${failed} target failure`);
      }
      return actual.writeManagedMutationTarget(...args);
    },
  };
});

let paths: VineaPaths;

beforeEach(async () => {
  faults.artifact = null;
  faults.completion = null;
  paths = resolveVineaPaths(await createTempRepo());
  await initializeWorkspace(paths);
});

test("brief and plan retry their exact mutation after target and completion failures", async () => {
  const task = await createMutableTask("Recover task documents");
  const briefSource = join(paths.repoRoot, "brief-source.md");
  const planSource = join(paths.repoRoot, "plan-source.md");
  await writeFile(briefSource, "# Brief\n\nRecover the brief.\n", "utf8");
  await writeFile(planSource, "# Plan\n\n1. Recover the plan.\n", "utf8");

  faults.artifact = "brief.md";
  await expect(setTaskBrief(paths, task.id, briefSource, "codex", at("2026-07-31T09:00:00.000Z"))).rejects.toThrow(
    "Injected brief.md target failure",
  );
  expect(await validateWorkspace(paths)).toMatchObject({
    issues: [expect.objectContaining({ code: "MUTATION_INTENT_UNCOMMITTED" })],
  });
  await setTaskBrief(paths, task.id, briefSource, "codex", at("2026-07-31T09:01:00.000Z"));
  expect(await readFile(join(task.directory, "brief.md"), "utf8")).toBe("# Brief\n\nRecover the brief.\n");
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });

  faults.completion = "plan_set";
  await expect(setTaskPlan(paths, task.id, planSource, "codex", at("2026-07-31T09:02:00.000Z"))).rejects.toThrow(
    "Injected plan_set completion failure",
  );
  expect(await readFile(join(task.directory, "plan.md"), "utf8")).toBe("# Plan\n\n1. Recover the plan.\n");
  await writeFile(planSource, "# Plan\n\n1. A different request.\n", "utf8");
  await expect(setTaskPlan(paths, task.id, planSource, "codex", at("2026-07-31T09:03:00.000Z"))).rejects.toMatchObject({
    code: "VINEA_TRANSITION_INVALID",
  });
  await writeFile(planSource, "# Plan\n\n1. Recover the plan.\n", "utf8");
  await setTaskPlan(paths, task.id, planSource, "codex", at("2026-07-31T09:04:00.000Z"));
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });
});

test("context, evidence, and check mutations recover controlled artifacts without losing prior rows", async () => {
  const task = await createMutableTask("Recover task records");
  const contextSource = join(paths.repoRoot, "context-source.md");
  const changePath = join(paths.repoRoot, "src", "changed.ts");
  await writeFile(contextSource, "Durable context\n", "utf8");
  await mkdir(join(paths.repoRoot, "src"));
  await writeFile(changePath, "export const changed = true;\n", "utf8");

  faults.artifact = "context.jsonl";
  await expect(addContextReference(paths, task.id, {
    path: "context-source.md",
    purpose: "Recover context append",
    actor: "codex",
  }, at("2026-07-31T09:10:00.000Z"))).rejects.toThrow("Injected context.jsonl target failure");
  expect(await validateWorkspace(paths)).toMatchObject({
    issues: [expect.objectContaining({ code: "MUTATION_INTENT_UNCOMMITTED" })],
  });
  await addContextReference(paths, task.id, {
    path: "context-source.md",
    purpose: "Recover context append",
    actor: "codex",
  }, at("2026-07-31T09:11:00.000Z"));
  expect(await readFile(join(task.directory, "context.jsonl"), "utf8")).toContain('"path":"context-source.md"');
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });

  faults.completion = "evidence_recorded";
  await expect(recordEvidence(paths, task.id, {
    kind: "manual",
    summary: "The focused validation passed.",
    result: "pass",
    actor: "codex",
  }, at("2026-07-31T09:12:00.000Z"))).rejects.toThrow("Injected evidence_recorded completion failure");
  const evidenceAfterFailure = await readFile(join(task.directory, "evidence.jsonl"), "utf8");
  expect(evidenceAfterFailure).toContain("The focused validation passed.");
  expect(await validateWorkspace(paths)).toMatchObject({
    issues: [expect.objectContaining({ code: "MUTATION_INTENT_UNCOMMITTED" })],
  });
  await expect(recordEvidence(paths, task.id, {
    kind: "manual",
    summary: "A different evidence request.",
    result: "pass",
    actor: "codex",
  }, at("2026-07-31T09:13:00.000Z"))).rejects.toMatchObject({ code: "VINEA_TRANSITION_INVALID" });
  const evidence = await recordEvidence(paths, task.id, {
    kind: "manual",
    summary: "The focused validation passed.",
    result: "pass",
    actor: "codex",
  }, at("2026-07-31T09:14:00.000Z"));
  expect((await readFile(join(task.directory, "evidence.jsonl"), "utf8")).split("\n").filter(Boolean)).toHaveLength(1);

  faults.artifact = "check.md";
  await expect(upsertCheck(paths, task.id, {
    requirementId: "R1",
    planItem: "Verify the durable mutation",
    paths: ["src/changed.ts"],
    evidenceIds: [evidence.id],
    result: "pass",
    summary: "The recovered evidence covers the requirement.",
    actor: "codex",
  }, at("2026-07-31T09:15:00.000Z"))).rejects.toThrow("Injected check.md target failure");
  expect(await validateWorkspace(paths)).toMatchObject({
    issues: [expect.objectContaining({ code: "MUTATION_INTENT_UNCOMMITTED" })],
  });
  const recovered = await upsertCheck(paths, task.id, {
    requirementId: "R1",
    planItem: "Verify the durable mutation",
    paths: ["src/changed.ts"],
    evidenceIds: [evidence.id],
    result: "pass",
    summary: "The recovered evidence covers the requirement.",
    actor: "codex",
  }, at("2026-07-31T09:16:00.000Z"));
  expect(recovered.rows).toHaveLength(1);
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });
});

test("learning acceptance resumes partial spec writes and completed targets without changing user confirmation", async () => {
  const task = await createMutableTask("Recover learning acceptance");
  await proposeLearning(paths, task.id, {
    id: "L1",
    domain: "recovery-practice",
    text: "Resume a partially written managed promotion.",
    rationale: "A pending multi-file promotion must be recoverable.",
    actor: "codex",
  }, at("2026-07-31T09:20:00.000Z"));
  const specPath = join(paths.specs, "recovery-practice.md");
  const indexPath = paths.specIndex;

  faults.artifact = "index.md";
  await expect(acceptLearning(paths, task.id, {
    id: "L1",
    confirmedBy: "user",
    actor: "codex",
  }, at("2026-07-31T09:21:00.000Z"))).rejects.toThrow("Injected index.md target failure");
  expect(await readFile(specPath, "utf8")).toContain("Resume a partially written managed promotion.");
  await expect(readFile(indexPath, "utf8")).resolves.not.toContain("recovery-practice");
  await expect(acceptLearning(paths, task.id, {
    id: "L1",
    confirmedBy: "user",
    actor: "other",
  }, at("2026-07-31T09:22:00.000Z"))).rejects.toMatchObject({ code: "VINEA_TRANSITION_INVALID" });
  expect(await validateWorkspace(paths)).toMatchObject({
    issues: [expect.objectContaining({ code: "MUTATION_INTENT_UNCOMMITTED" })],
  });
  await acceptLearning(paths, task.id, {
    id: "L1",
    confirmedBy: "user",
    actor: "codex",
  }, at("2026-07-31T09:23:00.000Z"));
  expect(await readFile(indexPath, "utf8")).toContain("recovery-practice.md");
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });

  await proposeLearning(paths, task.id, {
    id: "L2",
    domain: "recovery-practice",
    text: "Complete all targets before semantic acknowledgement.",
    rationale: "The completion record comes after every controlled target.",
    actor: "codex",
  }, at("2026-07-31T09:24:00.000Z"));
  faults.completion = "learning_accepted";
  await expect(acceptLearning(paths, task.id, {
    id: "L2",
    confirmedBy: "user",
    actor: "codex",
  }, at("2026-07-31T09:25:00.000Z"))).rejects.toThrow("Injected learning_accepted completion failure");
  const taskJson = await readFile(join(task.directory, "task.json"), "utf8");
  expect(taskJson).toContain('"id": "L2"');
  expect(taskJson).toContain('"status": "accepted"');
  expect(await readFile(specPath, "utf8")).toContain("Complete all targets before semantic acknowledgement.");
  expect(await readFile(indexPath, "utf8")).toContain("recovery-practice.md");
  expect(await validateWorkspace(paths)).toMatchObject({
    issues: [expect.objectContaining({ code: "MUTATION_INTENT_UNCOMMITTED" })],
  });
  await expect(acceptLearning(paths, task.id, {
    id: "L2",
    confirmedBy: "user",
    actor: "other",
  }, at("2026-07-31T09:26:00.000Z"))).rejects.toMatchObject({ code: "VINEA_TRANSITION_INVALID" });
  await acceptLearning(paths, task.id, {
    id: "L2",
    confirmedBy: "user",
    actor: "codex",
  }, at("2026-07-31T09:27:00.000Z"));
  const journal = (await readFile(join(task.directory, "journal.md"), "utf8")).split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const intent = journal.find((event) => event.type === "mutation_intent" && event.mutationKind === "learning_accepted");
  expect(intent).toMatchObject({ fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) });
  expect(JSON.stringify(intent)).not.toContain("Complete all targets before semantic acknowledgement.");
  expect(await validateWorkspace(paths)).toEqual({ issues: [] });
});

async function createMutableTask(title: string) {
  const created = await createTask(paths, {
    title,
    risk: { level: "medium", reasons: ["behavior"] },
    qualityMode: "standard",
    executionMode: "single-agent",
    confirmation: "user",
  }, at("2026-07-31T08:00:00.000Z"));
  await addRequirement(paths, created.task.id, {
    id: "R1",
    text: "The managed mutation is durable.",
    actor: "codex",
  }, at("2026-07-31T08:01:00.000Z"));
  return { ...created, id: created.task.id };
}

function at(timestamp: string): () => Date {
  return () => new Date(timestamp);
}
