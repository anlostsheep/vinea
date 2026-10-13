---
name: continue
description: Use when the user explicitly asks Vinea to resume or join a selected task, hand work to another agent, explicitly replace, pause, cancel or reopen a task, or recover interrupted execution.
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

For an explicit user request to take over, replace, pause, cancel or reopen, follow
the task-control section in CLI.md. New unbound callers may use continue with
named-entry/named-request, analysisOnly:false and the exact sourced user request.
Do not require old-owner approval or business-write authority for task control.
Use task takeover to accept responsibility yourself, or task replace-executor to
replace a specified collaborator; preserve other actors and valid work (1A).
A plain join stays read-only; bound-followup does not mint a new control decision.

Use task pause/cancel when explicitly requested even if planning is incomplete or
changed. Cancel preserves files and history without pretending delivery. Explicit
task reopen retains the cancelled task ID (2B), but requires current planning and
fresh implementation authorization before writes. Old approvals, tokens, checks
and aborted recoveries remain historical. Reopen alone is not implementation consent.

After transfer, inspect recovery tickets and nextActions. Use work resume: confirmed
stop and local inspection, an isolated complete snapshot, or a user-selected exact
isolated Git baseline with explicit non-adoption of uncaptured changes. Never pick
the baseline option for the user. No snapshot requires a recovery choice, not a new
task. Unknown source directories stay held. Distinguish the historical receipt from
current control when stillCurrent=false.

Schema-1 stores are read-only to the new CLI. Do not upgrade a real store or switch
an active task's pinned CLI automatically; coordinate clients using explicit upgrade
preview, resolved occupancy and separate user authorization.

After pause or cancelled-task reopening, use an explicit fresh work resume request
with recoveryId:null and the retained source OccupancyRef when unresolved source
work exists and no active ticket exists. Do not reuse an aborted ID or claim over unresolved source work. An old
source directory reused by another task/assignment is not the original occupancy;
use isolated snapshot/baseline recovery without touching its new claimant. Tasks
with control history transfer owner through task takeover, not legacy transferOwner.

Use recoverySources in the current control summary for source references; task show
does not expose continue's top-level occupiedWrites field. Do not infer a recovery
requirement from historical sources alone. After actual stopping, the original
holder may clear its hold with holder-release. Clearing a hold keeps any pending
recovery ticket; without one, ordinary claim may proceed if authorization, assignment
and remaining occupancy checks pass. New task authorize requires a concrete user
implementation request through run/debug, not the continue entry.
