# Execution Boundary Review Repair

Date: 2026-09-20. Status: independently reported findings reproduced and repaired;
local kernel, process-level CLI and package checks passed. No new live-agent
review, installation or publication was performed.

## Scope and Evidence

The user authorized reproduction and treatment after Grok's read-only review.
See the [repair brief and plan](../plans/2026-09-20-execution-boundaries/review-repair.md).
Repair task `e9beac4e-13b6-4098-8c2b-559fed2d94be` is linked to original delivery
`512b8143-0c07-4d50-a088-ef511a9b066f`; the original task/evidence were not rewritten.

The valid pre-repair RED snapshot is `3acd5bf2-abc1-4577-b72e-51f12d493687` and
command-runner evidence is `c6218d75-c59e-4892-abea-38b1bb7fdc28` (exit 1).
Nine regressions failed at their intended assertions before source repair.
An earlier run contained four fixture-setup failures from an extra `ownerEpoch`
field; it was explicitly marked insufficient and superseded by this corrected
RED run, without editing implementation in between.

## Disposition

| Finding | Reproduction | Repair and verification |
|---|---|---|
| Restore versus suspension/revision | With restore paused at file replacement, either change became effective and two later replacements still occurred. A partial reservation could also be stranded by contract revision. | Restore validation, writes and publication now share the store lock. Pending partial recovery rejects contract revision until completed or explicitly suspended. Both in-process and separate CLI-process suspension/revision tests pass. |
| Cached token bypassed planning integrity | Damaged plan bytes still allowed token-bearing capture, change contribution and finish, including finish after writer release. | Token validation is asynchronous and re-reads artifact hashes. All callers await it; delivery validates documents even without an active local writer. Snapshot/contribution operation replays are also tested. |
| Revoked authorization returned success | The original operation ID returned an authorization whose revoked field was non-null. | Replay checks current owner, contract, authorization identity and artifact integrity. Revoked/superseded records return an error, even if another authorization is now valid. |
| Pre-protocol active task was ready | Store inspection returned ready with a protocol issue. | Inspection reports blocked, and the public validation command exits 1. State contents remain unchanged. |
| Documentation overstatement | Repair-only debug classification was not enforced; hash binding is via artifact records; partial recovery retry was stated unconditionally. | Documentation distinguishes checked fields from user-intent interpretation, explains the indirect hash binding and full token coverage, and conditions recovery retry on live authority/reservation. No new semantic intent classifier was introduced. |

## Validation

- Focused repair regressions: 14 passing cases, including two separate-process
  concurrent mutation cases and explicit partial-recovery abortion.
- Public CLI suite: eight passing cases, including blocked pre-protocol exit.
- Full check: 33 test files, 136 tests passed; typecheck, local packaging and
  public-plugin validation passed.
- All nine skills passed validation. `git diff --check` passed.
- Installed cached CLI still matches HEAD's original 1.0.1 binary.
- The original task hash remained
  `f5b085e7e3515ab7f607f5cb8effd6e04045e4b39588c7eec308421eed96d732`.

Commands:

```sh
NODE_OPTIONS=--disable-warning=UNDICI-EHPA npm test -- tests/kernel/review-repair.test.ts tests/cli/kernel.test.ts
NODE_OPTIONS=--disable-warning=UNDICI-EHPA npm run check
git diff --check
```

The warning filter is local to these processes and only suppresses the existing
Node experimental proxy warning that pollutes stderr assertions. No test
assertions or global runtime settings were weakened for it.

## Remaining Boundaries

Revocation is effective when the suspension command succeeds, not merely when
requested. Long restoration can cause `STORE_LOCKED`; no lock is stolen and no
successful stop is claimed in that case. Individual file operations are not a
filesystem transaction: a crash or write failure may leave partial contents and
a reservation/lock requiring inspection. An explicitly aborted reservation is
not revived by new authorization; partial files and holds need an actual recovery
decision. This does not stop arbitrary external writers or authenticate agent-
supplied user provenance. Those host-level concerns remain out of scope.

The changes remain uncommitted and unreleased. No existing task was migrated,
no installed plugin was replaced, and the AI portal repositories were untouched.
