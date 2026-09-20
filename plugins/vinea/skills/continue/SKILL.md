---
name: continue
description: Use when the user explicitly asks Vinea to resume or join a selected task, hand work to another agent, or recover interrupted execution.
---

# Vinea Continue

Public entry: `vinea:continue`.

Stay within the selected Vinea workflow unless the user explicitly chooses another workflow framework. Similar skill names, task stages and copied plan headers do not authorize a switch or addition. Task-specific tools and domain skills remain available within the existing authorization.

Resolve `<plugin-root>` by removing `/skills/continue/SKILL.md` from this file; Claude Code may use `${CLAUDE_PLUGIN_ROOT}`. Use `node <plugin-root>/bin/vinea.mjs` from the target worktree. Read the identity and transfer sections of [CLI.md](../../CLI.md).

Select the requested task, not the newest task by assumption. Resolve and reuse the echoed Actor instance ID across CLI processes. Include a host session ID only when actually supplied by that host; never invent one. A missing runtime Binding does not erase durable ownership. Load `continue`'s compact view; fetch individual evidence, contributions or snapshots by ID as needed.

On the first join by this genuinely new executor, `session resolve` with your actual host and `newInstance:true` allocates a local execution ID without writing state or claiming work. This is not a fabricated host session ID; omit `hostSessionId` if unavailable. If identity resolution is denied or fails, report **unbound** and stop. Another actor's Binding is never your identity, and a raw Claim is never a substitute for your own `continue` response's `writeToken`.

Joining is read-only unless the caller already holds a current write token. Do not claim simply because the user said "join" or because another agent appears idle. The owner and writer are distinct: agreeing to inspect a task is not accepting delivery responsibility. Confirm actual transfer intent when it is ambiguous.

Check the pinned protocol, planning artifacts and execution authorization in the current view. A continuation request reuses valid authority; it cannot create new implementation authority after planning, suspension or a contract change. Do not upgrade "next step" into a sourced implementation request. Missing authorization requires a concrete user execution decision, not a different entry label or task.

Keep the original plugin root. Report legacy/new-store coexistence and all writer holds; an old `planning` label does not revoke a kernel claim. Never switch to an older CLI or migrate state to make continuation succeed. After a stop, inspect code changes separately from `task suspend` and ownership recovery.

For a normal handoff, the current holder releases or hands off, and the recipient verifies the new epoch. For takeover, copy a public `occupiedWrites[].ref` from the latest view, record the stop basis and explicit user decision. Without proof the old writer stopped, recover a complete snapshot in an authorized isolated worktree. The old directory remains an `unknown-writer-hold`; never free it or reuse an old token just because the global epoch advanced. A recovery conflict must preserve target files and report the blocker.

After transfer, refresh the contract and validate the restored inputs before business writes. Contributors submit bounded results; only the responsible owner integrates them. Host dispatch, waiting and cancellation require real callable facilities and authorization, not Vinea status fields. Fall back openly to explicit relay when those facilities are absent.

An interrupted restore can retry the same reservation only while its authorization and contract are current. `RESTORE_IN_PROGRESS` prevents changing a partial recovery's contract; explicitly suspended reservations return `RECOVERY_ABORTED`. Inspect partial files, retained holds and stop evidence rather than replaying the old takeover after reauthorization. A busy lock is not proof that suspension took effect.
