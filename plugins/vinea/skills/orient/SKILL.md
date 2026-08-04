---
name: orient
description: Use when starting a Vinea task in a new Codex or Claude Code session, or when task attachment is uncertain.
---

# Vinea Orient

Public skill: `vinea:orient`.

## Bundled CLI contract

Use the public plugin's `bin/vinea.mjs`, never a global binary. Work from the target Git repository. In Codex, derive `<plugin-root>` from the absolute path of this current `SKILL.md` by removing `/skills/<current-skill>/SKILL.md`, then run `node <plugin-root>/bin/vinea.mjs`. In Claude Code, run `node ${CLAUDE_PLUGIN_ROOT}/bin/vinea.mjs`.

## Recovery

Run `orient --host codex|claude --json` read-only. Summarize workspace health, Git state, task phase, verification revision, modes, uncovered requirements, failed or uncovered checks, rework eligibility, context references, and latest check/evidence.

In Codex, use `CODEX_THREAD_ID` only when the current host actually exposes a
nonempty value. In that case pass it explicitly as
`--session-id "$CODEX_THREAD_ID"`, for example
`orient --host codex --session-id "$CODEX_THREAD_ID" --json`. Otherwise run
ordinary `orient --host codex --json` and use the same explicit candidate
confirmation flow. Do not invent a session ID. Claude Code has no Vinea
environment-variable fallback in this release; use `orient --host claude
--json` and confirm a displayed candidate.

- With a valid bound task, present its compact summary; do not change its state.
- With exactly one candidate, ask the user to confirm it before running `continue <task-id> --confirmed ...`.
- With several candidates, present their summaries and ask the user to select one; never guess by time or name.
- If diagnostics are unhealthy, direct the user to `vinea:doctor` before further work.

For a `checking` task, route an all-pass current matrix to `finish`; keep an incomplete matrix in checking; and route a confirmed implementation defect through explicit `task rework <task-id> --reason <text>`. Do not use `blocked` for ordinary repair work.
