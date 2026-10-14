---
name: doctor
description: Use when Vinea reports unavailable Git context, invalid local state, occupancy or recovery problems that need read-only diagnosis.
---

# Vinea Doctor

Public entry: `vinea:doctor`.

Stay within the selected Vinea workflow unless the user explicitly chooses another workflow framework. Similar skill names, task stages and copied plan headers do not authorize a switch or addition. Task-specific tools and domain skills remain available within the existing authorization.

Resolve `<plugin-root>` by removing `/skills/doctor/SKILL.md` from this file; Claude Code may use `${CLAUDE_PLUGIN_ROOT}`. Run `node <plugin-root>/bin/vinea.mjs doctor --json` or `validate --json` from the affected Git worktree. See [CLI.md](../../CLI.md) for targeted reads.

Distinguish missing initialization, malformed or future schema, active lock, stale identity, unavailable snapshot and unresolved writer hold. Inspect only facts that determine the next safe action. Do not repair state by deleting it, steal a lock on timeout, clear a hold without stop evidence, rewrite history or initialize Git in a non-Git directory.

Explain the concrete blocker and the smallest recovery requiring user action. A binding can be recreated by explicit continue without removing ownership. A missing snapshot blob is unavailable content, not permission to substitute current files. Legacy inspection is read-only; import is separate, explicitly confirmed and grants no execution permission.

Check protocol identity, current brief/plan integrity, execution authorization and legacy active-state coexistence. Report a new kernel writer even if an old task says `planning`. Keep the selected plugin root: old directories are not evidence of the active version and do not authorize a downgrade. Pre-protocol tasks remain readable; migration is not automatic. This diagnostic entry never suspends writers or repairs artifacts itself.

Inspect task control history, retained collaborators and recovery nextActions. Explain that task takeover/pause/cancel/reopen can be requested through continue/run/debug; doctor does not perform them. Schema-1 stores require an explicitly authorized format upgrade; never change the pinned CLI to evade a gate.

For schema-1 stores blocked by pre-protocol writer claims, use store preview-upgrade
to inspect the exact refs and eligibility. This doctor entry remains read-only; an
explicit run/continue/debug request is required for the mutation. Version 3.0.1 store upgrade can release
only individually selected legacy writers with explicit stop declarations or host
receipts and a sourced upgrade request; see stoppedLegacyWriters in CLI.md. Never
impersonate the old owner, edit claims by hand or infer stopping from age/silence.
Normal writers, holds and restoration reservations remain protected. A successful
format upgrade leaves old tasks without an execution protocol; keep them read-only
or cancel only with an explicit instruction. Do not report this residual diagnostic
as a failed schema upgrade or silently create implementation authority.
