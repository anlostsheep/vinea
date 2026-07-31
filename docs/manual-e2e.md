# Vinea manual two-host acceptance

This is the reproducible first-release acceptance script. It describes
expected results, not a claim that either host has already been exercised.
Record only observed host behavior in the **Observed run** section after
performing it.

## Preconditions

1. Create a disposable Git repository outside the Vinea source tree with one
   small behavior change and a real test command. Add `brief.md` and `plan.md`
   with the intended behavior and test steps, then commit the fixture baseline.
2. From the Vinea source checkout, run both local helpers:

   ```sh
   scripts/install-codex-plugin.sh
   scripts/install-claude-plugin.sh
   ```

   Expected paths are `~/.codex/plugins/vinea` and
   `~/.claude/plugins/marketplaces/vinea-local/plugins/vinea`. Each helper
   builds `plugins/vinea/`, writes its host marketplace manifest, and requests
   a new host session. There is no hook: do not expect the current session to
   discover a newly installed plugin.
3. Start a fresh Codex session in the fixture and a separate fresh Claude Code
   session ready for the recovery step. Use `vinea:orient` explicitly in each
   host; neither host gets automatic task attachment.

## 1. Create and prepare a confirmed Codex task

1. In Codex, use `vinea:propose` for the fixture behavior change. Select and
   explicitly confirm medium risk, `tdd`, and `single-agent` execution. For
   diagnosis, the equivalent CLI setup is:

   ```sh
   vinea() { node ~/.codex/plugins/vinea/bin/vinea.mjs "$@"; }
   fixture_path='src/fixture.ts' # replace with the fixture file you change
   fixture_test='npm test -- --run fixture.test.ts' # replace with its real test command
   vinea init
   proposal="$(vinea propose \
     --title "Fixture behavior change" \
     --description "Change the fixture behavior with a test" \
     --risk medium --quality tdd --execution single-agent --confirmed --json)"
   task_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$proposal")"
   ```

   Expected result: `.vinea/config.json` exists and
   `.vinea/tasks/active/$task_id/task.json` has status `planning`.
2. Add the requirement, acceptance criterion, planning artifacts, and context:

   ```sh
   vinea task require "$task_id" --id R1 --text "Fixture behavior changes as specified"
   vinea task accept "$task_id" --id A1 --text "The focused fixture test passes"
   vinea task set-brief "$task_id" --file brief.md
   vinea task set-plan "$task_id" --file plan.md
   vinea context add "$task_id" --path "$fixture_path" --purpose "Implementation target"
   vinea task transition "$task_id" --to ready --reason "Brief, plan, and context are complete"
   ```

   Expected result: `brief.md`, `plan.md`, `context-manifest.json`, `journal.md`,
   and `check.md` exist in the active task directory, and `task.json` is `ready`.
3. Attach Codex without starting work, then start only after a second explicit
   confirmation:

   ```sh
   vinea continue "$task_id" --host codex --confirmed
   vinea continue "$task_id" --host codex --confirmed --start --reason "Begin confirmed implementation"
   ```

   If the current Codex host actually exposes a nonempty `CODEX_THREAD_ID`, add
   `--session-id "$CODEX_THREAD_ID"` to both commands. Otherwise omit it; do
   not invent a session ID.

   Expected result: the first command leaves status `ready` and records a
   continuation. The second changes `task.json` to `in_progress`; a Codex
   runtime binding exists only in the nonempty-`CODEX_THREAD_ID` case.

## 2. Record TDD evidence, then recover in Claude Code

1. Run the real fixture test before implementation and record it as `tdd-red`
   with its real failing command, exit code, and result. Make the smallest
   behavior change, rerun the real test, and record `tdd-green`:

   ```sh
   vinea evidence record "$task_id" --kind tdd-red --summary "Focused test fails before the change" --command "$fixture_test" --exit-code 1 --result fail
   green_evidence="$(vinea evidence record "$task_id" --kind tdd-green --summary "Focused test passes after the change" --command "$fixture_test" --exit-code 0 --result pass --json)"
   green_evidence_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$green_evidence")"
   ```

   Expected result: `evidence.jsonl` has ordered red then green entries while
   `task.json` remains `in_progress`.
2. Open the new Claude Code session in the same fixture and invoke
   `vinea:orient`. The equivalent explicit CLI fallback is:

   ```sh
   claude_vinea() { node ~/.claude/plugins/marketplaces/vinea-local/plugins/vinea/bin/vinea.mjs "$@"; }
   claude_vinea orient --host claude --json
   claude_vinea continue "$task_id" --host claude --confirmed
   ```

   If Claude has no host-native session ID, choose the displayed active task and
   explicitly confirm `vinea:continue`.

   Expected result: the task ID, requirements, context references, and red/green
   evidence match the Codex-created files. Claude creates no fictitious session
   binding; the task stays `in_progress` below `.vinea/tasks/active/$task_id/`.
3. Enter checking with the supported state transition:

   ```sh
   vinea task transition "$task_id" --to checking --reason "Implementation and ordered TDD evidence are complete"
   ```

   Expected result: the TDD gate accepts the ordered evidence and `task.json`
   changes to `checking`. There is no `continue --review` command in this
   release.

## 3. Check, learn, finish, and archive

1. Commit the fixture's business change through the fixture repository's normal
   Git workflow. Do not use task archival as a substitute for handling business
   changes. Attempt a confirmed finish before covering `R1`:

   ```sh
   vinea finish "$task_id" --confirmed
   ```

   Expected result: Vinea rejects finish for uncovered requirements and leaves
   the active task at `checking`.
2. Cover the requirement with observed evidence, then propose and archive one
   deliberately non-reusable learning:

   ```sh
   vinea check "$task_id" --requirement R1 --plan-item "Implement fixture behavior" --paths "$fixture_path" --evidence "$green_evidence_id" --result pass --summary "Focused passing test covers R1"
   vinea check "$task_id" --requirement A1 --plan-item "Verify fixture behavior" --paths "$fixture_path" --evidence "$green_evidence_id" --result pass --summary "Focused passing test covers A1"
   vinea learning propose "$task_id" --id L1 --domain fixture --text "Fixture-only detail" --rationale "Not portable beyond this fixture"
   vinea learning archive "$task_id" --id L1 --reason "Task-local fixture detail"
   vinea finish "$task_id" --confirmed
   vinea archive "$task_id" --confirmed
   ```

   Expected result: the archived learning does not create a `.vinea/specs/`
   rule, `finish` changes status to `finished`, `archive` removes the active
   directory, and the complete record moves to
   `.vinea/tasks/archive/$task_id/` with status `archived`.
3. Run:

   ```sh
   node ~/.claude/plugins/marketplaces/vinea-local/plugins/vinea/bin/vinea.mjs validate --json
   ```

   Expected result: `{ "issues": [] }`. This validates Vinea state only; also
   run the fixture's own tests separately.

## Expected unsupported outcome

If a user confirms delegated execution but the current host cannot supply the
required role separation, `vinea:propose` or `vinea:plan` must ask the user to
choose single-agent work or another host. It must not silently delegate or
silently change the chosen execution mode.

## Observed run

Observed on 2026-07-31 with Codex CLI `0.144.4` and Claude Code `2.1.219`.
Both documented installers built the public package, installed and enabled
`vinea@personal` for Codex and `vinea@vinea-local` for Claude Code. Fresh,
non-interactive host sessions each reported `vinea:orient` when asked to
identify the installed skill. This verifies host discovery, but not an
interactive slash-command invocation.

The disposable fixture used the public Codex plugin CLI to create confirmed
medium-risk, `tdd`, single-agent task
`t-20260731-105222-greeting-punctuation`, attach brief/plan/context, and
continue it with `--host codex`; no `CODEX_THREAD_ID` was supplied, so no
Codex binding was created. A real `npm test` failed before the implementation
and passed after it; its recorded `tdd-red` and `tdd-green` evidence was then
visible to the Claude public-plugin CLI. The explicit Claude fallback
`orient --host claude --json` offered the same active task and `continue
--confirmed` created no fictitious session binding.

`finish --confirmed` first failed with `VINEA_FINISH_GATE_FAILED` for uncovered
`R1, A1`. After the fixture business commit, check rows for both IDs, and an
archived non-reusable learning, finish and archive succeeded. The task moved to
`.vinea/tasks/archive/<task-id>/`, `.vinea/specs/` contained only `index.md`,
the fixture test passed, and public-plugin `validate --json` returned
`{"issues":[]}`. There was no automatic task attachment, hook, delegated role
execution, or host session binding observed.

The original shell examples assigned `node …` to a scalar and invoked it as
`$VINEA`, which zsh treats as one executable name. They now use shell functions
so the documented Node entry point is runnable in zsh and POSIX-compatible
shells.
