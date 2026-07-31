---
name: orient
description: Use when starting a Vinea task in a new Codex or Claude Code session, or when task attachment is uncertain.
---

# Vinea Orient

Public skill: `vinea:orient`.

## Bundled CLI contract

Use the public plugin's `bin/vinea.mjs`, never a global binary. Work from the target Git repository. In Codex, derive `<plugin-root>` from the absolute path of this current `SKILL.md` by removing `/skills/<current-skill>/SKILL.md`, then run `node <plugin-root>/bin/vinea.mjs`. In Claude Code, run `node ${CLAUDE_PLUGIN_ROOT}/bin/vinea.mjs`.

## Recovery

Run `orient --host codex|claude --json` read-only. Summarize workspace health, Git state, task phase, modes, uncovered requirements, context references, and latest check/evidence.

- With a valid bound task, present its compact summary; do not change its state.
- With exactly one candidate, ask the user to confirm it before running `continue <task-id> --confirmed ...`.
- With several candidates, present their summaries and ask the user to select one; never guess by time or name.
- If diagnostics are unhealthy, direct the user to `vinea:doctor` before further work.
