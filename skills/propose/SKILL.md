---
name: propose
description: Use when deciding whether an AI-coding request should stay a direct answer, run inline, or become a Vinea task.
---

# Vinea Propose

Public skill: `vinea:propose`.

## Bundled CLI contract

Use the public plugin's `bin/vinea.mjs`, never a global binary. Work from the target Git repository. In Codex, derive `<plugin-root>` from the absolute path of this current `SKILL.md` by removing `/skills/<current-skill>/SKILL.md`, then run `node <plugin-root>/bin/vinea.mjs`. In Claude Code, run `node ${CLAUDE_PLUGIN_ROOT}/bin/vinea.mjs`.

## Route the request

- Answer-only research or explanation: answer directly; do not create a task.
- Clear, low-risk, quickly verifiable edit: offer inline work. If the user explicitly chooses it, record a short reason with `propose ... --inline-skip-reason <reason>`.
- Behavior changes, bugs, cross-module work, external effects, security, data, deployment, or other medium/high-risk work: run `propose` without `--confirmed`; show the matched risk reasons and the `standard`/`tdd`, `single-agent`/`delegated` choices.

Present the title, risk reasons, quality mode, and execution mode together in one round. Do not ask them in separate turns. Only after the user approves those choices, run the same proposal with `--confirmed`. The flag records a conversation decision; it never replaces obtaining that decision.
