# Vinea 0.2.0 Plugin Release Design

**Date:** 2026-08-04

**Status:** approved design; implementation pending user review

**Scope:** public plugin branding, versioned package contract, local Codex/Claude Code refresh workflow, and one stale test assertion

## Outcome

Ship the existing schema-v2 verification/rework capability as **Vinea 0.2.0**, accompanied by a visual identity that represents Vinea's core promise: a shared task can enter verification, expose a defect, return safely to implementation, and arrive at fresh evidence without losing history.

The release must update both local host installations using their plugin-manager workflows rather than copying files into a runtime cache. A future distributed-plugin content change must have a corresponding semantic-version increment.

## Visual direction: Vine Loop

The approved icon is a compact **Vine Loop**:

- a near-black, softly rounded square background that works on the existing dark plugin catalog;
- a mint/teal continuous loop, representing recoverable progress and retained history;
- a small white `V` at the center, preserving immediate product recognition at 24–48 px;
- a restrained palette so it reads as an engineering-tool mark rather than an illustration.

The repository will retain an editable SVG master at `assets/vinea-loop.svg`. Packaging will place a transparent PNG rendition in the public plugin tree, for example `plugins/vinea/assets/vinea-loop.png`. The Codex template will reference the packaged relative path for `composerIcon`, `logo`, and `logoDark`.

The release intentionally does not add image fields to the Claude Code manifest: their acceptance has not been verified, so the shared asset remains available in the package while Claude's manifest stays within its known schema.

## Version and package contract

`package.json` remains the authoritative release version. The packaging script must inject exactly that version into:

- the Codex plugin manifest;
- the Claude Code plugin manifest;
- both generated marketplace records;
- the built public plugin tree.

This change is **0.1.0 → 0.2.0**. It is a minor release because it makes already-developed, backward-compatible functionality publicly available under a proper release version.

For every future modification that reaches the distributed plugin, the release owner must bump the root semantic version in the same change:

| Change type | Required bump |
| --- | --- |
| Compatible visual, documentation, packaging, or bug fix | patch |
| Compatible workflow or capability | minor |
| Incompatible public contract or migration boundary | major |

Local experimentation that does not become a distributed artifact does not require a release bump. Validation will make the single-source version and all generated manifests testable; it cannot infer whether an arbitrary Git diff was intentionally unreleased, so the release rule remains an explicit repository policy.

## Host refresh contract

### Codex

The refresh script will build the public plugin, replace only the declared local marketplace source, run the plugin cache-buster expected by the local Codex plugin tooling, then invoke Codex's marketplace/plugin registration command. It must not write to or synchronize a runtime plugin cache by hand. Verification will query `codex plugin list` and inspect the installed package manifest/version and asset path.

### Claude Code

The refresh script will build the public plugin, replace the declared local marketplace source, validate the plugin, refresh the local marketplace, and invoke `claude plugin update vinea@vinea-local --scope user`. If the plugin is not installed yet, it may fall back to the supported install command. Verification will query `claude plugin list` and inspect the installed package manifest/version and asset path. A new Claude Code session is expected before its loaded skill set reflects the update.

## Existing test regression

The rework-lifecycle release added `migration` and `rework` information to `doctor --json`. The production behavior is correct, but `tests/core/schema.test.ts` still asserts the older object shape, causing one baseline failure. The release includes the narrow assertion update; it does not change the doctor output or lifecycle behavior.

## Test-first implementation and verification

1. Extend focused plugin package/install-script tests to make the proposed asset, manifest, version, and host-refresh contracts fail before production changes.
2. Update the stale doctor JSON assertion as a baseline contract repair, then confirm the focused test is green.
3. Add the asset and packaging/manifest/update-script implementation in small increments, rerunning focused tests after each increment.
4. Run `npm run typecheck`, `npm test`, `npm run build`, `npm run package:plugin`, `npm run check:plugin`, and `npm run check`.
5. Validate the packaged plugin with the local plugin validator, execute both supported local refresh flows, then verify actual versions and packaged icon paths through the two host CLIs and their installation trees.

## Boundaries

- No new workflow behavior, data migration, remote publication, GitHub authentication, or browser interaction belongs in this release.
- No unverified Claude manifest extensions.
- No manual copying into a Codex or Claude runtime cache.
- Changes remain restricted to assets, manifests, package/validation/install scripts, relevant tests, generated public artifacts, release documentation, and Vinea task records.
