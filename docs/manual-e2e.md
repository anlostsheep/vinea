# Vinea vNext Manual Host Acceptance

This is a procedure, not a record of a successful run. See
[real-host status](verification/vinea-vnext-host-acceptance.md). Prior staged
workflow acceptance remains historical evidence in Git; it does not validate
the rewritten kernel.

## Preconditions

- Obtain explicit approval to install the local unreleased package into the
  selected hosts. Do not replace installed plugins as part of a code test.
- Obtain approval for actual delegation and additional worktrees when needed.
  Use a disposable repository, never production or the user's real `.vinea`.
- Run local build/package checks first. Record the package/source revision,
  host versions, models and real session/execution identifiers.
- Start new host sessions and verify which skill files they actually loaded.
  `plugin list` alone is insufficient. Do not use the old installed skill to
  claim that the new one has been tested.

## Activation and Planning

1. Ask for an ordinary small code change without mentioning Vinea. Check that
   no task/binding/shared store is created automatically.
2. Explicitly request `vinea:brainstorm` for a goal with one independent design
   choice and one choice dependent on the first answer. Observe fact-finding,
   batching and appropriate follow-up, without fixed question counts.
3. Request a plan only, approve the design but do not authorize implementation.
   Confirm business files remain unchanged. Ephemeral mode must not persist.
4. Authorize implementation via `vinea:run`. Inspect the stated goal, scope,
   constraints, acceptance and effective grant. The agent should not repeat
   a classification/approval ceremony for already settled decisions.

## Cross-Host Continuation

1. Have host A resolve a real Actor, create and claim the task, and make a
   small uncommitted change. Capture selected code/test contents.
2. Have host B explicitly continue the selected task using its own identity.
   Record the common Git directory. Joining must expose occupancy, not claim
   host A's write token or borrow its instance ID.
3. Ask A to hand off and B to resume. Confirm a new epoch and explicit delivery
   ownership choice. B must read only necessary current state, not full history.
4. Test an interrupted writer only in the disposable repository. Without a
   real stop receipt, authorize an isolated worktree and snapshot recovery.
   Confirm the old directory remains held and cannot be claimed by another task.
5. If delegation was authorized, use a real host-native dispatch and wait.
   Record actual child IDs and returned results. Vinea records the assignment,
   submitted contribution and owner integration; these do not prove dispatch.
6. If the host cannot dispatch/stop, observe truthful capability disclosure and
   explicit relay. Do not simulate the missing host with a script or host label.

## Evidence, Debug and Delivery

1. Run meaningful project-native verification. Distinguish actual command
   results, agent reports and user observations. Record contract, snapshot,
   command and environment; changing any relevant input requires reassessment.
2. Request standalone check. Confirm it does not fix business code. An
   unresolved failure is fail/unverified, not pass or silently omitted.
3. Authorize debug, preserving expected/actual, facts, hypotheses and validation
   gaps. An active-task repair stays in that task and needs no forced new plan.
4. Deliver recoverable uncommitted work with acceptance coverage. Confirm no
   automatic commit/push/deploy, no invented user acceptance, and no mandatory
   second reviewer or reusable-learning gate.
5. Request repair after delivery. Confirm a related task and new evidence are
   created while the original delivery and checks remain unchanged.

## Evidence to Keep

Record date, host/model, real task/session/execution identifiers, common Git
directory, source and snapshot versions, authorization, observed commands and
exit codes, changed files and unmet checks. Use exact bounded facts, not raw
chat transcripts or private reasoning. Keep secrets out of snapshots/logs.

Do not claim improved token efficiency without a controlled comparison using
comparable tasks, models and success criteria. A missing host capability is an
honest limitation, not a passed multi-agent scenario.
