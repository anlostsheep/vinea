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
