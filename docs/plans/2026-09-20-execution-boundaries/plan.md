# Implementation Plan

1. Add focused failing tests for explicit planning, execution authorization,
   protocol compatibility and suspension. Keep RED evidence separate from GREEN.
2. Add a protocol-pinned task workflow, immutable Markdown artifacts and separate
   authorization records. Preserve old schema reads without auto-migration.
3. Apply effective-authorization checks to claims, resumed tokens, delegation,
   handoff and recovery. Add suspension and truthful occupancy diagnostics.
4. Update the shared CLI reference and skills. Keep the selected plugin root
   pinned; a missing command is not permission to use an older installation.
5. Exercise public CLI flows, idempotency, stale artifacts, multiple worktrees,
   ephemeral mode and existing delivery/recovery regression tests.
6. Run typecheck, the complete test suite, local plugin packaging and package
   validation. Record results and remaining host-level validation gaps.

## Design Decisions

- Explicit brainstorm/plan tasks require brief and plan before authorization.
  Direct execution can remain lightweight, but still needs a sourced execution
  request. A contract grant is a ceiling, not effective permission.
- Store artifacts under the shared Git-directory store, not legacy `.vinea`.
  Pin authorization to the contract and selected artifact hashes.
- Require a fresh request after suspension or contract revision. Existing valid
  authorization supports bound continuation without repeated user approvals.
- A stopping owner may revoke the task's authorization. Release only its own
  current local writer; fence other writers into an unknown-writer hold.
- Old binaries cannot be controlled from this kernel. Detect legacy active-state
  coexistence and explain the remaining isolation boundary.

## Verification

Use Vitest fixture repositories only for new-protocol mutations. Run focused
tests before and after implementation, then `npm run check` and
`git diff --check`. Do not equate deterministic CLI tests with a live Grok/Codex
behavioral replay or a host-level write barrier.
