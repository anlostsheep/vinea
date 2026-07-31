# Vinea manual two-host acceptance

This is the reproducible first-release acceptance script. It describes
expected results, not a claim that either host has already been exercised.
Record only observed host behavior in the **Observed run** section after
performing it.

## Preconditions

1. Create a disposable Git repository outside the Vinea source tree with one
   small behavior change and a real test command.
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
   session ready for the recovery step.

## 1. Create a confirmed Codex task

1. In Codex, use `vinea:propose` for the fixture behavior change. Select and
   explicitly confirm medium risk, `tdd`, and `single-agent` execution.
2. Add at least one requirement and acceptance criterion, then add the fixture
   file as task context. For diagnosis, equivalent CLI commands begin with:

   ```sh
   node ~/.codex/plugins/vinea/bin/vinea.mjs init
   node ~/.codex/plugins/vinea/bin/vinea.mjs propose \
     --title "Fixture behavior change" \
     --description "Change the fixture behavior with a test" \
     --risk medium --quality tdd --execution single-agent --confirmed
   ```

   Expected result: `.vinea/config.json` exists and the task appears below
   `.vinea/tasks/active/<task-id>/` with requirements, brief/plan artifacts,
   context manifest, evidence log, and check file as they are added.
3. Run the real fixture test before implementation and record it as `tdd-red`
   with its real failing command, exit code, and result. Make the smallest
   behavior change, run the test again, and record the passing result as
   `tdd-green`.

   Expected result: ordered red then green evidence is present; Vinea's
   `validate --json` reports an empty `issues` array before and after the code
   change.

## 2. Recover in a new Claude Code session

1. Open the new Claude Code session in the same fixture Git repository and
   invoke `vinea:orient`.
2. If Claude has no host-native session ID, choose the displayed active task
   and explicitly confirm continuation. Do not expect automatic binding.

   Expected result: the recovered task ID, requirements, context references,
   and red/green evidence match the Codex-created files. The task remains under
   `.vinea/tasks/active/<task-id>/` until archive.

## 3. Check, learn, finish, and archive

1. Fill a `vinea:check` row for every requirement, pointing to observed test or
   manual evidence. First attempt a finish with an uncovered requirement or
   unresolved learning candidate to verify that the gate fails.

   Expected result: `vinea:finish` reports the missing coverage or learning
   classification and does not mark the task finished.
2. Commit the fixture's business change through the fixture repository's normal
   Git workflow. Do not use task archival as a substitute for handling business
   changes.
3. Propose one deliberately non-reusable learning and archive it with a reason;
   do not accept it into `.vinea/specs/`. Cover remaining check rows, then
   confirm `vinea:finish` and `vinea:archive`.

   Expected result: reusable specs stay unchanged for the archived learning,
   `.vinea/tasks/active/<task-id>/` no longer exists, and the full record moves
   to `.vinea/tasks/archive/<task-id>/`.
4. Run:

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

No two-host run has been recorded yet. After executing this script, add actual
host versions, exact commands, observed recovery behavior, and failures here.
Do not claim automatic recovery, hooks, delegated role execution, or host
session binding unless it was directly observed.
