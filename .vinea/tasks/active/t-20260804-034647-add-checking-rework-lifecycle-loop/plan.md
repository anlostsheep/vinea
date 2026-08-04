# Implementation Plan: Checking Rework Lifecycle Loop

## Delivery rules

- Use single-agent execution.
- Follow TDD for every behavioral change: add a focused failing test, confirm the expected failure, implement the smallest production change, then refactor while green.
- Preserve existing public behavior except for the approved schema-v2 migration boundary and explicit rework commands.
- Reuse the existing task lock, JSONL mutation, recovery, and validation conventions instead of composing multiple unlocked CLI operations.

## Step 1: Establish schema-v2 and mixed-history contracts

1. Add failing schema/type tests for:
   - v2 task state with `verificationRevision`;
   - v2 evidence and current check rows with revision metadata;
   - v2 rework intent/completion and check-history records;
   - rejection of negative, fractional, unsafe, or future revisions;
   - acceptance of legal v1 immutable history as revision `0` in a v2 workspace;
   - rejection of new v1 records after migration.
2. Update `src/core/types.ts` and `src/core/schema.ts` with explicit v1 historical and v2 current contracts. Do not normalize by rewriting immutable files.
3. Update readers in `src/core/task-store.ts`, `src/core/evidence.ts`, `src/core/check.ts`, and `src/core/validate.ts` so mixed historical records are normalized at read time while new writes remain v2-only.
4. Run the focused schema and validation tests and keep the full existing suite green.

## Step 2: Implement explicit, idempotent migration

1. Add failing core and CLI tests for:
   - diagnosis of a v1 workspace by the new CLI;
   - explicit v1-to-v2 migration of config, active/archive tasks, and current checks;
   - revision `0` initialization;
   - byte-preservation of journal/evidence/context history;
   - repeated migration returning an already-current result without changes;
   - recovery after failure at each mutable-file migration boundary;
   - a v2 workspace marker that an unmodified v1 reader rejects.
2. Add a focused migration coordinator, using durable intent/completion metadata and atomic replacement for mutable files.
3. Add the top-level `migrate` command to `src/cli.ts` and help/render output in `src/cli/render.ts`.
4. Ensure all non-migration commands fail with actionable guidance when the workspace still requires migration; do not silently upgrade it.
5. Run focused migration/CLI tests, then the schema, doctor, validation, and recovery suites.

## Step 3: Stamp and enforce the current verification revision

1. Add failing evidence/check/finish tests proving:
   - evidence and check writes automatically use the current task revision;
   - callers cannot select a revision manually;
   - `check.md` contains only current-revision rows;
   - old passing rows and evidence do not cover the new cycle;
   - standard-mode finish requires complete current-revision coverage;
   - TDD red-before-green must occur in the current revision.
2. Update creation and migration paths so tasks always have a valid revision.
3. Update `src/core/evidence.ts`, `src/core/check.ts`, and finish gates in `src/core/workflow.ts` to filter and validate against the current revision.
4. Extend validator diagnostics for mixed/current/future revision violations.
5. Run focused evidence, check, finish, workflow, and validation tests.

## Step 4: Implement the recoverable rework transaction

1. Add failing core tests for every precondition:
   - source status must be `checking`;
   - the current revision must contain `fail` or `uncovered`;
   - reason is required;
   - finished, archived, blocked, and other forward states are rejected;
   - a previous revision's failure cannot authorize a new rework.
2. Add failing success tests proving one operation:
   - archives the complete current snapshot with reason and operation ID;
   - clears current checks;
   - increments revision once;
   - sets status to `in_progress`;
   - appends matching `rework_intent` and `reworked` events.
3. Add the check-history path and typed append/read helpers. Enforce uniqueness by task, source revision, and operation ID.
4. Implement one task-locked rework coordinator, preferably isolated from generic forward transitions, and expose it through `task rework` rather than permitting raw `task transition --to in_progress` from `checking`.
5. Inject failures after intent, history append, check clear, task update, and completion append. Retry/recover each case and assert exactly one logical snapshot and revision increment with no lost rows.
6. Extend `doctor` and `validate` to identify recoverable intents, inconsistent completions, duplicate history, mixed current rows, and impossible revision relationships.
7. Run focused workflow, recovery, task-lock, mutation-recovery, doctor, and validator tests.

## Step 5: Add history queries and accurate routing

1. Add failing CLI contract tests for:
   - `task rework <id> --reason <text>` in human and JSON modes;
   - `check history <id>` summary output;
   - `check history <id> --revision <n>` full snapshot output;
   - missing/unknown revisions and invalid options;
   - updated command help.
2. Add failing orient/task-show tests for current revision, failure/uncovered IDs, rework eligibility, and contextual next gates.
3. Implement command parsing and rendering in `src/cli.ts` and `src/cli/render.ts`, backed by core APIs rather than direct file access.
4. Change `nextGate` semantics so `checking` distinguishes finish, continued checking, and explicit rework instead of always implying only `finished`.
5. Run CLI contract/error/help and orient/workflow tests.

## Step 6: Update public agent skills and packaging contract

1. Add or update plugin-skill tests first so the required lifecycle wording and bundled command paths fail before documentation changes.
2. Update:
   - `skills/check/SKILL.md` to record checks first and explicitly rework only when implementation must resume;
   - `skills/continue/SKILL.md` to resume at the current revision and regenerate fresh proof;
   - `skills/orient/SKILL.md` to report revision-aware next actions;
   - `skills/doctor/SKILL.md` if migration/recovery guidance is needed.
3. Keep the checker read-only with respect to business code, and keep `check upsert` free of implicit lifecycle mutations.
4. Build the public plugin and confirm the packaged copies contain the same workflow contract.

## Step 7: Integration and completion verification

1. Run focused tests after each step, then execute:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - `npm run package:plugin`
   - `npm run check:plugin`
   - `npm run check`
2. In a temporary copy of a real v1 workspace:
   - show that ordinary use requests explicit migration;
   - run `vinea migrate` twice;
   - verify the second run is a no-op;
   - confirm v1 immutable history remains unchanged and validates as revision `0`.
3. In a temporary integration task, execute two complete cycles:
   - enter `checking`;
   - record a failure;
   - run `task rework`;
   - produce current-revision TDD/evidence/checks;
   - return to `checking`;
   - repeat once;
   - prove revision-0 and revision-1 proof cannot finish revision 2;
   - add revision-2 proof and finish successfully.
4. Run Vinea `doctor` and `validate` on the integration workspace and then on this repository's migrated workspace.
5. Review the final diff for accidental v1-history rewrites, unapproved state transitions, unrelated refactors, generated artifacts, or credentials before any later commit request.
