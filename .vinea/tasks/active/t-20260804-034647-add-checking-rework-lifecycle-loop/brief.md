# Checking Rework Lifecycle Loop

## Context

Vinea currently models task progress as a forward-only lifecycle:

`planning -> ready -> in_progress -> checking -> finished -> archived`

A task in `checking` cannot return directly to `in_progress`. The only technically legal detour is `checking -> blocked -> in_progress`, but `blocked` represents an external impediment rather than failed verification. Using it for normal repair work corrupts lifecycle meaning, weakens routing, and makes task history harder for agents and humans to interpret.

The existing evidence model is also task-wide rather than verification-cycle-aware. After implementation changes, historical passing checks or an old TDD red/green sequence can still appear sufficient. A proper repair loop must invalidate that stale proof while retaining it as immutable history.

## Goal

Add an explicit, repeatable, and recoverable verification-rework loop:

`in_progress -> checking -> rework -> in_progress -> checking`

After every rework, only evidence and checks produced during the new verification cycle may satisfy TDD, coverage, and finish gates.

## Lifecycle contract

- Reuse `in_progress`; do not introduce a `reworking` status.
- Add a dedicated `task rework <task-id> --reason <text>` operation from `checking` to `in_progress`.
- Allow rework only when the current verification cycle contains at least one `fail` or `uncovered` check.
- Require a non-empty reason and do not require an additional user confirmation.
- Recording a failed check does not implicitly change task status.
- Keep `blocked` exclusively for genuine external blockers and preserve the existing explicit unblock flow.
- A task may repeat the checking/rework loop any number of times before finishing.

## Verification revision

- Upgrade the workspace data contract to schema v2.
- Add a non-negative integer `verificationRevision` to the current task state.
- New tasks start at revision `0`; every completed rework increments the revision exactly once.
- Evidence and check rows are automatically stamped with the task's current revision. Callers cannot override it.
- Use one global task-level revision. Rework invalidates coverage for every declared requirement and acceptance criterion; selective invalidation is out of scope.
- `finish` may consume only passing checks and linked evidence from the current revision.
- In TDD mode, the required red-before-green sequence must occur within the current revision.
- Historical records remain available for audit but never satisfy gates for a later revision.

## Current checks and history

- Keep `check.md` as the authoritative snapshot for only the current revision.
- Before rework, append the complete current snapshot to a new immutable `check-history.jsonl` file, including task ID, revision, archived time, rework reason, operation ID, and all rows.
- Clear `check.md` after the history snapshot is durable so the new cycle begins uncovered.
- Add `check history <task-id>` to list revision summaries.
- Add `check history <task-id> --revision <n>` to return the full snapshot for one cycle.

## Recoverable rework operation

`task rework` is one lifecycle operation rather than a composition of public commands. Under the task lock it must:

1. Persist a `rework_intent` journal event containing a stable operation ID and the complete source check snapshot.
2. Append that snapshot to `check-history.jsonl` idempotently.
3. Clear the current `check.md`.
4. Update the task to the next revision and `in_progress`.
5. Persist a matching `reworked` completion event.

The operation ID is deterministic for the task and source revision. Before ordinary work proceeds, Vinea recovers any pending rework intent. Retrying after a crash must converge to one logical history snapshot, one revision increment, one status transition, and one completed journal operation without losing the original check rows.

## Schema v2 migration

- Provide an explicit top-level `vinea migrate` command; normal commands must not silently migrate v1 workspaces.
- Migrate current mutable workspace/config, active and archived task records, and the current check snapshot to v2.
- Initialize every migrated task at verification revision `0`.
- Preserve existing immutable v1 journal, evidence, and context records byte-for-byte. In a v2 workspace, readers interpret a missing historical revision as revision `0`.
- Write all new records in v2 form after migration.
- Permit legal v1 immutable history inside a v2 workspace, but reject new v1 records.
- Make migration idempotent and recoverable after interruption.
- Keep the v2 workspace marker incompatible with the v1 reader so older Vinea binaries fail closed rather than writing v2 state.

## CLI and agent routing

- `task show` and `orient` expose the current revision, failed or uncovered IDs, rework eligibility, and an accurate next action.
- While `checking`, all-pass routes to `finish`; incomplete checking remains in `checking`; a confirmed implementation defect routes through explicit `task rework`.
- `vinea:check` may record the result and invoke the explicit rework operation when implementation must resume, but it does not edit business code.
- `vinea:continue` resumes a reworked `in_progress` task using only the current revision, generates fresh implementation/test evidence, and returns it to `checking` when the gates are satisfied.
- `vinea:orient`, `vinea:check`, and `vinea:continue` documentation must reflect this closed loop.

## Core invariants

- Rework is legal only from `checking` with a current-cycle `fail` or `uncovered` result and a reason.
- Revision values are non-negative safe integers.
- Evidence and checks cannot claim a revision newer than their task.
- `check.md` cannot mix revisions or contain stale rows.
- A task/revision pair has at most one logical history snapshot.
- A completed rework has an archived old snapshot, an empty current snapshot, an incremented revision, an `in_progress` task, and a matching completion event.
- A pending intent is either safely recoverable or reported as a precise validation/doctor error; it is never silently ignored.

## Non-goals

- Requirement-level selective invalidation.
- A new `reworking` lifecycle state.
- Automatic lifecycle changes inside `check upsert`.
- Rewriting immutable v1 historical logs.
- Parallel-agent implementation.

## Success criteria

- At least two consecutive checking/rework cycles complete successfully in an integration workspace.
- Stale evidence and stale TDD ordering cannot satisfy current-revision gates.
- Failure injection at every rework write boundary recovers without duplication or data loss.
- v1-to-v2 migration is explicit, idempotent, and accepts mixed-version immutable history.
- CLI, validator, skills, package checks, type checks, build, and the complete test suite pass.
