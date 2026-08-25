# Vinea

Vinea is a shared, file-first task workflow for AI coding. Codex and Claude
Code read the same `.vinea/` state from the target Git repository, allowing a
new session to orient, confirm, and continue the same task deliberately.

## Install for your host

The public plugin id is `vinea@vinea`.

For Codex:

```sh
codex plugin marketplace add anlostsheep/vinea
codex plugin add vinea@vinea
```

For Claude Code:

```sh
claude plugin marketplace add anlostsheep/vinea
claude plugin install vinea@vinea --scope user
```

To pin a release, use `--ref v0.3.0` on the Codex marketplace command or add
`anlostsheep/vinea@v0.3.0` in Claude Code. Do not keep `vinea@vinea` installed
alongside the development channels `vinea@personal` or
`vinea@vinea-local` in the same host.

After the host reports installation, fully restart it and start a new session
in the target Git repository. First verify the installed files with
`codex plugin list` or `claude plugin list`; then separately verify that the
new session can discover `vinea:orient`.

For upgrades, rollbacks, removal, and development-channel migration, see the
repository README at <https://github.com/anlostsheep/vinea#readme>.

## Start or recover work

Use `vinea:orient` at the beginning of a new session. It reads state without
changing it and asks for confirmation before continuation. Use
`vinea:propose` for medium- or high-risk changes, `vinea:brainstorm` only for
material design choices, `vinea:check` before finishing, and `vinea:finish`
to apply completion and learning gates.

The skills use this bundled CLI. From this plugin root, its direct form is:

```sh
node bin/vinea.mjs --help
node bin/vinea.mjs orient --host codex --json
```

The CLI stores state only in the target repository. Vinea ships no MCP server,
daemon, hooks, apps, or cloud service.
