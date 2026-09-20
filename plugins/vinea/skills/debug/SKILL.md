---
name: debug
description: Use when the user explicitly asks Vinea to investigate or repair a defect during development, acceptance or after delivery.
---

# Vinea Debug

Public entry: `vinea:debug`.

Stay within the selected Vinea workflow unless the user explicitly chooses another workflow framework. Similar skill names, task stages and copied plan headers do not authorize a switch or addition. Task-specific tools and domain skills remain available within the existing authorization.

Resolve `<plugin-root>` by removing `/skills/debug/SKILL.md` from this file; Claude Code may use `${CLAUDE_PLUGIN_ROOT}`. Use `node <plugin-root>/bin/vinea.mjs` from the target worktree. Read [CLI.md](../../CLI.md) for diagnostic and repair payloads.

Identify expected versus actual behavior and the evidence needed to distinguish likely causes. Inspect code and available observations before requesting information the agent can obtain itself. Keep confirmed facts, hypotheses, ruled-out causes, changes and validation gaps distinct so another agent can continue without treating speculation as fact.

Honor the requested mode: locating or explaining only does not authorize business writes. A repair request allows bounded implementation and verification within the confirmed contract. Claim the current worktree before editing; test the relevant behavior, not merely the changed lines. If evidence stops improving or costs grow, reassess the approach and surface a material decision instead of imposing a fixed retry count.

During active development, keep the repair in the same task. For delivered or archived work, `debug open` creates a related repair with fresh evidence and current authority; it never rewrites the original delivery or treats old passing results as repair proof. Broader requirements or relaxed constraints require a new user decision and contract version.

Finish with the cause supported by evidence, changes made, validation results and remaining uncertainty. Do not force a fresh brainstorm/plan cycle for a local defect. No persistent artifacts or binding are allowed when the user requested an ephemeral investigation.

For a new repair, `task authorize` records the concrete user implementation request and real reference before claim; merely selecting `debug` or opening a repair does not activate its grant. Honor required current brief/plan artifacts on an existing planning task. Keep the task protocol and plugin root pinned; neither a missing command nor an old installed directory authorizes downgrading or rebuilding task state elsewhere.

When correcting premature implementation, stop writes and revoke the owner's execution authority with `task suspend` (or release only your own claim and report to the owner). Refresh `continue`/`doctor`, including other worktrees, and inspect business changes. Do not equate code rollback or a legacy `planning` status with revoked write ownership. Preserve uncertain remote holds and obtain separate authority for destructive recovery or migration.

An in-flight restore serializes suspension until file writes and publication finish; `STORE_LOCKED` is not successful revocation. Partial recovery retains its contract until completed or explicitly suspended. After `RECOVERY_ABORTED`, inspect partial files and holds instead of retrying an old reservation or assuming new authorization revives it.
