import { initializeStore } from "../kernel/store.js";
import { createGoal, reviseContract } from "../kernel/contracts.js";
import { addAssignment, claimWork, releaseWork } from "../kernel/ownership.js";
import { continueGoal, handoffWork, takeoverWork, clearWorkspaceHold } from "../kernel/continuation.js";
import { captureSnapshot, restoreSnapshot } from "../kernel/snapshots.js";
import { recordReportedEvidence, recordUserObservation } from "../kernel/evidence.js";
import { runVerification } from "../kernel/verification.js";
import { submitContribution, integrateContribution } from "../kernel/contributions.js";
import { recordCheckSet, finishGoal, acceptDelivery, archiveGoal } from "../kernel/delivery.js";
import { openRepair, recordDiagnostic } from "../kernel/debug.js";
import { importLegacy } from "../legacy/import.js";
import { object, id, text, bool, integer, nullable, array, one, actorRule, decisionRule, contractDraftRule,
  tokenRule, environmentRule, checkRowRule, verificationRule, type Rule } from "../kernel/schema.js";
import type { RepositoryContext, Meta } from "../kernel/types.js";

type Handler = (ctx: RepositoryContext, meta: Meta, payload: never) => unknown;
const route = (handler: Handler, check: Rule) => ({ handler, check });
const task = { taskId: id }, version = { ...task, contractVersion: integer }, snapshot = { ...version, snapshotId: id };
const ref = object({ taskId: id, assignmentId: nullable(id), workspaceId: id, instanceId: id, epoch: integer });
const transfer = { from: ref, to: actorRule, contractVersion: integer, transferOwner: bool, ownerEpoch: nullable(integer), decision: nullable(decisionRule) };
const evidence = { ...snapshot, result: one("pass", "fail", "unverified"), phase: nullable(one("red", "green")), argv: nullable(array(text)), exitCode: nullable(integer), summary: text, environment: environmentRule };
const assignment = object({ outcome: text, dependsOn: array(id), assignee: nullable(id), businessWrite: bool });
const contribution = object({ kind: one("analysis", "change"), assignmentId: nullable(id), contractVersion: integer,
  snapshotId: nullable(id), evidenceIds: array(id), summary: text, writeToken: nullable(tokenRule) });
export const commands: Record<string, { handler: Handler; check: Rule }> = {
  "init": route(initializeStore, decisionRule),
  "task create": route(createGoal, object({ title: text, contract: contractDraftRule, decision: decisionRule })),
  "task revise": route(reviseContract, object({ ...task, expectedVersion: integer, ownerEpoch: integer, contract: contractDraftRule, decision: decisionRule })),
  "assignment add": route(addAssignment, object({ ...task, ownerEpoch: integer, assignment })),
  "continue": route(continueGoal, object({ ...task, assignmentId: nullable(id) }, { afterRevision: integer })),
  "work claim": route(claimWork, object({ ...version, assignmentId: nullable(id) })),
  "work release": route(releaseWork, tokenRule),
  "work handoff": route(handoffWork, object(transfer)),
  "work takeover": route(takeoverWork, object({ ...transfer, decision: decisionRule,
    stopBasis: one("holder-release", "host-stop-receipt", "user-declared-stop", "unknown"), stopReference: nullable(text), baselineSnapshotId: nullable(id) })),
  "work clear-hold": route(clearWorkspaceHold, object({ from: ref, stopBasis: one("holder-release", "host-stop-receipt", "user-declared-stop"), stopReference: nullable(text), decision: nullable(decisionRule) })),
  "snapshot capture": route(captureSnapshot, object({ ...task, paths: array(text), token: nullable(tokenRule) }, { limits: object({ maxFiles: integer, maxTotalBytes: integer, maxFileBytes: integer }) })),
  "snapshot restore": route(restoreSnapshot, object({ ...task, snapshotId: id, token: tokenRule, expectedTargetBase: nullable(text) })),
  "evidence report": route(recordReportedEvidence, object(evidence)),
  "evidence observe": route(recordUserObservation, object({ ...snapshot, decision: decisionRule, environment: environmentRule })),
  "verify": route(runVerification, object({ ...snapshot, argv: array(text), phase: nullable(one("red", "green")), timeoutMs: integer, environment: environmentRule, commandAuthorization: decisionRule })),
  "contribution submit": route(submitContribution, object({ ...task, contribution })),
  "contribution integrate": route(integrateContribution, object({ ...snapshot, contributionId: id, ownerEpoch: integer, rationale: text })),
  "check record": route(recordCheckSet, object({ ...snapshot, independent: bool, rows: array(checkRowRule), verification: array(verificationRule) })),
  "finish": route(finishGoal, object({ ...snapshot, ownerEpoch: integer, checkSetIds: array(id), contributionIds: array(id), exclusions: array(text), verification: array(verificationRule) })),
  "delivery accept": route(acceptDelivery, object({ ...task, deliveryId: id, decision: decisionRule })),
  "archive": route(archiveGoal, object({ ...task, decision: decisionRule })),
  "debug open": route(openRepair, object({ ...task, deliveryId: nullable(id), title: text, expected: text, actual: text, decision: decisionRule })),
  "debug record": route(recordDiagnostic, object({ ...task, kind: one("fact", "hypothesis", "ruled-out", "change", "validation-gap"), text, evidenceIds: array(id) })),
  "legacy import": route(importLegacy, object({ sourceRoot: text, expectedFingerprint: text, decision: decisionRule })),
};
