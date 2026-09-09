# Host Access and First Join

Read this only for initial host setup or an access/identity failure. These are
host capabilities, not additional mandatory workflow stages.

## Exact Store Access

Vinea writes `<git-common-dir>/vinea`. A task's Grant does not make this path
writable through a host sandbox. Codex's default workspace sandbox can protect
`.git`, even when ordinary source edits are allowed.

Ask the user to authorize the exact store directory when needed. Do not switch
to full access, make the whole Git directory writable, create a second state
store, or continue business edits outside Vinea without a user decision.

On macOS with Codex CLI 0.153.4, this permission-profile pattern was tested in a
disposable repository: the state subdirectory is writable while other Git files
remain read-only. Replace both paths with the actual absolute common directory
and apply only through the user's approved host configuration.

```toml
default_permissions = "vinea-local"

[permissions.vinea-local]
extends = ":workspace"

[permissions.vinea-local.filesystem]
"/absolute/git/common-directory" = "read"
"/absolute/git/common-directory/vinea" = "write"
```

Permission profiles are a host-version-dependent feature. Do not combine this
with legacy `sandbox_mode`, `sandbox_workspace_write` or a `--sandbox` override.
Keep the explicit parent read rule: granting only the child path did not preserve
the intended parent restriction in the acceptance probe. Validate the effective
policy in a disposable repository before using it elsewhere. No Vinea command
installs or changes this configuration automatically.

If profile support is unavailable, report that host limitation and request the
host's supported least-privilege approval. Do not silently use a different root
or bypass a denial. Configuration examples are not blanket approval to apply them.

## First-Time Identity

For a genuinely new executor, `session resolve` with its host and
`newInstance:true` allocates a local instance ID without writing task state or
claiming work. That is not a host session ID. Omit `hostSessionId` unless the
host actually provides one. After resolution, reuse the echoed Actor.

If a host classifier denies this command, stay unbound and explain the
distinction; do not disable the classifier or borrow an existing actor. A
classifier outage is a host limitation, not permission to use raw stored claims
as a write token. Only a successful current `continue` response can describe
the caller's restored token. An empty runtime `missing` list does not establish
acceptance coverage.
