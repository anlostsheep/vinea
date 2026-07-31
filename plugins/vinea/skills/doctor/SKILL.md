---
name: doctor
description: Use when Vinea initialization, schema, Git availability, or task-state diagnostics prevent safe progress.
---

# Vinea Doctor

Public skill: `vinea:doctor`.

## Bundled CLI contract

Use the public plugin's `bin/vinea.mjs`, never a global binary. Work from the target Git repository. In Codex, derive `<plugin-root>` from the absolute path of this current `SKILL.md` by removing `/skills/<current-skill>/SKILL.md`, then run `node <plugin-root>/bin/vinea.mjs`. In Claude Code, run `node ${CLAUDE_PLUGIN_ROOT}/bin/vinea.mjs`.

## Diagnose before mutation

Run `doctor --json` read-only and report initialization state, supported schema, missing directories, migration guidance, and Git diagnostics. When it is healthy but task state remains questionable, run `validate --json` for aggregated file and lifecycle issues.

Explain the exact next safe action: initialize only an uninitialized target repository, follow stated migration guidance for an unsupported schema, repair the named repository condition, or return to `vinea:orient` after diagnostics pass. Do not modify task files to hide a diagnostic.
