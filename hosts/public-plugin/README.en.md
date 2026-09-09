# Vinea

[简体中文](README.md) | [English](README.en.md)

Vinea is a lightweight AI-coding collaboration kernel. Users define goals and
constraints; agents choose the execution path. Local worktrees share state in
the Git common directory's `vinea/`, never through Git tracking or pushes.

Version `v1.0.0` introduces this kernel rewrite, breaking compatibility with
the stage commands and task storage of `v0.3.x`. Installation does not migrate
old `.vinea` data automatically, and explicit imports grant no execution authority.

## Install for your host

The public plugin id is `vinea@vinea`.

For Codex:

```sh
codex plugin marketplace add anlostsheep/vinea
codex plugin add vinea@vinea
```

To pin release 1.0.0:

```sh
codex plugin marketplace add anlostsheep/vinea --ref v1.0.0
codex plugin add vinea@vinea
```

For Claude Code:

```sh
claude plugin marketplace add anlostsheep/vinea
claude plugin install vinea@vinea --scope user
```

To pin release 1.0.0:

```sh
claude plugin marketplace add anlostsheep/vinea@v1.0.0
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

Explicitly use `vinea:run` or ask to use Vinea for a goal. Ordinary requests do
not activate it. Nine `vinea:`-prefixed entries are run, brainstorm, plan,
continue, check, debug, finish, orient and doctor; no bare `/vinea` alias is registered.

Discussion, planning, checking and diagnosis can be selected independently.
Design approval does not authorize implementation. Continue supports read-only
joining and explicit agent handoff, not automatic write access. One physical
worktree has one cooperating business writer. An unknown writer requires
isolated recovery with the original directory still held. Real dispatch and
waiting belong to the host; Vinea does not simulate those capabilities.

Standalone check does not fix business code. Debug honors diagnosis-only or
repair intent; post-delivery repairs are linked tasks with frozen original
delivery records. Finish permits uncommitted inputs, requires current evidence
conditions, and preserves accepted gaps as gaps. Commit, deployment, user
acceptance and archive remain distinct operations.

The skills use this bundled CLI. From this plugin root, its direct form is:

```sh
node bin/vinea.mjs --help
node bin/vinea.mjs orient --json
```

Run business commands from the target Git worktree with the absolute bundled
CLI path; see the [CLI reference](CLI.md) for structured payloads. Reuse the
echoed Actor ID instead of inventing host IDs. Snapshots contain real files;
legacy import is explicit and grants no execution authority. Vinea ships no
cross-machine sync, MCP server, daemon, hooks, apps or cloud service.

For denied shared-store writes, follow [host access setup](HOSTS.md) and obtain
explicit access to the actual store. Do not disable the sandbox, borrow an
actor identity or silently continue business edits outside Vinea.
