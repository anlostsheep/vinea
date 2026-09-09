---
name: plan
description: Use when the user explicitly asks Vinea to turn an agreed goal into an implementation plan; planning alone does not authorize execution.
---

# Vinea Plan

Public entry: `vinea:plan`.

Resolve `<plugin-root>` by removing `/skills/plan/SKILL.md` from this file; Claude Code may use `${CLAUDE_PLUGIN_ROOT}`. Use `node <plugin-root>/bin/vinea.mjs` from the target Git worktree and read [CLI.md](../../CLI.md) for state operations only when needed.

Plan to the risk and size of the goal. Identify deliverables, dependencies, existing code boundaries and verifiable acceptance. Include only constraints that affect correctness, scope, safety or real integration. A short task can remain a short checklist. Do not specify every edit or introduce fixed roles and ceremony.

Resolve any direction-changing choices in one round when independent. Preserve the approved contract and keep execution methods flexible. Mark actual dependencies; potential parallel work is not delegation permission. TDD is optional unless requested or required by the project; then plan distinct RED and GREEN evidence.

Deliver the plan and its verification strategy. Record user decisions with the current contract version if persistence was requested. Do not claim work, change business code, dispatch an agent, create a worktree or commit merely because the user approved the plan. An explicit execution request can move into the authorized run path without repeating planning.
