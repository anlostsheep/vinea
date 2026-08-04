---
name: continue
description: Use when the user has selected a Vinea task and wants to attach the current Codex or Claude Code session before work resumes.
---

# Vinea Continue

Public skill: `vinea:continue`.

## Bundled CLI contract

Use the public plugin's `bin/vinea.mjs`, never a global binary. Work from the target Git repository. In Codex, derive `<plugin-root>` from the absolute path of this current `SKILL.md` by removing `/skills/<current-skill>/SKILL.md`, then run `node <plugin-root>/bin/vinea.mjs`. In Claude Code, run `node ${CLAUDE_PLUGIN_ROOT}/bin/vinea.mjs`.

## Resume deliberately

After the user confirms the selected task, its quality mode, and its execution mode, run `continue <task-id> --host codex|claude --confirmed`. In Codex, append `--session-id "$CODEX_THREAD_ID"` only when the host actually provides a nonempty `CODEX_THREAD_ID`; otherwise omit it and do not invent a value. Claude Code uses no Vinea session-ID environment variable in this release. Add `--start --reason <reason>` only when moving a ready task into implementation is also confirmed.

Load only the task brief, plan, compact journal, check file, and paths named by the context manifest. Do not replay chat history or load unrelated repository material. For a finished or archived task, report the lifecycle boundary and ask the user to select an active task or create a new one.

## Revision-aware resumption

When continuing a reworked task, use the current verification revision shown by `task show` or `orient`. Historical checks and evidence are audit material only: regenerate fresh evidence for this revision, and for TDD record a new red result followed by a new green result before returning to `checking`. Do not reuse old evidence IDs or old passing check rows to satisfy the new cycle.
