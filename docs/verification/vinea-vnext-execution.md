# Vinea vNext Execution Evidence

Date: 2026-09-08. Branch: `codex/vinea-vnext-kernel`.

The user authorized implementation. Work is on a new branch in the current checkout; no additional worktree, commit, plugin installation, or real legacy-data migration was performed. Existing `.vinea` changes are preserved. All state-writing tests use temporary fixture repositories.

## Baseline

- Existing typecheck and build passed.
- Raw legacy core/CLI suite: 156 passed, 25 failed; failures included the Node environment-proxy warning in stderr.
- The warning was traced to Node `setupHttpProxy`. Running the same suite with per-process `NODE_USE_ENV_PROXY=0` disabled unused proxy initialization, not warnings: 181/181 passed in 26 files. Global environment was not changed.

## Implemented Scope

| Plan tasks | Implemented and locally exercised |
|---|---|
| 1-2 | Shared Git common-directory discovery, exact state schema, atomic mutation and operation receipts, real two-process contention, no automatic lock stealing |
| 3-4 | Explicit activation, entry ceilings, versioned contracts, separate owner/writer roles, stable echoed Actor identity, disposable bindings |
| 5-6 | Real content snapshots, literal selected paths, global epochs, public occupancy references, unknown-writer holds, isolated restoration and interrupted-restore retry |
| 7-9 | Optional real verifier with at-most-once reservation, provenance, command/environment matching, contributions/integration, acceptance and delivery, related debug repairs |
| 10-11 | Read-only old schema 1/2 inspection and zero-grant import, structured public CLI, targeted reads, bounded task listing, old engine retirement |
| 12-13 | Nine source/package skills, shared on-demand CLI reference, preserved installation/release tests, CLI-only cross-process handoff and delivery/repair workflows |
| 14 | Bilingual docs, manual acceptance procedure and explicit unexecuted-host matrix; real host/LLM acceptance remains pending |

## Verification History

- Initial new-module RED results were missing API/modules, not successful execution of every assertion. Incremental core/legacy GREEN reached 22 tests; public CLI and hardening expanded this to 37 tests.
- Real assertion REDs then drove fixes for inherited property validation, verifier retry side effects, invalid verifier inputs spawning a command, active-writer handoff bypass, missing snapshot blobs, symlink diagnostics, entry/path escalation, Git wildcard expansion, owner transfer authority, handed-off token refresh, standalone finish token validation, caller identity in errors, evidence ordering, dangling references and list pagination.
- An early full run had 76 passing tests and one package-fixture path failure: macOS's `/var` alias did not match the canonical managed root. The test now passes a repository-relative request path; containment was not weakened.
- The next full `env NODE_USE_ENV_PROXY=0 npm run check` passed 77/77 tests, typecheck, package build and public plugin checks. Additional corruption, compact-view, lock and fault-recovery tests were then added; the final expanded run is recorded below after completion.
- `tests/build-cli.ts` rebuilds before Vitest runs, preventing future CLI tests from accidentally using a stale bundle. Temporary kernel fixtures clean up their own directories after tests.

## Initial Local Result

Final full run started at 18:36 CST on 2026-09-08:

```text
env NODE_USE_ENV_PROXY=0 npm run check
typecheck: passed
Vitest: 27 files, 86 tests passed, no skipped tests
package:plugin: passed
check:plugin: passed
```

The extra skill-creator Python validator could not start because its optional
`PyYAML` dependency is absent. No dependency was installed. The existing Ruby
YAML parser successfully parsed all nine skill frontmatters and checked names,
descriptions and allowed keys; source/package inventory checks also passed.
Neither check is a substitute for real-agent behavioral acceptance.

Read-only `doctor --json` in the actual repository returned `STORE_MISSING`:
the real `.git/vinea` store was not initialized and no legacy fallback was used.
The current branch remains `codex/vinea-vnext-kernel` at baseline HEAD
`049f1720bf1a3fd3d2e0f753d55c166e66633322`, with implementation uncommitted.
The other worktree remains on `codex/vinea-implementation` at
`1be3f9e3e5cc966d6ef52fa979bb8f13bf43a7e0`. The staging area is empty.
The finalized spec's SHA256 is unchanged:
`598ba637dd1cf4fae41d54a87c45915a155ddea3d78d098e5d86582d045f4291`.

These are local protocol and filesystem tests. Fixture host labels are not actual Codex or Claude sessions. Fault injection covers state publication before/after, blob admission, binding writes and partial content restoration; it does not prove power-loss durability or every OS crash point.

## Implementation Boundaries

- Snapshot capture records scope, real contents and executable bits. It includes selected tracked/new/deleted files and excludes ignored/sensitive paths. Callers must select all relevant inputs. Limits are bounded and can only be tightened.
- Verifier artifacts retain process status and output byte counts, not arbitrary stdout/stderr. Relevant external logs can be recorded separately without secrets. Environment labels are reported conditions, not automatic remote-environment measurement.
- Binding loss does not remove claims. Unknown takeover retains the old workspace hold; a newer epoch alone never frees that directory. Stale submissions and a different task's new claim are refused there.
- The store uses synchronized files and atomic same-directory publication. No database, daemon, hook, cloud service or automatic Git action was added. This is coordination for cooperating agents, not an authentication boundary or a filesystem sandbox.
- Legacy import retains historical source references and zero permissions; it does not copy historical raw artifacts or authorize execution. The source must remain available. No real repository migration was performed.
- Artifacts and operation receipts have no automatic garbage collection or cross-machine sync. Managed files are capped at 64 MiB. Lock recovery requires stop confirmation; incomplete verifier reservations are not automatically rerun.
- Existing installation/channel-conflict/release tests are retained and operate on fixtures. No release command was run in this repository, no new release version was chosen, and no user host installation was changed.

See [safety coverage](vinea-vnext-safety-coverage.md) and [real-host acceptance](vinea-vnext-host-acceptance.md). No claim of lower token usage, stronger model reasoning or production readiness follows from local tests alone.

## Authorized Host Follow-Up

The user subsequently authorized the remaining real-host work. See
[the 2026-09-08 live run](vinea-vnext-host-run-2026-09-08.md) for fresh native
sessions, actual CodexHost delegation, observed failures, correction and
isolated recovery. The earlier "not executed" statements describe the boundary
at initial implementation handoff, not the current acceptance status.

Follow-up guidance clarifies local instance IDs versus host session IDs,
requires an unbound result after failed identity resolution, forbids silent
departure from the requested protocol, and exposes a sanitized `STORAGE_PERMISSION_DENIED`
on initialization. An on-demand host guide documents the verified exact-store
permission setup. A reproducible fixture/measurement harness is development
tooling, not a new plugin runtime, hook or daemon.

At 20:53 CST, `env NODE_USE_ENV_PROXY=0 npm run check` passed **90 tests in 29
files**, typecheck, package build and public plugin checks. Additional tests
cover first-join identity isolation, the permission error, reasoning-event
filtering and bounded termination of the harness's own child process group.

Final follow-up run at 21:33 CST passed **93/93 tests in 29 files**, typecheck,
package build and public plugin checks. The added telemetry-cutoff and cleanup
tests prevent resumed-turn counters from contaminating censored measurements
and preserve targets of temporary auth symlinks. `git diff --check` passed.
The current source and packaged CLI SHA256 match:
`f60f7d7dee576ff85651c7f440b1c0ea1f745c1135adff8eb8ef3bd22fa9bf4e`.
This updated package is distinct from the frozen benchmark package. The spec
hash, main HEAD and other worktree HEAD remain unchanged; staging is empty.
