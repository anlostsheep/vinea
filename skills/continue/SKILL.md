---
name: continue
description: Use when the user has selected a Vinea task and wants to attach the current Codex or Claude Code session before work resumes.
---

# Vinea Continue

Public skill: `vinea:continue`.

## Bundled CLI contract

Use the public plugin's `bin/vinea.mjs`, never a global binary. Work from the target Git repository. In Codex, derive `<plugin-root>` from the absolute path of this current `SKILL.md` by removing `/skills/<current-skill>/SKILL.md`, then run `node <plugin-root>/bin/vinea.mjs`. In Claude Code, run `node ${CLAUDE_PLUGIN_ROOT}/bin/vinea.mjs`.

## Resume deliberately

After the user confirms the selected task, its quality mode, and its execution mode, run `continue <task-id> --host codex|claude --confirmed` (include a native session ID only when the host supplies it). Add `--start --reason <reason>` only when moving a ready task into implementation is also confirmed.

Load only the task brief, plan, compact journal, check file, and paths named by the context manifest. Do not replay chat history or load unrelated repository material. For a finished or archived task, report the lifecycle boundary and ask the user to select an active task or create a new one.
