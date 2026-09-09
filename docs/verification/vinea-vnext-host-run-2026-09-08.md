# Real Host Acceptance, 2026-09-08

Status: this acceptance round is complete, with qualified passes and an
unresolved Claude classifier limitation. This is a real-host follow-up to the
local 86-test run, not a replacement for it. The user authorized continuing
the remaining host acceptance and token/time comparison.

## Isolation and Evidence

- Default plugin installations, real task state and repository commits are
  not modified. The fixture runner reuses saved authentication without
  generating, displaying or intentionally changing credentials;
  private temporary host configuration is never copied into this repository.
- Codex CLI 0.153.4 uses isolated HOME/CODEX_HOME directories and installed
  test marketplace copies. Claude Code 2.1.219 loads the package for that
  session with `--plugin-dir`; global enabled plugins/hooks/MCP are excluded
  for the native CLI probe, without disabling its permissions.
- Test root: `/private/var/folders/np/blc2r94x5l9548jhvytsnsgm0000gn/T/vinea-host-acceptance-0H4uxe`.
- Original new-kernel bundle SHA256:
  `6911852d64d105b4b1dd286e129fe453d4d421a5b5919c5848f63dbf163fa61e`.
- Old package is extracted from commit
  `049f1720bf1a3fd3d2e0f753d55c166e66633322`, not taken from a changing installed cache.
- The test harness is `scripts/host-acceptance.mjs`. Native CLI events retain
  usage and visible actions; structured reasoning blocks are excluded.
  Only curated observations, not full host transcripts or private config,
  belong in this repository.

## Observed Host Behavior

| Scenario | Actual evidence | Result |
|---|---|---|
| Fresh Codex loads new entries | Session `01a080dc-161a-7bb3-a0c0-c80f7f8762b0` read the isolated installed orient/doctor skills and ran that cache's bundled CLI; nine names discovered | Pass for this session |
| Fresh Claude loads new entries | Session `9dc21f5a-84d2-4ad8-b6c5-ea87ee757af2`; system init lists nine `vinea:` skills and the inline test package; actual Skill call is `vinea:orient` | Pass for this session |
| Read-only orientation | Both sessions returned `STORE_MISSING`; actual fixture Git state stayed clean and `.git/vinea` was absent | Pass |
| Ordinary request with new plugin installed | Codex session `01a080e2-5640-7dc1-9bd6-d4d94436f306` answered an exports question with one command, no task or binding | Pass for this request |
| Brainstorm first round | Claude session `5cf4cdc8-a22d-4db4-8c3f-509830e4a88e` inspected actual code, presented two independent choices and deferred dependent error-reporting choices; no state or business writes | Dependency handling observed; lightweight interaction remains qualified |
| Real Codex owner | CodexHost child created a real goal/claim, implemented string normalization, ran six focused tests, captured real content, then paused without release/delivery | Pass for bounded owner part |
| Real Claude read-only join, initial attempt | Permission classifier rejected local instance allocation; positional fallback returned COMMAND_UNKNOWN. No valid continue response or own binding. Final report borrowed Codex's Actor and misidentified its raw Claim as the caller's write token | **Failed**; no business write occurred |

## Initial Join Failure and Narrow Repair

The failure is not proof of unauthorized kernel token issuance: no successful
Claude `continue` request reached that point. It is a real agent/reporting
failure after a host-permission misunderstanding. A follow-up factual report
confirmed the failed command attempts and that the agent was unbound.

The distinction is now explicit in `continue` and the CLI reference:
first-time `newInstance:true` allocates a local execution identifier without
writing task state; it does not invent a host session identifier. Unknown
`hostSessionId` stays omitted. If permissions still reject resolution, stop
unbound, never borrow another actor or relabel a raw claim as a returned token.

The permission classifier remains enabled. One controller clarification was
required; a corrected retry cannot be reported as an unassisted first-pass
success. The original test package remains frozen; the instruction-only
candidate is `packages/continuation-fix`, with continue skill SHA256
`4067ede25f3bbdcf3d6ee0eda5e168843cfdbee65c4d60b1f8858dc5fbe9764e`.

A focused kernel regression also confirms that first-time read-only identity
allocation changes no stored files, creates no host session assertion, never
borrows the owner, and returns a null write token when subsequently joining.

## Real Delegations

| Role | Harness | Delegation ID | Task ID | Initial turn ID |
|---|---|---|---|---|
| Owner | codex | `1f6334bd-64a7-4e9f-b733-84a2965dbfa3` | `01a080dc-fe52-7c30-a938-238b8503df8d` | `01a080dc-ff13-7dc3-8a9d-cca35161905a` |
| Joining peer | claude-code | `fc96117e-72d1-4e7d-a796-45149b2fd879` | `15584a06-e6cf-4bd9-93b8-61efe9e3bb7a` | `584b6b2f-ac3c-4a57-8b4e-94190a7d8848` |

Owner deep link: `codex://threads/01a080dc-fe52-7c30-a938-238b8503df8d`.
Peer deep link: `codex://threads/15584a06-e6cf-4bd9-93b8-61efe9e3bb7a`.
Peer factual correction turn: `39026e97-dc76-4d10-b5c6-076c30c13de1`.
Peer clarified retry turn: `77c3dbb1-eff7-4952-b156-374fb0b3c332`.

The actual Vinea goal is `70145373-7987-4ed0-9302-7a335d75203a`, initially owned
by local Actor `7d820af4-fdf7-4630-988b-0ea14acc1a24`. Its hostSessionId matches
the real Codex child task ID. Initial snapshot:
`135c3124-55f0-4695-a2f0-988c0e9a2386`; initial focused command evidence:
`377cd0c2-ad69-49f7-85db-26f20dfcfd0e`.

That focused pass covers string handling, not the still-missing array cases.
The initial peer's claim of no obvious gap is not accepted as verification.

## Comparison Method

Native Codex runs compare old Vinea, frozen original vNext and no framework
against the same seeded implementation request and independent hidden
assertions. Configuration is `gpt-6-astra`, `xhigh`, the same Node/Git/CLI,
standard quality, no commit/deploy/dependency installation and a five-minute
per-run wall limit. Source repositories and host homes are separate.

Record raw `turn.completed.usage`, cached input separately, wall time, actual
external acceptance, file preservation, task-state creation and controller
interventions. Missing usage after an interrupted run is unknown, not zero.
No-framework and framework paths may choose different amounts of metadata;
that is an observed workflow difference, not evidence that the business tasks
differ. Small samples, caching, provider variation and concurrent light
acceptance activity limit wall-time comparisons. This is an exploratory
same-machine comparison, not a statistically controlled performance claim.

The four selected trials terminated. See the
[comparison readout](vinea-vnext-benchmark-2026-09-08.md) and its JSON companion.
The new scoped-store run recorded delivery at 275.6 seconds before its model
turn timed out at 300 seconds; those are deliberately separate outcomes. A
later read-only native session continuation recovered the receipt without
re-execution. No general token-efficiency improvement is established.

## Confirmed Continuation and Recovery

- Corrected Claude join: own local Actor
  `f56d3b69-07d3-4690-a8a5-d0d07cf83db2`, no invented host session ID, actual
  `continue.writeToken = null`. A distinct binding in the linked worktree was
  independently observed; the first failed attempt remains a failure.
- Normal handoff turn `01a080f4-b06d-7002-9d87-63ab8bd84ca3`: contract v2,
  Claude owner epoch 2 and writer epoch 3 in the main worktree. The prior v1
  evidence remained history, not current proof.
- Claude implementation turn `9402f494-6da5-4c6d-bc1e-8316fb77cb36` stopped
  after its auto classifier reported that `claude-sonnet-5[1m]` was temporarily
  unavailable. No source edits, verification or delivery occurred. No bypass
  or raw-state substitute was accepted.
- Separately authorized isolated recovery turn
  `01a0810c-e51c-7743-9c0a-f0133ad596f3` used `stopBasis:unknown` in relay-peer.
  It restored three matching content hashes, retained the old source hold,
  revised only temporary role constraints, implemented the remaining cases,
  and ran 15 passing tests plus the real Vinea verifier.
- Final contract v3, owner epoch 3, refreshed target token epoch 5; snapshot
  `ea0c42cf-3291-461e-80d7-ff1da4e78478`, evidence
  `46827793-ca2f-4eb8-bff4-25734068bc1b`, checks
  `44db38a7-cc4a-4e5e-b6de-bdb07affda98`, integrated contribution
  `ba00612b-f111-40d0-a87a-45d1600d428a`, delivery
  `4df79d7b-ca4c-4399-9ac5-eceab6ca89eb`. No accepted gaps or user acceptance.
- The main worktree's source/test hashes still matched the original snapshot;
  its Claude-associated unknown-writer-hold remained at epoch 3. `validate`
  reported ready. Claude is not credited with this implementation.

## Additional Native Behavior

- Claude's plan-only session `5cf4cdc8-a22d-4db4-8c3f-509830e4a88e` remained
  read-only after the follow-up "方案可以". It explicitly distinguished plan
  agreement from execution authorization.
- Its brainstorming follow-up did defer error-output decisions until the
  invalid-item strategy was chosen, but introduced optional naming questions
  and verbose exposition. Lightweight interaction quality is qualified, not
  declared solved by the skill text.
- Independent Claude check session `131d6e8a-7506-420f-9a34-eaf120989e44`
  ran inline assertions, reported nine failing checks, and changed no code,
  test files or Vinea state. It did not repair merely because a check failed.
- Ordinary implementation session `dc8bf345-8fb7-4603-a8e6-4c7edf297fcc`
  had the new plugin available but no Vinea request. It repaired a duration
  formatter, passed the independent code grader, and created no Vinea state.
  This is an activation probe on a different model/task, not a comparison row.

## Permission Diagnosis

The default native Codex workspace policy denied `mkdir .git/vinea` with
`EPERM`. An explicit profile keeping the Git common directory read-only and
only its `vinea` child writable passed an actual sandbox probe; writes to an
unrelated Git file and opening `.git/config` for writing remained denied.
The host guide preserves that explicit parent read rule and does not install
the profile or widen global permissions automatically.

The updated CLI was also exercised under the real denied sandbox, not only a
mock: it returned `STORAGE_PERMISSION_DENIED`, the exact store root and `EPERM`
without leaking a raw filesystem error. Source/model behavior after such a
denial remains governed by the clarified run contract, not a new filesystem
sandbox inside Vinea.

## Post-Delivery Debug

After the recovered delivery released its target writer, the controller
injected exactly one fixture-only regression (`toLowerCase` to `toUpperCase`).
The original Task record hash was captured as
`d804effe690ead01367acd63ad7a7de862e73c6f1ce76d3ad7e1df1c302e3c54`.
Controller verification observed seven passes and eight failures.

Diagnosis-only turn `01a08118-5d62-74b3-b5ad-0200223824dc` created related task
`19fcc2dd-65f6-4d07-8a45-c77c86c411c1`, with all grants false, no allowed paths
and no write token. It compared SHA-verified delivery contents, reproduced
uppercase output, and recorded failure evidence
`ba99a9b6-8a52-4c67-b9cb-2c38babd7ff2` plus comparison report
`d66158ed-6575-41df-99f0-8dba71ae82d0` against diagnostic snapshot
`56bf492c-8a20-4ecc-bd5c-000fc34903b6`. The injected defect remained unchanged
and the original Task hash still matched. It did not assume permission to fix.

Explicit repair turn `01a08120-8041-72a3-967d-ace9004b2bca` completed. The related
task's v1 zero grant remains in history; v2 authorizes only `src/tests` business
writes, with delegation/commit/deploy false. It restored lowercase conversion
and added the exact mixed-case regression test.

- Repair snapshot: `b83849a6-1b3f-429c-a6a7-05c0c2fbe04f`.
- Current passing evidence: `50ef78d6-f5ac-4bb6-8ed2-17719b3ade60`.
- Check set: `83760245-4df1-4f78-9b0a-4657393b3aa4`.
- Repair delivery: `0288c453-10f8-4c00-b357-0b78bc150a04`, no accepted gaps.
- Controller independently reran 16 tests successfully and verified the
  original Task hash, retained v1 failed evidence, current v2 pass, repaired
  source hash matching the original delivered code, and retained source hold.
- Kernel `validate` returned ready. Both real CodexHost children ended their
  turns; no original source-hold clearing, archive, user acceptance or commit.

## Reproduction and Limits

The development harness supports `prepare`, `run`, `prepare-scoped`, `telemetry`,
`report` and `cleanup-host-homes`. It creates fixture-only Git commits, refuses
to overwrite an existing fixture, isolates Codex installations, and reuses
saved authentication without printing it. It does not install into the default
host. `report` writes inside the fixture by default; an explicit output path is
required to replace a reviewed repository artifact.

```sh
env NODE_USE_ENV_PROXY=0 npm run check
env NODE_USE_ENV_PROXY=0 node scripts/host-acceptance.mjs prepare
# Use the returned ROOT, not a guessed path.
env NODE_USE_ENV_PROXY=0 node scripts/host-acceptance.mjs run ROOT control-tags codex
env NODE_USE_ENV_PROXY=0 node scripts/host-acceptance.mjs run ROOT old-tags codex
env NODE_USE_ENV_PROXY=0 node scripts/host-acceptance.mjs run ROOT new-tags codex
env NODE_USE_ENV_PROXY=0 node scripts/host-acceptance.mjs prepare-scoped ROOT
env NODE_USE_ENV_PROXY=0 node scripts/host-acceptance.mjs run ROOT new-scoped-tags codex
env NODE_USE_ENV_PROXY=0 node scripts/host-acceptance.mjs report ROOT
# Only after all native child processes have ended and telemetry is exported:
env NODE_USE_ENV_PROXY=0 node scripts/host-acceptance.mjs cleanup-host-homes ROOT
```

The ordinary duration implementation was an activation probe, not a second
comparative workload. Multi-task repeated trials were not run. Remaining
release evidence includes a fresh unassisted identity join after the guidance
change, successful Claude implementation after classifier recovery, and a
controlled multi-sample effectiveness study. Do not turn the reported failures
or controller interventions into green checks.

After all native CLI runs ended and censored telemetry was exported, the four
isolated Codex host homes were removed, including temporary auth links/configs
and private session caches. The failed initial preparation's temporary host
home was also removed. Fixture repositories, immutable Vinea artifacts,
filtered visible events and reviewed numerical telemetry were retained.
The default installed Codex Vinea cache was read back and still contained the
old eight-skill inventory; it was not replaced by these test installations.

Final local regression: 93/93 tests, typecheck, packaging and public-plugin
checks passed. The updated source/package CLI hash is
`f60f7d7dee576ff85651c7f440b1c0ea1f745c1135adff8eb8ef3bd22fa9bf4e`;
benchmark figures refer to the earlier frozen package, not this correction.
No implementation commit, push, default plugin replacement or real-data
migration was performed. The actual repository still reports STORE_MISSING
for the new local state root; the fixture states are separate.
