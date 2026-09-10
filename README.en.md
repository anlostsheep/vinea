# Vinea

[简体中文](README.md) | [English](README.en.md)

Vinea is a lightweight collaboration kernel for AI coding. The user defines
the goal, constraints and acceptance criteria; agents choose the execution
path. State stays in the local Git common directory, shared by linked
worktrees, never tracked, committed or pushed through Git.

The committed public plugin is [`plugins/vinea`](plugins/vinea). It contains
one bundled Node CLI and nine host-prefixed skills: `vinea:run`,
`vinea:brainstorm`, `vinea:plan`, `vinea:continue`, `vinea:check`,
`vinea:debug`, `vinea:finish`, `vinea:orient`, and `vinea:doctor`.

Version `v1.0.0` introduces this kernel rewrite, breaking compatibility with the
stage commands and task storage of `v0.3.x`. Upgrades do not migrate old `.vinea`
data automatically; legacy data stays read-only and explicit imports grant no
execution authority.

## Install from the Git marketplace

The public plugin id is `vinea@vinea`. The repository contains both host
manifests and a prebuilt CLI, so users do not clone the repository or run
`npm install`.

### Codex

```sh
codex plugin marketplace add anlostsheep/vinea
codex plugin add vinea@vinea
```

To pin an exact release instead of following `main`, register the marketplace
at an annotated tag:

```sh
codex plugin marketplace add anlostsheep/vinea --ref v1.0.1
codex plugin add vinea@vinea
```

### Claude Code

```sh
claude plugin marketplace add anlostsheep/vinea
claude plugin install vinea@vinea --scope user
```

To pin an exact release:

```sh
claude plugin marketplace add anlostsheep/vinea@v1.0.1
claude plugin install vinea@vinea --scope user
```

After either installation, fully restart the host and start a **new session**.
An installed plugin tree does not prove that an already-running session loaded
its skills. Verify both states separately with `codex plugin list` or
`claude plugin list`, then confirm that the new session can discover
`vinea:orient`.

### Upgrade, roll back, or remove

Codex has no separate plugin-upgrade command. For a marketplace that follows
`main`, refresh its snapshot and reinstall the plugin:

```sh
codex plugin marketplace upgrade vinea
codex plugin remove vinea@vinea
codex plugin add vinea@vinea
```

For a pinned Codex installation, remove the old plugin and marketplace, then
add the desired tag (use an older tag to roll back):

```sh
codex plugin remove vinea@vinea
codex plugin marketplace remove vinea
codex plugin marketplace add anlostsheep/vinea --ref v0.3.1
codex plugin add vinea@vinea
```

Claude Code can refresh the marketplace and plugin directly:

```sh
claude plugin marketplace update vinea
claude plugin update vinea@vinea --scope user
```

To change a pinned Claude Code version, remove the plugin and marketplace,
then add the desired tag and install again. To remove Vinea completely:

```sh
# Codex
codex plugin remove vinea@vinea
codex plugin marketplace remove vinea

# Claude Code
claude plugin uninstall vinea@vinea --scope user
claude plugin marketplace remove vinea --scope user
```

Restart the host and use a new session after every upgrade, rollback, or
channel change.

## One channel per host

Do not keep a public and development Vinea plugin installed in the same host.
Before migrating to the public channel, remove the legacy development plugin:

```sh
# Codex development channel
codex plugin remove vinea@personal

# Claude Code development channel
claude plugin uninstall vinea@vinea-local --scope user
```

Then run the public installation commands above. Vinea's development helpers
perform the inverse preflight: if `vinea@vinea` is present, they stop before
copying files and print an explicit migration command. They never uninstall or
disable a plugin automatically.

## Install locally for development

From a Vinea checkout, use these helpers only when developing or dogfooding
unreleased changes:

```sh
scripts/install-codex-plugin.sh
scripts/install-claude-plugin.sh
```

After the channel-conflict preflight, each helper runs
`npm run package:plugin` and copies the public plugin tree into a host-specific
development marketplace:

| Host | Public plugin copy | Marketplace action |
| --- | --- | --- |
| Codex | `~/.codex/plugins/vinea` | Verifies the configured `personal` source, adds one `+codex.` build metadata suffix, then runs `codex plugin add vinea@personal`. |
| Claude Code | `~/.claude/plugins/marketplaces/vinea-local/plugins/vinea` | Validates and refreshes `vinea-local`; updates `vinea@vinea-local` when installed, otherwise installs it. |

The helpers do not write external credentials or host runtime caches. If the
relevant CLI is absent, they prepare and print the exact local files and manual
commands, but do not claim that the plugin was activated. In either host, start
a **new session** after installation or update: installed skills and plugins are
not hot-reloaded.

For a one-session Claude Code experiment without installation, the host also
supports its own `--plugin-dir` option; that is a host feature rather than a
Vinea installation path.

## Release version policy

The root `package.json` is the release-version source. Both host plugin
manifests and the Codex marketplace carry the generated version. The Claude
marketplace plugin entry deliberately omits a duplicate `version`, so Claude
Code resolves it from `.claude-plugin/plugin.json`; catalog metadata may still
display the release version.

Use a patch release for compatible fixes and documentation, a minor release
for compatible capabilities, and a major release for incompatible contracts.
From a clean `main` worktree (dirty, unstaged `.vinea/` task state is allowed),
create a local release with:

```sh
npm run release -- patch|minor|major
npm run release -- 1.0.2
```

The command runs the full checks, stages only release artifacts, creates a
release commit and annotated `vX.Y.Z` tag, and intentionally does **not** push.
Publication remains a separate, explicitly approved action. See
[`CHANGELOG.md`](CHANGELOG.md) for release notes.

## Workflow

Explicitly invoke `vinea:run` or ask to use Vinea for a goal. Ordinary coding
requests do not create Vinea tasks. Select brainstorm, plan, check or debug
directly when that is the desired scope. These are capabilities, not mandatory
phases. The logical `/vinea` shorthand is not a registered bare alias.

- Brainstorm investigates facts, challenges material assumptions, batches
  independent decisions, and follows dependent choices only after feedback.
- Plan delivers appropriately sized implementation and verification work.
  Design approval alone is not permission to execute.
- Run implements, internally debugs and verifies within the actual grant.
  TDD, independent reviewers and assignments are optional.
- Continue reads current goals, ownership and relevant evidence. Joining
  does not seize a write token. Reuse the CLI's echoed instance ID across
  processes; do not invent a host session ID.
- Standalone check does not fix business code. An explicit debug request may
  authorize repairs; internal checks during authorized development can repair
  within their existing scope.
- Debug supports diagnosis-only and bounded repair. Post-delivery defects
  create a related task, preserving original delivery facts and evidence.
- Finish accepts recoverable uncommitted work. Commit, deployment, user
  acceptance and archive are distinct actions. Learning is not a gate.

One physical worktree admits one cooperating business writer; independent
assignments can use separate worktrees. Hosts perform actual dispatch, waiting
and cancellation; Vinea records bounded contributions and owner integration.
Missing host facilities are disclosed and replaced by explicit relay when
authorized, not fictitious dispatch. Unknown-writer takeover requires an
authorized isolated recovery target and retains a hold on the original directory.

## Repository state and validation

Use `git rev-parse --git-common-dir` to locate the common directory. State lives
in its `vinea/` subdirectory, normally `.git/vinea/` in the primary checkout.
Linked worktrees resolve to that same local store. Runtime bindings can be
rebuilt without releasing ownership. Clones and machines do not share state.

Snapshots store selected file contents, additions, deletions and executable
bits, including uncommitted inputs, while rejecting sensitive paths. Evidence
separates command-runner results, agent reports and user observations. Matching
hashes alone do not prove current commands or external environments match.
Old contracts, stale epochs, missing blobs and mismatched conditions are rejected.

`legacy inspect` reads old `.vinea` data; explicitly approved `legacy import`
creates zero-grant historical references without modifying the source or
promoting old passes. Retain the original historical artifacts at their source.

Validate the local store:

```sh
node plugins/vinea/bin/vinea.mjs validate --json
```

`validate` is read-only and exits nonzero for missing, invalid, incomplete or
locked state. It does not run business tests or initialize a fresh CI clone.
The protocol coordinates cooperating agents; it is not a sandbox against
arbitrary local filesystem access.

See the [CLI reference](hosts/public-plugin/CLI.md),
[execution evidence](docs/verification/vinea-vnext-execution.md), and
[real-host acceptance](docs/verification/vinea-vnext-host-acceptance.md).
For denied shared-store access, see [least-privilege host setup](hosts/public-plugin/HOSTS.md),
not a sandbox bypass or alternate state root. The [single-task comparison](docs/verification/vinea-vnext-benchmark-2026-09-08.md)
does not establish general token savings.

Vinea deliberately ships no MCP server, daemon, hooks, apps, or cloud service.

## Development and distribution checks

```sh
npm install
npm run check
npm run package:plugin
npm run check:plugin
```

Run the development or packaged CLI directly with:

```sh
node dist/vinea.mjs --help
node plugins/vinea/bin/vinea.mjs --help
```
