---
name: brainstorm
description: Use when a Vinea task has materially open design choices that must be resolved before implementation.
---

# Vinea Brainstorm

Public skill: `vinea:brainstorm`.

## Bundled CLI contract

Use the public plugin's `bin/vinea.mjs`, never a global binary. Work from the target Git repository. In Codex, derive `<plugin-root>` from the absolute path of this current `SKILL.md` by removing `/skills/<current-skill>/SKILL.md`, then run `node <plugin-root>/bin/vinea.mjs`. In Claude Code, run `node ${CLAUDE_PLUGIN_ROOT}/bin/vinea.mjs`.

## Selective design loop

Use this only when a task has a decision that can alter implementation. Do not force it for a clear low-risk request. Read the selected task's compact journal, context-manifest references, and relevant long-term specs.

Ask exactly one materially decision-changing question at a time. For each decision, present 2–3 options, identify the recommendation and trade-offs, then wait for the user's approval before moving on. Present the proposed design in small sections; obtain design approval before implementation.

After approval, write only the confirmed task-local brief and plan through `task set-brief` and `task set-plan`. This skill must not write reusable learning to specs; learning is considered later by `vinea:finish`.
