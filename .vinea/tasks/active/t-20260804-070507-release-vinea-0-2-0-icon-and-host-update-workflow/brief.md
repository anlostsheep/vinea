# Vinea 0.2.0 Plugin Release Brief

## Objective

Release the already-approved `checking -> rework -> in_progress` capability as Vinea 0.2.0, with a distinctive `Vine Loop` visual identity and reproducible Codex / Claude Code host update paths.

## Approved decisions

- Use the selected **Vine Loop** mark: a dark rounded-square field, mint/teal closed vine loop, and white `V` core. It conveys a shared, recoverable task loop and remains recognisable at small sizes.
- Treat the release as a **minor** version bump from 0.1.0 to 0.2.0 because the already-implemented rework lifecycle and schema-v2 support are backward-compatible capabilities that were not released under a new public version.
- Store an editable SVG master in the repository and package a transparent PNG icon for host manifests.
- Give the Codex manifest `composerIcon`, `logo`, and `logoDark` references to the packaged icon. Do not add unverified Claude-specific manifest fields.
- Make `package.json` the release-version source of truth. Any distributed plugin-content change must carry a semantic version bump: patch for a compatible fix or visual/doc correction, minor for a compatible capability, major for a break.
- Refresh Codex through its marketplace/plugin command path and its required cache-buster; refresh Claude Code through marketplace update plus `claude plugin update`, with install only as a first-install fallback. Do not copy a build into a host runtime cache.
- Repair the existing `doctor --json` assertion so it expects the schema-v2 `migration` and `rework` fields already returned by production code.

## Scope

1. Add the icon source asset, generate/package the manifest-consumable PNG, and validate asset references.
2. Bump and verify the public version at every source/package/manifest boundary.
3. Update the Codex and Claude installer/refresh scripts to exercise official host update flows.
4. Extend plugin-package and installer tests before implementation, then fix the known doctor JSON test expectation.
5. Validate the built public plugin, host manifests, and both local host registrations without exposing credentials.

## Non-goals

- Changing the rework lifecycle implementation or adding new host capabilities beyond the approved release/update behavior.
- Manual runtime-cache synchronization, browser-based GitHub authentication, or a remote marketplace publication.
- Adding unverified manifest fields to Claude Code.

## Completion evidence

- Focused red/green tests for the packaging, version, and update-script contracts.
- `npm run check`, plugin validation, package inspection, and live `codex plugin list` / `claude plugin list` checks after refresh.
