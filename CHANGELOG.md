# Changelog

Vinea follows Semantic Versioning. The root `package.json` is authoritative;
host manifests and marketplaces are generated from it by the release checks.

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
