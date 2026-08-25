# Vinea

[简体中文](README.md) | [English](README.en.md)

Vinea is a lightweight, file-first workflow for AI coding teams. Its task
state lives in the target Git repository, so Codex and Claude Code can
deliberately recover the same work in a new session.

The committed public plugin is [`plugins/vinea`](plugins/vinea). It contains
one bundled Node CLI and eight host-prefixed skills: `vinea:orient`,
`vinea:propose`, `vinea:brainstorm`, `vinea:plan`, `vinea:continue`,
`vinea:check`, `vinea:finish`, and `vinea:doctor`.

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
codex plugin marketplace add anlostsheep/vinea --ref v0.3.1
codex plugin add vinea@vinea
```

### Claude Code

```sh
claude plugin marketplace add anlostsheep/vinea
claude plugin install vinea@vinea --scope user
```

To pin an exact release:

```sh
claude plugin marketplace add anlostsheep/vinea@v0.3.1
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
npm run release -- 0.3.1
```

The command runs the full checks, stages only release artifacts, creates a
release commit and annotated `vX.Y.Z` tag, and intentionally does **not** push.
Publication remains a separate, explicitly approved action. See
[`CHANGELOG.md`](CHANGELOG.md) for release notes.

## Workflow

Start every new or uncertain session with `vinea:orient`. First-release
recovery is intentionally explicit: there is no hook that attaches a task in
the background. Only when Codex actually supplies a nonempty
`CODEX_THREAD_ID` does the skill pass it as `--session-id` and create a session
binding. Without that value, Codex uses the same explicit candidate
confirmation flow as Claude Code. Claude has no Vinea session-ID environment
variable fallback in this release; `vinea:orient` presents active candidates
and requires the user to confirm one.

A concise medium-risk lifecycle looks like this:

1. Use `vinea:propose`, review the risk and mode options, then create the task
   only after the user confirms.
2. Use `vinea:brainstorm` only for a real design choice. It asks one question
   at a time, presents 2–3 options, and waits for approval. Use `vinea:plan`
   to record implementation and quality choices.
3. For a user-confirmed TDD task, record a real failing `tdd-red` result before
   implementation and a later passing `tdd-green` result. TDD is optional,
   never a default requirement.
4. Use `vinea:check` to cover every requirement with observed evidence. Commit
   or otherwise handle the business Git changes through the repository's own
   workflow before `vinea:finish` and `vinea:archive`.
5. `vinea:finish` proposes learning candidates but never promotes them by
   itself. The user must explicitly accept reusable learning; otherwise archive
   it with the task.

Delegated work is also optional. It requires user confirmation and a host that
can actually provide the roles: research/check agents stay read-only and one
implementer owns business writes. When the host cannot support this, Vinea asks
for single-agent execution or another host; it does not silently substitute a
different mode.

## Repository state and validation

Vinea writes only the target repository's `.vinea/` directory. The workspace,
task records, artifacts, and runtime pointers carry explicit schema versions;
a later unsupported version is reported rather than silently rewritten. Active
tasks live below `.vinea/tasks/active/<task-id>/`, while completed task records
move to `.vinea/tasks/archive/<task-id>/`. Reusable rules appear below
`.vinea/specs/` only after an explicit user acceptance.

Use the host-independent validator in CI when you want to check Vinea state:

```sh
node plugins/vinea/bin/vinea.mjs validate --json
```

`validate` reads versioned Vinea state and local session pointers without
writing or requiring an AI host. It is not a replacement for the consuming
project's unit, integration, lint, build, or deployment checks; configure
those separately.

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
