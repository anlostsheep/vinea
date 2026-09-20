# Changelog

Vinea follows Semantic Versioning. The root `package.json` is authoritative;
host manifests and marketplaces are generated from it by the release checks.

## [Unreleased]

## [2.0.0] - 2026-09-20

### Changed

- Breaking execution protocol: new tasks pin `planning-authorization-v1`.
  Creating a task or selecting `run` no longer activates business-write grants.
  `task authorize` records a separate, sourced implementation request; ordinary
  continuation and plan approval do not mint execution authority.
- Persistent brainstorm/plan tasks require readable, immutable brief/plan
  artifacts for the current contract through `task document`. Claims, resumed
  tokens and recovery validate artifact integrity. Direct authorized small runs
  need no mandatory planning phase.
- `task suspend` revokes authorization, fences old tokens, releases the owner's
  own local claim and retains uncertain remote writers as holds. Diagnostics
  expose legacy active-state coexistence; skills prohibit silent CLI downgrade.
- Existing tasks are readable without automatic migration, but the new CLI
  does not infer execution authorization for pre-protocol tasks. Caller-supplied
  request provenance is auditable, not host-authenticated or a filesystem gate.
- Serialize snapshot restoration writes and publication against suspension and
  contract revision. Preserve partial-recovery reservations, reject incompatible
  revisions, and report explicitly aborted recovery instead of suggesting retry.
- Revalidate planning file hashes on cached-token contributions, snapshots and
  delivery. Reject revoked authorization replays and report pre-protocol active
  tasks as blocked, including a nonzero validation exit status.

## [1.0.1] - 2026-09-10

### Changed

- Clarify that an explicitly selected Vinea workflow does not authorize adding
  another workflow framework through similar names, stages or copied plan headers.
  Task-specific tools and domain skills remain available within existing authority.
- Mark historical implementation plans as reference-only and remove mandatory
  external workflow sub-skill headers. Add manual coexistence acceptance cases.

## [1.0.0] - 2026-09-09

### Changed

- Breaking kernel rewrite: explicit goal contracts replace the staged
  workflow. Nine logical skills include run and debug; propose is retired.
- Shared local state moves to the Git common directory, with durable claims,
  epoch fencing, disposable bindings and isolated unknown-writer recovery.
- Recoverable content snapshots, bounded contributions, provenance-aware
  evidence and owner delivery support uncommitted business changes.
- Legacy schema 1/2 are read-only sources for explicitly approved zero-grant
  imports. Old stage commands no longer invoke a legacy writer.
- Brainstorming batches independent decisions and follows dependencies only
  when feedback changes them. Planning, standalone checking and diagnosis do
  not implicitly grant business changes. Post-delivery debugging opens a repair.
- Local CLI/package validation is reported separately from real-host acceptance.
- Real-host acceptance now records fresh loading, identity-join failure and
  correction, a blocked Claude classifier, successful isolated recovery and
  post-delivery repair. Single-task measurements do not establish token savings.
- Clarify local actor allocation versus host session identity and fail-closed
  continuation. Initialization permission denial now exposes a sanitized
  diagnostic and exact store path; an optional host guide documents verified
  least-privilege access without automatic global configuration changes.

### Fixed

- Finish rejects active writers or pending restores for the same task in other
  worktrees, without blocking unrelated tasks or retained unknown-writer holds.
- Content snapshots preserve staged deletions and rename-source paths so isolated
  recovery and retries can restore the complete uncommitted result.

## [0.3.1] - 2026-08-25

### Added

- Simplified Chinese root and packaged-plugin READMEs as the default
  documentation, with equivalent English versions in `README.en.md`.
- Bilingual packaging and validation coverage for language links, lifecycle
  commands, and public-artifact path safety.

## [0.3.0] - 2026-08-25

### Added

- Git marketplace installation for both Codex and Claude Code from
  `anlostsheep/vinea`.
- A guarded local release command that supports semantic bump keywords or an
  exact version, runs the full checks, creates a scoped release commit, and
  creates an annotated tag without pushing.
- Single-channel conflict detection for development installers, with explicit
  migration guidance and no automatic uninstall or disable action.
- Public documentation for version pinning, upgrades, rollback, removal,
  development-channel migration, restart, and installed-versus-loaded
  verification.

### Changed

- Both plugin manifests now expose the public repository metadata.
- The Claude marketplace plugin entry omits its duplicate version field so the
  Claude plugin manifest is the single plugin-version source.

## [0.2.0] - 2026-08-04

### Added

- A portable public plugin containing one bundled CLI and eight shared Vinea
  workflow skills for Codex and Claude Code.
- Versioned file-first task state, validation, explicit session recovery, and
  completion and learning gates.
