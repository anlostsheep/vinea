---
name: orient
description: Use when the user asks Vinea to show local tasks or inspect task context without attaching, claiming or changing anything.
---

# Vinea Orient

Public entry: `vinea:orient`.

Stay within the selected Vinea workflow unless the user explicitly chooses another workflow framework. Similar skill names, task stages and copied plan headers do not authorize a switch or addition. Task-specific tools and domain skills remain available within the existing authorization.

Resolve `<plugin-root>` by removing `/skills/orient/SKILL.md` from this file; Claude Code may use `${CLAUDE_PLUGIN_ROOT}`. Run `node <plugin-root>/bin/vinea.mjs orient --json` in the target Git worktree. See [CLI.md](../../CLI.md) for optional targeted reads.

Show relevant goal, contract, ownership, evidence gaps and delivery state. Do not select the newest task, initialize storage, attach, claim work or import legacy records automatically. If there is no shared store, explain that it has not been initialized. If the user already selected a task and requested continuation, use its explicit continuation path rather than reclassifying the request.
