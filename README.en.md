# Vinea

[简体中文](README.md) | [English](README.en.md)

Vinea is a lightweight AI-coding collaboration kernel for Codex, Claude Code and
Grok Build. The user defines goals, constraints and acceptance; agents choose an
execution path within that authority. Contracts, planning documents, execution
requests, ownership and evidence stay in the local Git common directory, shared
by linked worktrees and never tracked, committed or pushed through Git.

The committed public plugin is [`plugins/vinea`](plugins/vinea). It contains
one bundled Node CLI and nine host-prefixed skills: `vinea:run`,
`vinea:brainstorm`, `vinea:plan`, `vinea:continue`, `vinea:check`,
`vinea:debug`, `vinea:finish`, `vinea:orient`, and `vinea:doctor`.

Version `v1.0.0` introduces this kernel rewrite, breaking compatibility with the
stage commands and task storage of `v0.3.x`. Upgrades do not migrate old `.vinea`
data automatically; legacy data stays read-only and explicit imports grant no
execution authority.

## Upgrading to 2.0

**2.0.0 changes the execution contract incompatibly; it is not a drop-in 1.0.x update.**

- New tasks pin `planning-authorization-v1`. Persistent brainstorm/plan requires
  readable brief/plan artifacts for the current contract, not just chat or todos.
- Creating a task, setting `businessWrite`, or choosing `run` is not authorization.
  A concrete user implementation request is recorded separately before claim.
- Suspension revokes authorization and fences tokens. Cached-token contributions,
  snapshots and delivery verify planning content; restore writes serialize against
  suspension and revision. A timeout is not successful revocation.
- Older tasks remain readable, but active tasks without the new protocol are
  blocked. No state is migrated and no authority is inferred automatically. Stop
  or complete existing execution and inspect ownership before upgrading. Decide
  any migration separately; never edit state or change CLI versions to bypass gates.

These checks coordinate cooperating agents, not a host sandbox. User quotations
and references are caller-reported, not authenticated, and arbitrary local
filesystem writes cannot be intercepted by Vinea.

## Install from the Git marketplace

The Codex/Claude Code plugin id is `vinea@vinea`. The repository contains both
host manifests and a prebuilt CLI; Grok Build reads the Claude-compatible manifest.
Users do not need to clone and build the source.

### Codex

```sh
codex plugin marketplace add anlostsheep/vinea
codex plugin add vinea@vinea
```

To pin an exact release instead of following `main`, register the marketplace
at an annotated tag:

```sh
codex plugin marketplace add anlostsheep/vinea --ref v2.0.0
codex plugin add vinea@vinea
```

### Claude Code

```sh
claude plugin marketplace add anlostsheep/vinea
claude plugin install vinea@vinea --scope user
```

To pin an exact release:

```sh
claude plugin marketplace add anlostsheep/vinea@v2.0.0
claude plugin install vinea@vinea --scope user
```

### Grok Build

Adding a marketplace does not install its plugin. Install explicitly:

```sh
grok plugin marketplace add anlostsheep/vinea
grok plugin install vinea --trust
```

Use `--trust` only for a reviewed, trusted source. This follows the source's current
version. Vinea has no hooks or MCP server; Grok uses the same skills and CLI.

After installation, reload plugins or restart the host and start a **new session**.
An installed plugin tree does not prove that an already-running session loaded
its skills. Verify both states separately with `codex plugin list`,
`claude plugin list` or `grok plugin list`, then confirm that the new session can discover
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
codex plugin marketplace add anlostsheep/vinea --ref v1.0.1
codex plugin add vinea@vinea
```

Claude Code can refresh the marketplace and plugin directly:

```sh
claude plugin marketplace update vinea
claude plugin update vinea@vinea --scope user
```

Grok Build refreshes its selected source and plugin:

```sh
grok plugin marketplace update https://github.com/anlostsheep/vinea.git
grok plugin update vinea
grok plugin list
```

An update is not permission to enable a disabled plugin. A code rollback does not
roll back or migrate task state; do not run an older writer on a newer store.

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
npm run release -- 2.0.0
```

The command runs the full checks, stages only release artifacts, creates a
release commit and annotated `vX.Y.Z` tag, and intentionally does **not** push.
Publication remains a separate, explicitly approved action. See
[`CHANGELOG.md`](CHANGELOG.md) for release notes.

After validation, publish `main` and the version tag together:

```sh
git push --atomic origin main refs/tags/v2.0.0
```

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

The 2.0 `planning-authorization-v1` protocol separates contract ceilings
from execution authority. Persistent brainstorm/plan tasks store current brief
and plan Markdown with `task document`. `task authorize` separately records the
actual user implementation request, quotation and real reference. An entry label
or `businessWrite` field alone cannot obtain write ownership. Valid authorization
supports continuation; directly authorized small work needs no planning ceremony.

`task suspend` revokes authorization and fences tokens, releasing only the caller's
own local claim while retaining uncertain remote writers as holds. Inspect code
changes separately. Older tasks stay readable without automatic migration or
inferred authorization; do not downgrade the CLI to bypass the boundary. Diagnostics
report old/new active-state coexistence. Provenance remains caller-reported, not
host-authenticated consent or a filesystem sandbox.

Kernel restoration writes share the store lock with suspension and contract
revision. Revocation is effective only after a successful response, not a lock
timeout. Partial restoration retains its original contract until completed or
explicitly aborted. Cached-token contributions, snapshots and delivery still
validate planning content. Pre-protocol active tasks cause nonzero validation;
readability is not execution readiness.

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

`validate` is read-only and exits nonzero for missing, invalid, incomplete,
locked, conflicted or blocked state. It does not run business tests or initialize a fresh CI clone.
The protocol coordinates cooperating agents; it is not a sandbox against
arbitrary local filesystem access.

Agents use these commands within actual authority; users need not drive a CLI
stage sequence:

| Command | Purpose |
| --- | --- |
| `task create` | Store a contract without acquiring writes |
| `task document` | Save immutable, versioned brief/plan Markdown |
| `task authorize` | Record a concrete implementation request and real source |
| `work claim` | Acquire this worktree under valid authorization |
| `task suspend` | Revoke authority and retain uncertain writer holds |
| `continue` / `doctor` | Inspect authorization, ownership, artifacts and gaps |

Directly authorized small work needs no mandatory planning phase. Valid bound
continuation does not repeatedly ask for approval; "next step" does not expand
an earlier capability ceiling.

Version 2.0 evidence: [authorization checks](docs/verification/vinea-execution-boundaries-2026-09-20.md)
and [review repairs](docs/verification/vinea-execution-boundaries-review-repair-2026-09-20.md).
All 136 local tests passing does not establish live end-to-end acceptance in every host.

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
