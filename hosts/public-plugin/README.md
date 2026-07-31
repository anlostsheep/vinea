# Vinea

Vinea is a shared, file-first task workflow for AI coding. Codex and Claude
Code read the same `.vinea/` state from the target Git repository, allowing a
new session to orient, confirm, and continue the same task deliberately.

## Install for your host

This plugin root contains both `.codex-plugin/plugin.json` and
`.claude-plugin/plugin.json`. Install it from the Vinea marketplace through
the plugin workflow of the host you use. After the host reports installation,
start a new Codex or Claude Code session in the target Git repository so it
can discover the Vinea skills.

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
