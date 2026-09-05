---
name: finish
description: Use when a Vinea task appears implemented and needs final regression, learning, and archive gates.
---

# Vinea Finish

Public skill: `vinea:finish`.

## Bundled CLI contract

Use the public plugin's `bin/vinea.mjs`, never a global binary. Work from the target Git repository. In Codex, derive `<plugin-root>` from the absolute path of this current `SKILL.md` by removing `/skills/<current-skill>/SKILL.md`, then run `node <plugin-root>/bin/vinea.mjs`. In Claude Code, run `node ${CLAUDE_PLUGIN_ROOT}/bin/vinea.mjs`.

## Finish gates

Verify that business changes have been handled through the repository's Git workflow, every check row is covered and passing, and a TDD task contains red and green evidence. If a gate fails, stop and report it.

Propose only learning candidates that are stable, portable, verifiable, and not duplicates. Present all candidates in one list for accept or archive. Do not ask about them one candidate per turn. Promote an accepted candidate only with `learning accept <task-id> --id <id> --confirmed-by user`; archive the rest with a stated reason. Never promote learning without that user decision.

After all gates and confirmations pass, run `finish <task-id> --confirmed`, then `archive <task-id> --confirmed` only when the user also confirms archival. Vinea never commits business code for the user.
