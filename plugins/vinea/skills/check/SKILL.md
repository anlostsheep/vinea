---
name: check
description: Use when a Vinea task needs requirement-to-change regression evidence before it can be finished.
---

# Vinea Check

Public skill: `vinea:check`.

## Bundled CLI contract

Use the public plugin's `bin/vinea.mjs`, never a global binary. Work from the target Git repository. In Codex, derive `<plugin-root>` from the absolute path of this current `SKILL.md` by removing `/skills/<current-skill>/SKILL.md`, then run `node <plugin-root>/bin/vinea.mjs`. In Claude Code, run `node ${CLAUDE_PLUGIN_ROOT}/bin/vinea.mjs`.

## Evidence-first review

Record real command or manual evidence with `evidence record`; include the actual command, result, and a concise outcome. For TDD tasks, record both the expected failing red test and passing green test.

Fill every requirement row with a plan item, affected paths, linked evidence IDs, result, and summary using `check`. Inspect `check show` before completion. Stop on missing, failed, or uncovered evidence; report the gap and next safe action rather than claiming the task is complete. Do not treat a task checkbox or an agent assertion as evidence.

## Explicit rework loop

If a current checking-cycle row is `fail` or `uncovered` because implementation must resume, record that row first, explain the defect, then run `task rework <task-id> --reason <text>`. This archives the completed current matrix and opens the next verification revision in `in_progress`; it is not a raw lifecycle transition and does not require another confirmation.

The checker must not edit business code. After rework, hand off to `vinea:continue` for implementation and fresh proof. Use `check history <task-id>` to inspect prior-cycle summaries, or `check history <task-id> --revision <n>` for the full archived matrix.
