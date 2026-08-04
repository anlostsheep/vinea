# Vinea

Vinea is a lightweight, file-first workflow for AI coding teams. Its task
state lives in the target Git repository, so Codex and Claude Code can
deliberately recover the same work in a new session.

The committed public plugin is [`plugins/vinea`](plugins/vinea). It contains
one bundled Node CLI and eight host-prefixed skills: `vinea:orient`,
`vinea:propose`, `vinea:brainstorm`, `vinea:plan`, `vinea:continue`,
`vinea:check`, `vinea:finish`, and `vinea:doctor`.

## Release version policy

Every content change that is distributed in `plugins/vinea` must update the
root semantic version in the same commit. Use a patch release for compatible
fixes, visual changes, and documentation; use a minor release for compatible
capabilities; and use a major release for incompatible contracts. This release
is `0.2.0`.

## Install locally

From a Vinea checkout, use the helper for the host you want to test:

```sh
scripts/install-codex-plugin.sh
scripts/install-claude-plugin.sh
```

Each helper first runs `npm run package:plugin`, then copies the public plugin
tree into a host-specific personal marketplace:

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
