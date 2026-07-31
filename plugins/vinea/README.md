# Vinea

Vinea is a Node.js command-line tool and host plugin for guided repository
workflows. It keeps task state in the target repository, so Codex and Claude
Code can deliberately recover the same task in a new session.

## Plugin distribution

The committed public plugin unit is [`plugins/vinea`](plugins/vinea). It ships
the same bundled CLI and eight prefixed workflow skills for both hosts; it has
no MCP server, daemon, hooks, apps, or cloud service.

Build and check the distributable tree with:

```sh
npm run package:plugin
npm run check:plugin
```

The source manifests live under `hosts/`; the packager replaces their version
placeholder with the root package version and writes the public Codex and
Claude Code manifests plus both repository marketplace files.

## Development

```sh
npm install
npm run check
```

Run the bundled CLI with:

```sh
node dist/vinea.mjs --help
```

The packaged equivalent is:

```sh
node plugins/vinea/bin/vinea.mjs --help
```

## CI state validation

Use the host-independent validator as the only CI command for Vinea
structure and state validation:

```sh
vinea validate --json
```

The command checks versioned Vinea state and local session pointers without
writing files or requiring an AI host. It does not run the project's own
tests; configure those separately in CI.
