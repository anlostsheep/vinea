# Planning and Execution Boundary Verification

Date: 2026-09-20. Status: local kernel/CLI implementation verified; not published
or installed, and not a live model-behavior acceptance run.

## Scope

Implementation follows [brief](../plans/2026-09-20-execution-boundaries/brief.md)
and [plan](../plans/2026-09-20-execution-boundaries/plan.md). Existing `.vinea`
bookkeeping changes were preserved. No existing user task was migrated. The
implementation task itself uses the already selected installed 1.0.1 coordinator;
new-protocol mutations occur in disposable test repositories only.

## RED and GREEN

- Before implementation, the four new focused regressions all failed: planning
  could not persist a task; self-declared run could claim immediately; separate
  authorization and suspension commands did not exist. This is observed RED,
  not a reconstructed historical run or an immutable pre-change snapshot.
- The focused kernel suite now passes 16 cases. The public CLI suite passes seven
  cases, including the new plan -> documents -> authorization -> claim -> stop
  regression across separate processes.
- Full check: 32 test files, 121 tests passed; TypeScript check, local package
  generation and public-plugin validation passed.
- All nine skill files passed the skill frontmatter/content validator.
- `git diff --check` passed.

Full-check command:

```sh
NODE_OPTIONS=--disable-warning=UNDICI-EHPA npm run check
```

The first unfiltered full run passed 117 tests and failed four existing plugin
installation tests whose contract expects empty stderr. Those failures contained
only the local Node runtime's experimental `UNDICI-EHPA` warning. Re-running with
that one warning code suppressed passed all 121 tests. No installation-test
assertion, package dependency, installer or global environment setting was changed.

## Verified Boundaries

| Acceptance | Evidence |
|---|---|
| A1: Persistent planning | Brief/plan presence, contract versions, readable immutable files, changed/missing/symlinked content, and planning added to a direct task are tested. |
| A2: Separate authorization | Run/grant without authorization, continuation/plan approval, missing provenance, confirmation without action, owner checks, bound follow-up, and revoked approval replay are tested. |
| A3: Protocol pinning | Pre-protocol state remains readable without migration; execution fails closed. Legacy/new active-state coexistence is diagnosed without rewriting either source. |
| A4: Suspension | Local writer release, epoch fencing, explicit reauthorization and retained uncertain remote occupancy are tested. Business files are not reverted by suspension. |
| A5: Public contract | CLI end-to-end regression, shared command documentation coverage, skill validation, package parity and existing recovery/delivery suites passed. |

## Remaining Limits

- Request classification, quoted text and source references remain caller-reported.
  The kernel does not authenticate the user, interpret natural-language intent,
  verify document meaning, or stop an agent from forging provenance.
- Arbitrary host filesystem tools are not intercepted. No Grok/Codex host adapter
  or permission change was made, and no live Grok conversation was replayed.
- Legacy CLIs cannot be controlled by the new kernel. Detection and explicit
  version-pinning guidance do not prevent an unrelated process from using one.
- This is a breaking execution-contract change recorded under Unreleased. The
  package version was not bumped and installed 1.0.1 caches were not replaced.
- Existing tasks need an explicit future compatibility/migration decision before
  executing through the new CLI. No automatic migration path is included.
