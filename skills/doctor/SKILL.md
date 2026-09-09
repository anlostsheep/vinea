---
name: doctor
description: Use when Vinea reports unavailable Git context, invalid local state, occupancy or recovery problems that need read-only diagnosis.
---

# Vinea Doctor

Public entry: `vinea:doctor`.

Resolve `<plugin-root>` by removing `/skills/doctor/SKILL.md` from this file; Claude Code may use `${CLAUDE_PLUGIN_ROOT}`. Run `node <plugin-root>/bin/vinea.mjs doctor --json` or `validate --json` from the affected Git worktree. See [CLI.md](../../CLI.md) for targeted reads.

Distinguish missing initialization, malformed or future schema, active lock, stale identity, unavailable snapshot and unresolved writer hold. Inspect only facts that determine the next safe action. Do not repair state by deleting it, steal a lock on timeout, clear a hold without stop evidence, rewrite history or initialize Git in a non-Git directory.

Explain the concrete blocker and the smallest recovery requiring user action. A binding can be recreated by explicit continue without removing ownership. A missing snapshot blob is unavailable content, not permission to substitute current files. Legacy inspection is read-only; import is separate, explicitly confirmed and grants no execution permission.
