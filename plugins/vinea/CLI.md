# Vinea Kernel CLI

This is an on-demand agent reference, not a mandatory user workflow. Logical skill entries are `vinea:run`, `brainstorm`, `plan`, `continue`, `check`, `debug`, `finish`, `orient`, and `doctor`. A bare `/vinea` alias is not registered by this package. Ordinary requests do not activate Vinea.

## Invocation and Identity

Run `node <plugin-root>/bin/vinea.mjs <command> --input - --json` from the target Git worktree, supplying a JSON envelope through stdin. The CLI never initializes Git. Resolve the plugin root from the current skill file; Claude Code can use `${CLAUDE_PLUGIN_ROOT}`. Do not use a global binary. Read-only commands do not need an envelope.

```json
{
  "meta": {
    "operationId": "unique-operation-id",
    "actor": { "host": "codex", "instanceId": "previously-echoed-instance-id" },
    "invocation": {
      "entry": "run",
      "activation": "named-entry",
      "analysisOnly": false,
      "persist": true
    }
  },
  "payload": {}
}
```

`entry` is the actual requested skill intent, never a convenient permission override. `activation` is `named-entry`, `named-request`, `bound-followup`, or `none`. A follow-up requires an existing matching local binding; it does not broaden authority. A standalone analysis/check cannot acquire a business write token. Ephemeral discussion needs no CLI mutation. `persist=false` rejects locks, artifacts and verification process creation, not just final state publication.

Task grants do not override host filesystem permissions. For `STORAGE_PERMISSION_DENIED`, read [host setup](HOSTS.md) and request access only to the real shared store. Do not relocate authority, disable host protection or silently continue with business edits outside Vinea. In `continue`, `missing` describes runtime/recovery issues, not acceptance coverage; an empty array does not mean the goal passed verification.

`session resolve` takes payload `{}`. To explicitly begin an execution instance, use actor `{ "host": "codex", "newInstance": true }` (use `claude` for Claude Code). Copy the returned complete Actor into subsequent envelopes. Never repeat `newInstance` on every call or borrow another executor's instance ID. When the host actually provides a session ID, include `hostSessionId`; without a session binding or explicit instance ID, resolution fails instead of guessing. Bindings are disposable hints, not write ownership. IDs are coordination identifiers, not authentication credentials.

For a genuinely new joining executor, generating this local `instanceId` is the identity-only first step, even for a read-only join. It creates no task, Binding or write claim. It is distinct from asserting a real `hostSessionId`, which must be omitted when unavailable. If host permissions prevent resolution, remain unbound and report that failure; never substitute another actor's Binding or a raw stored Claim for your own identity or returned write token.

Every mutation has a unique `operationId`. Reuse it only for a retry of the identical logical command, Actor and invocation. A changed payload needs a new ID. Errors do not mean that a multi-step command had no effect: refresh state before deciding to retry. A repeated verifier reservation never silently executes a command again; `VERIFICATION_INCOMPLETE` requires inspection and an explicit new attempt if appropriate.

## Common Shapes

- `Decision`: `{ "summary": "actual user decision", "reference": null }`; use a real reference when available, never fabricate approval.
- `ContractDraft`: `{ "goal": "outcome", "scope": ["src"], "constraints": ["Do not commit"], "acceptance": [{ "id": "A1", "text": "observable result" }], "quality": "standard", "grant": { "businessWrite": true, "delegate": false, "commit": false, "deploy": false, "allowedPaths": ["src"] } }`. Quality is `standard` or explicitly requested `tdd`. Paths are repository-relative file/directory names, not globs. Scope is descriptive; `allowedPaths` controls business writes. No grant should exceed current user authority.
- `WriteToken`: copy the complete result of `work claim`, handoff or takeover, including `contractVersion` and `epoch`. Read summaries are not tokens.
- `OccupancyRef`: copy `continue.data.occupiedWrites[].ref`, containing `taskId`, `assignmentId`, `workspaceId`, `instanceId`, `epoch`. It is a public reference, not permission to write.
- `Environment`: `{ "runtime": "actual Node process.version", "platform": "actual process.platform", "labels": { "serviceRevision": "observed revision" } }`. The runner checks its Node runtime/platform; report other runtimes and external conditions in labels. Snapshot identity does not measure a remote service, configuration or environment. The agent must refresh those facts before claiming current verification. Never include secrets.

## Goals and Work

| Command | Exact payload |
|---|---|
| `init` | Decision; explicit local initialization only |
| `task create` | `{title, contract: ContractDraft, decision: Decision, planningRequired?: boolean}` |
| `task document` | `{taskId, contractVersion, ownerEpoch, kind: "brief" or "plan", content: "readable Markdown"}` |
| `task authorize` | `{taskId, contractVersion, ownerEpoch, request: ExecutionRequest}` |
| `task suspend` | `{taskId, contractVersion, ownerEpoch, decision: Decision}` |
| `task revise` | `{taskId, expectedVersion, ownerEpoch, contract: ContractDraft, decision: Decision}` |
| `assignment add` | `{taskId, ownerEpoch, assignment: {outcome, dependsOn: [], assignee: null, businessWrite: false}}` |
| `continue` | `{taskId, assignmentId: null}`; optional `afterRevision` cursor |
| `work claim` | `{taskId, assignmentId: null, contractVersion}` |
| `work release` | WriteToken itself |

Read `owner.epoch` and the current contract version rather than assuming `1`. Persistent brainstorm/plan can create a task without execution authority; ephemeral discussion creates nothing. Creation stores a proposed contract ceiling, not permission to implement. `task authorize` is separate from both creation and claim. Revisions append history and require fresh authorization and, where required, current planning documents. Assignment creation records collaboration only, not a real dispatch. Host facilities perform actual spawning, waiting and cancellation when authorized. Simultaneous business writers need distinct physical worktrees.

## Planning and Execution Authorization

New tasks pin `workflow.protocol = "planning-authorization-v1"`. Keep the selected
plugin root and protocol throughout the task. Missing/removed commands are not
permission to use an older CLI or create a parallel legacy task. Pre-protocol
tasks remain readable, but business operations return `TASK_PROTOCOL_REQUIRED`;
there is no automatic migration. Older CLIs may reject stores containing the new
task fields. Do not overwrite or downgrade such stores.

Persistent explicit brainstorm/plan tasks always require both a brief and plan.
`planningRequired: true` also requests this for direct execution; `false` cannot
disable it for a planning entry. Recording a planning document also makes both
documents required on a previously direct task. `task document` writes immutable Markdown under
`<store>/tasks/<taskId>/planning/v<contractVersion>/<kind>-<sha256>.md` and records
the path/hash in the same task. Brief: goal, scope, constraints, non-goals and
acceptance. Plan: actionable steps, dependencies and verification. Nonempty text
and hash integrity are checked; meaningful content still requires agent/user
review. Chat prose, a todo list and contract JSON do not substitute for artifacts.

An `ExecutionRequest` has this shape:

```json
{
  "kind": "implementation-confirmation",
  "userMessage": "Yes, begin implementation",
  "reference": "actual-session:actual-user-message",
  "action": "Implement the selected plan within the stated paths; no commit or deployment"
}
```

Use `implementation-request` for a direct request (`action: null`), or
`implementation-confirmation` with the concrete action actually shown before
the user's confirmation. `continuation` and `plan-approval` are rejected. Quote
the user's actual words and a real retrievable reference; a dated transcript
location is acceptable when the host exposes no message ID. Do not invent IDs
or rephrase "next step" into implementation consent. If the requested action is
unclear, ask one concrete permission question. No special slash-command wording
is required from the user.

Only the owner using an explicit `run` or `debug` invocation with an actual
implementation request can record new authorization, not a bound follow-up.
The kernel validates these recorded fields, not whether the natural-language
request describes a repair. Authorization pins the current contract and selected
document IDs; each immutable artifact record carries its path and SHA-256.
Token checks re-read those files, including cached-token contribution and snapshot
operations. Delivery checks planning integrity even after the writer released.
A valid authorization supports continuation without repeated approval. A direct
authorized small run need not fabricate planning documents. `task document`
cannot replace authorized documents until execution is suspended or the contract
is revised; old versions remain available.

On a user stop, cease business edits and use `task suspend` as owner. It revokes
authorization, advances execution epochs and releases only the caller's own
local claim. Other writers/restorations become `unknown-writer-hold`, not proof
of stopped processes. Contributors may release their own claim and notify the
owner. Inspect `continue`, `doctor` and the business diff separately; suspension
does not undo files. Resuming requires a fresh explicit request with a new source
reference; reusing a revoked or superseded approval is rejected. Do not silently
roll back code, clear foreign holds or recreate a legacy `planning` task.
An idempotent `task authorize` retry also checks current validity: revoked,
superseded or changed planning cannot be returned as a successful authorization.

These are protocol checks, not host authentication. Request kind, quotation and
reference are caller-reported; the kernel cannot authenticate them or infer
natural-language intent. It cannot intercept arbitrary host editor/shell writes.
`entry=run`, an allowed grant or a successful claim is never independent proof
of user consent.

## User-directed task control (schema 2, Vinea 3.0)

Users control the task; its owner and writers are replaceable. Control does not
require the old owner's cooperation, a claim, business-write permission or valid
planning artifacts. Corrupt authoritative state still fails closed.

All five commands take `{taskId, contractVersion, expectedControlRevision,
ownerEpoch, request:{userMessage,reference,action}, reason}`. Copy versions from
the latest task view (initial control revision is zero). The request contains the
actual user words and a retrievable reference; `action` matches the command.
These are auditable caller declarations, not host authentication. A different
instance ID is not a trusted identity and ordinary joining is not a control request.

| Command / action | Behavior |
| --- | --- |
| `task takeover` / `takeover` | Caller accepts ownership and replaces the old owner's related work |
| `task replace-executor` / `replace-executor` | Also takes `{fromInstanceId,to:Actor}`; replaces that actor's work, including unclaimed assignments; an unrelated owner stays |
| `task pause` / `pause` | Revokes all execution authority, retaining the task and files |
| `task cancel` / `cancel` | Pauses and records cancelled without requiring acceptance or creating delivery |
| `task reopen` / `reopen` | Reopens cancelled work under the same ID with the caller as owner |

All accept `continue`, `run` or `debug`, with `named-entry`/`named-request`,
`analysisOnly:false`, `persist:true`. Fresh unbound sessions are supported.
Planning/read-only entries, `activation:none` and `bound-followup` cannot supply
new control authority. Existing owner-only `task suspend` remains compatible.

Replacement preserves other collaborators' exact valid claims, epochs and
authorization (1A). Revoked work cannot be reclaimed by the old actor or bypassed
through the old handoff API. Reassignment to the same actor later is explicit,
not a permanent identity ban. Ownership transfer does not grant business writes.

Responses include historical `event`, `current` and `stillCurrent`. Replaying an
old operation does not repeat it. If superseded, `stillCurrent:false` prevents the
receipt from being mistaken for current ownership. Refresh on `CONTROL_CHANGED`.

| Example | Task | Owner | Contract | Old A writer | Retained B writer |
| --- | --- | --- | --- | --- | --- |
| Before | T / active | A | 3 | valid | valid |
| C replaces A | T / active | C | 3 | fenced; unknown directory held | unchanged |
| User cancels | T / cancelled | C | 3 | still fenced | fenced/held |
| D reopens | T / active | D | 4 | never revived | history retained; no automatic execution |

Reopening (2B) appends a new round/contract without restoring approvals or tokens.
Review and register current brief/plan when required, then record a fresh
implementation request and claim. Reviewed unchanged document text may be reused;
old artifact IDs cannot automatically authorize new work. Old open assignments
become cancelled until explicitly reassigned. Prior evidence stays readable but
cannot pass current-version acceptance. Delivered/archived work uses linked repair.

Task control writes status, owner and control history/revocations; execution writes
claims/epochs; the workflow writes contracts/planning/authorization. Bindings are
disposable hints. `task-control-v1` does not replace `planning-authorization-v1`.

For tasks that already have control history, legacy work handoff/takeover must use
transferOwner:false. Transfer responsibility with an explicit task takeover request
so it has current provenance and a control event. Even before that boundary, a legacy
owner transfer cannot restore a recipient whose main execution was revoked.

### Resuming replacement work

Control may succeed while execution is blocked. Use public recovery tickets in
`current.recoveries` with `work resume`, not a raw claim or old write token:
`{taskId,recoveryId,contractVersion,request:{userMessage,reference,action:"resume"},
mode,stopBasis,stopReference,snapshotId,baseCommit,abandonUncaptured}`.

| mode | Preconditions and behavior |
| --- | --- |
| `existing` | Same directory and confirmed stop; inspect existing files, no reset/stash; null snapshotId/baseCommit, abandonUncaptured:false |
| `snapshot` | Different clean worktree with matching baseline; source snapshot covers every granted path; supply snapshotId, null baseCommit, abandonUncaptured:false |
| `baseline` | Different clean worktree at exact full HEAD baseCommit; user explicitly chooses abandonUncaptured:true, null snapshotId; same task, no claim to recover old uncaptured changes |

Stop basis is `unknown`, `holder-release`, `host-stop-receipt` or
`user-declared-stop`. Receipt/declaration require a nonempty stopReference;
holder-release requires an already released source. Unknown is allowed only for
isolated modes. Silence and timeout do not prove a stop. Do not select baseline
mode for the user: it can omit valuable uncaptured changes. With no snapshot,
offer confirmed-stop local inspection or an explicitly chosen isolated baseline,
preserving the same task ID. Unknown source directories remain held. Task state
does not terminate host processes or stop arbitrary shell/editor writes.

After pause or cancellation/reopen, a fresh explicitly requested resume may use
`recoveryId:null` plus `from:OccupancyRef`, copied from `control.recoverySources`
in task show or continue. The continue view additionally exposes
`occupiedWrites[].ref`; task show does not. The caller must hold current authority for that work.
This creates a new ticket and operation; an aborted recoveryId or old operation
cannot be revived. If an active ticket exists, use it instead. Plain claim cannot
skip unresolved retained source work, even after fresh authorization.

A source reference identifies the historical occupancy, not whoever currently uses
that directory. If the source was released and reused, an existing ticket (or its
recorded historical source) can still restore an immutable snapshot or use an
explicitly selected baseline in isolation. It cannot resume existing files there,
release the new occupant, or replace its claim. A subsequent takeover preserves the
original source reference. Clearing a hold confirms stopping; it does not cancel
an existing pending/reserved recovery ticket, which must still be resumed. Without
such a ticket, a stopped and released workspace may use ordinary work claim when
current authorization, assignment and other occupancy checks permit it. Other
unresolved source holds can still require an explicit recovery choice.

Failed restoration retains its reservation and partial files. Retry the identical
resume only while current. Pause/cancel/replacement aborts it; reopening and fresh
authorization cannot revive that operation. Restore writes and revocation share
the store lock; a busy response is not evidence of successful stopping.

Task summaries and continuation include recent control history, recovery tickets
and nextActions. Cancelled tasks remain explicitly readable and in task list, but
default orient omits them and continue does not bind to them. The authorized flag
describes recorded authority; planning integrity, file state and tokens still need
checking. Pending and reserved tickets receive different guidance; a fresh recovery
is suggested only for actual unresolved source holds without a current ticket.
Historical recoverySources alone do not require recovery. Source references used
by the hints are available within the same control summary in both task show and
continue. A hold may be cleared by its original holder with holder-release after
stopping, or with actual stop evidence under the documented clear-hold rules.

Missing implementation authority is recorded by the current owner using task
authorize under run/debug, named-entry/named-request, after a real user implementation
request and current planning checks. The continue entry cannot mint this authority;
changing an entry label without that request is not permission. Missing progress
cannot be fabricated from an unavailable agent's chat.

### Explicit store upgrade

New stores use schema 2. Schema 1 remains read-only except for explicitly authorized
`store upgrade`; installation, inspection and ordinary task commands never migrate.
Run `store preview-upgrade --json` from the selected repository/worktree first.
It returns expectedRevision, expectedFingerprint, occupied[].ref, taskProtocol and
canResolveStoppedLegacyWriter. The last flag means eligible for the narrow exception,
not proof that the process has stopped. ready remains false while occupancy exists.

`store upgrade` takes `{expectedRevision,expectedFingerprint,
request:{userMessage,reference,action:"upgrade"},stoppedLegacyWriters?:[]}` under the
control entry rules above (run/continue/debug, named-entry/named-request, not a
read-only invocation). The optional list was added in 3.0.1. Omit it for the existing
no-occupancy path. Each selected item is:

```json
{
  "from": {
    "taskId": "<copy the full occupied[].ref>",
    "assignmentId": null,
    "workspaceId": "<exact workspace ID>",
    "instanceId": "<original writer ID from the reference>",
    "epoch": 1
  },
  "stopBasis": "user-declared-stop",
  "stopReference": "<retrievable user stop declaration or actual host receipt>",
  "userMessage": "<actual user instruction identifying this stopped writer>"
}
```

Copy the complete reference and its actual epoch/assignment; the example values
are placeholders. The top-level actor is the new caller's own identity, never the
old writer's identity. stopBasis accepts user-declared-stop or host-stop-receipt;
both require nonempty userMessage and stopReference. The upgrade request authorizes
the selected releases as well as the format change. These records are caller-supplied
provenance, not host authentication, and the command does not stop processes.
Old timestamps, a clean Git directory or silence are not stopping evidence.

Only an exact state=writer claim belonging to a task with no workflow execution
protocol is eligible. Normal protocol writers, unknown-writer-hold and restore-target
reservations must be resolved separately using their supported stop/recovery paths.
Any unselected occupancy still blocks the entire upgrade. There is no force flag,
blanket release or automatic cleanup. In particular, do not convert writer to hold
by hand, impersonate its owner, delete state, downgrade the CLI or use init as repair.

The upgrade locks the store, revalidates the whole source fingerprint/revision and
every selected occupancy generation, then preserves the exact original state bytes
under backups/. Only selected legacy writers become released and their execution
epochs advance. All releases and schema 2 publication occur in one state transaction;
no workspace files are edited and no task is automatically cancelled or delivered.
A changed source or reference, duplicate selection or any ineligible claim fails
before publication. A rejected selection never partially releases the others.

The returned receipt path points to immutable artifacts/<operationId>/upgrade.json:
it records caller identity, upgrade request, each stop instruction/reference, source
and result revisions, backup path and fenced epochs. Its content hash is admitted
in the state operation receipt atomically with the upgrade. Backup/audit files left
by a failed publication are prepared artifacts, not proof of committed migration.
Retry the identical operation only after inspection; deterministic artifacts make
that retry safe. Missing/changed admitted audit content is UPGRADE_RECEIPT_INVALID,
not permission to reapply releases. Historical 3.0.0 receipts without an audit file
remain replayable. There is no automatic rollback/downgrade; never overwrite later
work with an older backup.

Only active tasks receive initial control metadata. Task IDs, owners, contracts,
historical delivered/archived records, evidence and snapshots stay intact; no
workflow protocol or execution authorization is fabricated. The result explicitly
lists retainedLegacyTaskIds. These old active tasks remain non-executable, so doctor
may still report TASK_PROTOCOL_REQUIRED after a successful format upgrade. New
schema-2 tasks can be created and executed normally. Keep old tasks read-only, or
use task cancel only after a separate explicit cancellation instruction; a format
upgrade is not a cancellation decision or proof of globally passing acceptance.

All linked worktrees share this one store; independent repositories upgrade
separately. Old schema-1 CLIs reject schema 2. Coordinate clients and use the current
supported upgrade CLI explicitly; do not swap a task's pinned CLI to bypass gates.
Old .vinea is not migrated by this operation. Fixture testing never authorizes real
business-repository migration or plugin installation.

## Transfers and Snapshots

`work handoff` payload:
`{from: OccupancyRef, to: Actor, contractVersion, transferOwner: false, ownerEpoch: null, decision: null}`.
Use the current holder's worktree. Active holders hand off themselves; others need the controlled takeover path. Setting `transferOwner:true` also requires the current owner epoch. Transferring another actor or exceeding existing delegation needs an actual Decision.

`work takeover` uses the same fields plus `{stopBasis, stopReference, baselineSnapshotId}` and a required Decision. The caller must be the receiving Actor. Stop basis is `holder-release`, `host-stop-receipt`, `user-declared-stop`, or `unknown`. A host receipt must be real; timeout or silence is not a stop receipt. `unknown` requires an already authorized isolated target worktree and a complete baseline snapshot. It retains an `unknown-writer-hold` in the old directory. Do not remove that hold just because the newer executor succeeded.

`work clear-hold` takes `{from: OccupancyRef, stopBasis, stopReference, decision}`. This operation needs actual stop evidence or a user declaration; `unknown` is not allowed. The original holder may declare its own release. It does not change the new executor's epoch.

`snapshot capture` takes `{taskId, paths: ["src"], token: null}`. Supply the current token when capturing your business contribution. The returned ID identifies immutable contents including tracked, new, deleted files and executable bits; it is not a hash-only promise. Capture all inputs needed for verification/recovery, including tests and relevant nonsecret configuration. It deliberately excludes ignored files, sensitive paths and private-key contents. Symlinks, nonregular files and unsafe paths fail. Defaults: 2,000 files, 8 MiB per file, 64 MiB total; optional `limits:{maxFiles,maxFileBytes,maxTotalBytes}` may only lower these caps.

`snapshot restore` takes `{taskId, snapshotId, token: WriteToken, expectedTargetBase}` and only runs under a current `restore-target` reservation created by takeover. It cannot overwrite arbitrary local changes. Missing blobs, baseline mismatch or conflicts are reported without substituting current content. All restore file writes and reservation publication share the store lock with suspension and contract revision. A suspension is effective only after its successful response; a busy/timeout response is not a stop receipt. A slow restore may make a concurrent command return `STORE_LOCKED`; never steal the lock or claim revocation succeeded.

A failed partial restore retains its reservation and original contract. Retry the
identical takeover only while that reservation and authorization remain valid.
Contract revision refuses `RESTORE_IN_PROGRESS` until recovery completes or the
owner explicitly suspends it. Suspension aborts the old reservation: retries
return `RECOVERY_ABORTED`, even after fresh authorization. Inspect partial files,
holds and actual process-stop evidence before deciding how to recover; do not
reset unrelated target files or silently clear a hold. Individual writes are not
rolled back on failure, and a process crash can still require lock-owner recovery.

## Evidence and Delivery

`verify` takes `{taskId, contractVersion, snapshotId, argv: ["executable", "argument"], phase: null, timeoutMs: 30000, environment: Environment, commandAuthorization: Decision}`. The command runs without a shell in this worktree. This is not a sandbox: tests can mutate files or call services, so review and authorize their effects first. Timeouts, signals or changed inputs result in `unverified`. Raw stdout/stderr are not stored because they can contain secrets; the artifact contains actual process status and byte counts. Relevant external logs remain separately identified evidence.

`evidence report` takes `{taskId, contractVersion, snapshotId, result: "pass", phase: null, argv: null, exitCode: null, summary, environment: Environment}`. Source is always `agent-report`, never tool provenance. Result is `pass`, `fail` or `unverified`. For TDD use `phase:"red"` with a genuine failing command and nonzero exit, then a later `phase:"green"` with exit zero. Do not relabel a clean baseline as feature GREEN.

`evidence observe` takes `{taskId, contractVersion, snapshotId, decision: Decision, environment: Environment}`. It preserves the user's observation as `user-observation` and conservatively `unverified`; it does not convert a comment into a test pass. A check must either verify the observation or record an explicitly accepted gap.

`contribution submit` takes `{taskId, contribution:{kind:"analysis", assignmentId:null, contractVersion, snapshotId:null, evidenceIds:[], summary, writeToken:null}}`. For `kind:"change"`, a current snapshot and matching write token are required. `contribution integrate` takes `{taskId, contributionId, contractVersion, ownerEpoch, snapshotId, rationale}`; the owner integrates and reviews business changes using normal tools, then records the resulting snapshot. Vinea does not merge files automatically.

`check record` takes `{taskId, contractVersion, snapshotId, independent:false, rows:[{acceptanceId:"A1", result:"pass", evidenceIds:["evidence-id"], summary, gapDecision:null}], verification:[{evidenceId:"evidence-id", argv, environment:Environment}]}`. Row results: `pass`, `fail`, `unverified`, `accepted-gap`. Passing rows need passing evidence matching the current contract, snapshot and exact declared command/environment. Accepted gaps require a real `gapDecision` and remain distinguishable from pass. An independent check uses the explicit `check` entry and that assessor's own evidence; another agent is optional.

`finish` takes `{taskId, contractVersion, ownerEpoch, snapshotId, checkSetIds:[], contributionIds:[], exclusions:[], verification:[]}`. Copy selected check IDs and current verification requirements, not empty arrays by default. All acceptance criteria must be covered; selected contributions must be integrated. Unselected current failed/unverified checks need a reason containing their check ID in `exclusions`. Delivery can be uncommitted. The finish entry does not itself grant repairs, commits or deployment.

`delivery accept` takes `{taskId, deliveryId, decision:Decision}` only after actual user acceptance. `archive` takes `{taskId, decision:Decision}` and is an optional owner action after delivery, with no still-active writer/restoration for that task.

## Debug and Legacy

`debug record` takes `{taskId, kind, text, evidenceIds:[]}`. Kind: `fact`, `hypothesis`, `ruled-out`, `change`, `validation-gap`. Store necessary conclusions and references, never hidden reasoning or a raw transcript.

`debug open` takes `{taskId, deliveryId:null, title, expected, actual, decision:Decision}`. It adds a diagnostic to active work; for delivered/archived work it creates a related repair with fresh evidence and no delegation/commit/deploy authority. Analysis-only repair has no business-write grant. If multiple original deliveries exist, select one explicitly. Existing delivery records stay frozen.

`legacy inspect --source <exact-legacy-directory> --json` reads old schema 1/2 without repair. `legacy import` takes `{sourceRoot, expectedFingerprint, decision:Decision}` after preview and explicit approval. It creates zero-grant historical references, not current verification or execution authority. Keep the original directory: historical raw artifacts are not copied into the new evidence store. Unknown schema, malformed data, pending migration or symlinks block import. No automatic real-data migration occurs on install or read.

## Read-Only Queries and Recovery Limits

Use `task list`, `task show --task <id>`, `orient`, `doctor`, and `validate`, all with `--json`. Use `snapshot show --id <id>` for a complete manifest with verified blobs. `evidence show`, `check show`, `contribution show`, `delivery show` require `--task <id> --id <id>`. These commands never initialize storage or acquire work. `validate` exits nonzero for missing, invalid, incomplete, locked, conflicted or blocked state; it validates kernel state, not the user's business tests. Active pre-protocol tasks produce `TASK_PROTOCOL_REQUIRED` and are not ready; historical delivered/archived tasks alone do not block readiness. Legacy active directories alongside the shared store produce `LEGACY_ACTIVE_STATE_PRESENT`; inspect all `issues` even when corruption makes the overall status `invalid`. Do not treat old status as current ownership or delete/migrate either source.

`task list` and `orient` return up to 20 short summaries, not full histories. Use `--limit 1..100` and the returned `nextAfter` as `--after` for another page. `task show` and `continue` return the latest 20 evidence IDs by recorded sequence; use targeted reads for a selected record.

State lives at `<Git common directory>/vinea/`: `tasks/state.json` is authoritative; `runtime/bindings` is disposable; `snapshots`, `blobs`, `artifacts` hold referenced content. Linked worktrees share it locally. Clones, machines and Git pushes do not. There is no cross-machine sync, daemon, hook, scheduler or security sandbox.

Short locks are never stolen automatically. After a crash, diagnose the exact lock owner and obtain stop confirmation before manual recovery. Do not delete authoritative state or use `init` as repair. A local user/process with filesystem access can bypass the protocol; epoch checks coordinate cooperating agents, not arbitrary shell writes. Backups and artifact retention are manual in this version.
