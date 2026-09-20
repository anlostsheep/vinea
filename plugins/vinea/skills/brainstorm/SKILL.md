---
name: brainstorm
description: Use when the user explicitly asks Vinea to clarify a goal or challenge unresolved design decisions, without authorizing business-code changes.
---

# Vinea Brainstorm

Public entry: `vinea:brainstorm`. This entry discusses and sharpens the goal; it does not grant implementation authority.

Stay within the selected Vinea workflow unless the user explicitly chooses another workflow framework. Similar skill names, task stages and copied plan headers do not authorize a switch or addition. Task-specific tools and domain skills remain available within the existing authorization.

Resolve `<plugin-root>` from this file by removing `/skills/brainstorm/SKILL.md`; Claude Code may use `${CLAUDE_PLUGIN_ROOT}`. Use `node <plugin-root>/bin/vinea.mjs` from the target Git worktree. Read [CLI.md](../../CLI.md) only when task state is needed. Ephemeral discussion needs no initialization, task creation, binding, or artifact.

Inspect relevant project facts yourself before asking the user. Challenge assumptions with concrete failure cases: what outcome matters, what is out of scope, what could invalidate the approach, and what observable delivery proves success? Do not use these as a mandatory questionnaire.

Ask independent material decisions together, with 2-3 options, a recommendation and the consequences. Ask dependent questions only after the previous answer changes the available choices. Separate confirmed facts, assumptions and decisions; never promote a guess into an agreed requirement. Follow up on contradictions rather than mechanically exhausting questions.

Stop when no unresolved user decision blocks a sound next action. Present a compact goal, effective constraints, acceptance criteria and remaining uncertainty. Do not demand a separate approval for every section or force a plan for a small change. The user's agreement with a design is not permission to implement. Persist only requested conclusions, not private reasoning or the whole conversation; `persist=false` means no state writes.

For persistent work, create or select the task and record a readable brief with `task document`, including goal, scope, constraints, non-goals and acceptance. An explicit brainstorm task requires a brief and plan before execution; finish this entry with its conclusions, not business edits. A chat summary alone is not the persisted brief. Ephemeral discussion still writes nothing.

Keep the selected plugin root and task protocol pinned. Missing commands or old task directories do not authorize an older CLI or a second authoritative store. Generic agreement or "continue to the next step" does not expand this entry into implementation; clarify the concrete next action only if that permission boundary is unresolved.
