# vNext Safety Coverage Migration

The retired stage engine was first run unchanged: 181 legacy core/CLI tests
passed with local Node proxy initialization disabled. Its baseline is commit
`049f1720bf1a3fd3d2e0f753d55c166e66633322`. The new kernel is not intended to
preserve planning/ready/checking stages or their CLI syntax.

Only unchanged tracked legacy source/tests were deleted. Production now uses
`application -> kernel` and `legacy/read` for historical input; there is no old
writer fallback. No real `.vinea` records were deleted or imported by this work.

| Previous safety property | Replacement evidence |
|---|---|
| Git/workspace discovery and no accidental initialization | `tests/kernel/repository.test.ts`, public package initialization test |
| Version/shape rejection, unsafe identifiers and dangling references | `tests/kernel/schema.test.ts`, `hardening.test.ts`, `diagnostics.test.ts`, exact public payload rejection in `tests/cli/kernel.test.ts` |
| Path containment, symlinks, sensitive content | `tests/kernel/store.test.ts`, `snapshots.test.ts`, legacy read diagnostics |
| Explicit activation and entry authority | `tests/kernel/contracts.test.ts`, `permission-matrix.test.ts`, `auth-boundaries.test.ts` |
| No-persist before state and artifact side effects | `tests/kernel/store.test.ts`, `permission-matrix.test.ts`, `evidence.test.ts` |
| Atomic publication, failed mutation and retry identity | `tests/kernel/store.test.ts`, `store-process.test.ts` |
| Real process contention | `tests/kernel/store-process.test.ts` uses two Node processes, not two in-memory calls |
| Stable identity and binding loss | `tests/kernel/ownership.test.ts`, `tests/cli/kernel.test.ts` with separate processes |
| Compact current context | `tests/kernel/compact-view.test.ts` checks evidence ordering and bounded cursor pagination |
| Exclusive worktree writes and late results | `tests/kernel/continuation.test.ts`, `permission-matrix.test.ts`, public CLI takeover |
| Interrupted artifact recovery | `tests/kernel/recovery.test.ts` injects failure after one file is restored, retries the same reservation |
| Snapshot additions/deletions and no replacement of missing contents | `tests/kernel/snapshots.test.ts`, `diagnostics.test.ts`, public CLI recovery |
| Evidence provenance, revisions and conditions | `tests/kernel/acceptance.test.ts`, `delivery.test.ts`, public source-spoof rejection |
| Verification at most once, timeout and changed inputs | `tests/kernel/hardening.test.ts`, `verification-boundaries.test.ts` |
| TDD history and honest completion | `tests/kernel/verification-boundaries.test.ts`, `acceptance.test.ts` |
| Immutable delivered facts and repair history | `tests/kernel/hardening.test.ts`, `debug.test.ts`, public CLI delivery/repair |
| Read-only legacy recovery, no authorization by import | `tests/legacy/import.test.ts`, `read.test.ts` |
| Host parity, channel conflicts, safe release scope | Existing `tests/plugin/install-*.test.ts`, `release.test.ts` retained; `package.test.ts` updated for the new CLI |

Retired requirements: obligatory stage transitions; strict eight-skill inventory;
global business-dirty finish prohibition; learning promotion gates; in-place old
schema repair; automatic recovery from legacy reads. Tests for these behaviors
were removed instead of weakening assertions or retaining inaccessible writers.

Static skill inventory/parity tests prove packaging, not agent reasoning or
behavior under pressure. Real Codex/Claude acceptance and comparative token
measurements remain separate in `vinea-vnext-host-acceptance.md`.
