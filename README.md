# Vinea

Vinea is a Node.js command-line tool for guided repository workflows.

## Development

```sh
npm install
npm run check
```

Run the bundled CLI with:

```sh
node dist/vinea.mjs --help
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
