import { randomUUID } from "node:crypto";
import { requireThat } from "./errors.js";
import { assertEntry, assertContract, getTask } from "./policy.js";
import { decisionRule, environmentRule, one, integer, nullable, array, text } from "./schema.js";
import { readState, mutateState } from "./store.js";
import { assertPersistence } from "./io.js";
import type { Evidence, Meta, RepositoryContext, VerificationEnvironment, Decision, Id } from "./types.js";

export interface EvidenceInput {
  taskId: Id; contractVersion: number; snapshotId: Id; result: Evidence["result"]; phase: Evidence["phase"];
  argv: string[] | null; exitCode: number | null; summary: string; environment: VerificationEnvironment;
}
// Only the command runner invokes this with command-runner; it is not a CLI endpoint.
export async function appendEvidence(ctx: RepositoryContext, meta: Meta, input: EvidenceInput,
  source: Evidence["source"], artifactId: Id | null): Promise<Evidence> {
  assertPersistence(meta); environmentRule(input.environment);
  one("pass", "fail", "unverified")(input.result); nullable(one("red", "green"))(input.phase);
  nullable(array(text))(input.argv); nullable(integer)(input.exitCode); text(input.summary);
  if (input.result === "pass" && input.exitCode !== null) requireThat(input.exitCode === 0, "EVIDENCE_INVALID", "Passing command cannot have a failing exit code");
  if (input.phase === "red") requireThat(input.result === "fail" && input.exitCode !== null && input.exitCode > 0, "EVIDENCE_INVALID", "RED needs a real nonzero failure");
  if (input.phase === "green") requireThat(input.result === "pass" && input.exitCode === 0, "EVIDENCE_INVALID", "GREEN needs exit zero");
  const receipt = await mutateState(ctx, meta, { command: "evidence.append", input, source, artifactId }, state => {
    const task = getTask(state, input.taskId);
    assertEntry(meta, task, "state-write"); assertContract(task, input.contractVersion);
    requireThat(state.snapshots[input.snapshotId], "SNAPSHOT_UNAVAILABLE", "Evidence snapshot does not exist");
    const { taskId: _, ...fields } = input;
    const e: Evidence = { ...fields, id: randomUUID(), actor: meta.actor, source, artifactId, cwd: ctx.worktreeRoot, sequence: state.revision + 1 };
    task.evidence[e.id] = e; return [e.id];
  });
  return (await readState(ctx)).tasks[input.taskId]!.evidence[receipt.resourceIds[0]!]!;
}
export async function recordReportedEvidence(ctx: RepositoryContext, meta: Meta, input: EvidenceInput): Promise<Evidence> {
  return appendEvidence(ctx, meta, input, "agent-report", null);
}
export async function recordUserObservation(ctx: RepositoryContext, meta: Meta, input: {
  taskId: Id; contractVersion: number; snapshotId: Id; decision: Decision; environment: VerificationEnvironment;
}): Promise<Evidence> {
  decisionRule(input.decision);
  return appendEvidence(ctx, meta, { taskId: input.taskId, contractVersion: input.contractVersion, snapshotId: input.snapshotId,
    environment: input.environment, result: "unverified", phase: null, argv: null, exitCode: null, summary: input.decision.summary }, "user-observation", null);
}
