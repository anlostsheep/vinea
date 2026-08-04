# Vinea 0.2.0 Plugin Release Plan

1. Add failing release-contract tests for icon source/output, Codex interface icon paths, synchronized versioning, and host refresh commands; also correct the stale doctor JSON expected value.
2. Add the Vine Loop SVG source and a deterministic PNG generation/copy path in the public package build, then implement manifest and package validation changes until the focused tests pass.
3. Update the Codex and Claude Code refresh scripts to use each host's supported marketplace/update path, retaining first-install fallback only where required.
4. Bump the root source version to 0.2.0 and verify generated public manifests and marketplace metadata match it.
5. Run the full project checks, public-plugin validation, actual host refresh commands, and post-refresh host/asset inspection. Record all outcomes before finishing.
