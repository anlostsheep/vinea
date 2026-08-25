# Vinea

[简体中文](README.md) | [English](README.en.md)

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

To pin release 0.3.1:

```sh
codex plugin marketplace add anlostsheep/vinea --ref v0.3.1
codex plugin add vinea@vinea
```

For Claude Code:

```sh
claude plugin marketplace add anlostsheep/vinea
claude plugin install vinea@vinea --scope user
```

To pin release 0.3.1:

```sh
claude plugin marketplace add anlostsheep/vinea@v0.3.1
claude plugin install vinea@vinea --scope user
```

## Upgrade, roll back, or remove

For a Codex marketplace that follows `main`, refresh and reinstall:

```sh
codex plugin marketplace upgrade vinea
codex plugin remove vinea@vinea
codex plugin add vinea@vinea
```

For a pinned Codex installation, replace the marketplace with the desired tag;
use an older tag to roll back:

```sh
codex plugin remove vinea@vinea
codex plugin marketplace remove vinea
codex plugin marketplace add anlostsheep/vinea --ref v0.3.1
codex plugin add vinea@vinea
```

Claude Code can update a marketplace-following installation directly:

```sh
claude plugin marketplace update vinea
claude plugin update vinea@vinea --scope user
```

For a pinned Claude Code installation, remove the plugin and marketplace, add
the desired tag, and install again. To remove Vinea completely:

```sh
# Codex
codex plugin remove vinea@vinea
codex plugin marketplace remove vinea

# Claude Code
claude plugin uninstall vinea@vinea --scope user
claude plugin marketplace remove vinea --scope user
```

## Migrate from a development channel

Keep only one Vinea channel installed in each host. Before using the public
channel, remove the corresponding development plugin:

```sh
# Codex development channel
codex plugin remove vinea@personal

# Claude Code development channel
claude plugin uninstall vinea@vinea-local --scope user
```

Then run the public installation commands above. Vinea never uninstalls or
disables another plugin automatically.

## Verify installation and loading

After every install, upgrade, rollback, or channel change, fully restart the
host and start a **new session** in the target Git repository. First verify the
installed state:

```sh
codex plugin list
claude plugin list
```

Then separately confirm that the new session can discover `vinea:orient`. An
installed plugin tree does not prove that an already-running session loaded
its skills.

For complete lifecycle and local-development instructions, see the repository
README at <https://github.com/anlostsheep/vinea#readme>.

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
