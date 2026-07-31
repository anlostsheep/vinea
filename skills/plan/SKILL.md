---
name: plan
description: Use when a confirmed Vinea task needs executable checklist-level work and explicit quality or execution choices.
---

# Vinea Plan

Public skill: `vinea:plan`.

## Bundled CLI contract

Use the public plugin's `bin/vinea.mjs`, never a global binary. Work from the target Git repository. In Codex, derive `<plugin-root>` from the absolute path of this current `SKILL.md` by removing `/skills/<current-skill>/SKILL.md`, then run `node <plugin-root>/bin/vinea.mjs`. In Claude Code, run `node ${CLAUDE_PLUGIN_ROOT}/bin/vinea.mjs`.

## Make the work executable

Confirm requirements and acceptance criteria, then make a checklist-level plan with implementation, validation, regression, and evidence steps. Add bounded context references through the CLI; do not hand-edit Vinea state.

For a behavior change or bug, recommend TDD and explain the red/green evidence needed. Start TDD only after the user confirms it. If a failing test cannot reasonably be formed, record the reason and ask the user to choose standard mode or blocked; do not quietly weaken the task.

For delegated execution, first recommend the mode and obtain user confirmation. Use research and check as read-only roles, and one implementer as the sole business-code writer, only when the active host supports those roles. Otherwise ask the user to choose single-agent execution or another host; do not silently fall back.
