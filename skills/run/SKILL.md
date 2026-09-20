---
name: run
description: Use when the user explicitly requests Vinea to carry a goal through implementation and delivery, or follows up on a bound Vinea task.
---

# Vinea Run

Public entry: `vinea:run`. Ordinary coding requests do not activate Vinea or create task state.

Stay within the selected Vinea workflow unless the user explicitly chooses another workflow framework. Similar skill names, task stages and copied plan headers do not authorize a switch or addition. Task-specific tools and domain skills remain available within the existing authorization.

Resolve `<plugin-root>` from this file by removing `/skills/run/SKILL.md`; in Claude Code use `${CLAUDE_PLUGIN_ROOT}` when provided. Run `node <plugin-root>/bin/vinea.mjs` from the target Git worktree. Read the relevant parts of [CLI.md](../../CLI.md) for command envelopes and payloads; never guess IDs or call a global binary.

Work toward the user's outcome within their constraints. Confirm only material choices that remain open; batch independent choices with options, tradeoffs and a recommendation. Approval of a design does not authorize implementation. Once execution is authorized, choose the method and proceed without mandatory brainstorming, planning, TDD, separate reviewers, or repeated approvals.

For persistent collaboration, initialize the local store explicitly if absent, resolve an Actor once and reuse its echoed identity, then create or continue the selected goal. Before business edits, obtain a current write claim in this physical worktree. If storage or ownership is unavailable, pause for exact access/recovery or the user's explicit choice to leave Vinea; do not silently implement outside the requested protocol. Load the compact current contract and relevant evidence; do not replay every historical record. Revise the versioned contract only for an actual user decision that changes scope or authority.

An entry and contract grant are only capability ceilings. Before the first claim, use `task authorize` to record the actual implementation request, its real message/transcript reference and, for a confirmation, the concrete action previously shown to the user. Generic continuation and plan approval are not execution authorization. Never invent a reference, relabel ambiguous user words, or present caller-reported provenance as host-authenticated consent. Reuse existing valid authorization for ordinary bound continuation; do not repeatedly ask for the same permission.

Inspect the selected task's protocol and current planning documents. Explicit brainstorm/plan tasks require both a brief and plan for this contract; use `task document`, not legacy commands. Do not create another task or switch plugin roots to escape the gate. A direct, explicitly authorized small run needs no artificial planning phase unless the user requires one.

When the user stops implementation, stop issuing business writes, use `task suspend` as the owner (or release your own claim and notify the owner), and inspect `continue`/`doctor` plus the business diff. Suspension does not undo code or stop another process; uncertain writers remain held. Do not silently revert user changes, downgrade the CLI, or report "planning" based on a second store.

Report suspension as effective only after it succeeds. An in-flight kernel restore holds the shared lock through file writes and publication; `STORE_LOCKED` means the stop was not recorded yet. A suspended partial recovery is aborted, not silently retryable after reauthorization. Check current authorization on retries; a previous successful receipt is not a fresh grant.

Delegation needs user authorization and callable host facilities. The host dispatches, waits and returns results; Vinea records assignments, contributions and integration. Use separate worktrees for simultaneous business writers. Never treat an assignment record as a dispatched agent or a submitted contribution as integrated work. If unavailable, state that once and use explicit relay or the authorized single-agent path.

Internal debugging and regression fixes are included in an authorized implementation. Stop for scope expansion or new high-impact authority, not for a routine test failure. Before delivery, capture selected inputs, record evidence with truthful provenance, cover acceptance criteria and finalize as the responsible owner. Uncommitted work is allowed; commit, push, deployment and user acceptance remain separate decisions.
