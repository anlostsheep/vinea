# Task 9 implementation report

## Status

Implemented the complete, fail-closed Vinea CLI contract on
`codex/vinea-implementation`.

- Commit subject: `feat: ship the Vinea command-line contract`
- The root `.vinea/` remains user-preserved, untracked, unmodified, and unstaged.
- No plugin, MCP, skill document, package script, repository-selection flag, or
  business workflow semantic was added.

## Delivered behavior

### Centralized argument contract

`src/cli/args.ts` now owns the dependency-free CLI argument rules:

- named value and boolean options are parsed through one implementation;
- unknown options fail with usage exit code `2`;
- duplicate value or boolean options fail with usage exit code `2`;
- missing named-option values and missing required values fail before command
  side effects;
- enum values, task IDs, exit codes, and comma-separated lists use the same
  typed usage-error boundary;
- `--json` mode detection is shared by successful output and the outer error
  boundary.

Every command continues to derive the repository solely from `process.cwd()`.
`--repo` is deliberately unknown and is rejected before `init` can create any
  state.

### Centralized rendering and error safety

`src/cli/render.ts` now owns help, human rendering, JSON rendering, and error
normalization:

- successful JSON is exactly one newline-terminated object or array;
- JSON errors are exactly one `{ "error": { "code", "message", ... } }`
  object, with optional structured `details` only when an error explicitly
  exposes public details;
- usage errors preserve `VINEA_VALIDATION_INVALID` and exit `2`;
- every existing `VineaError` code and message is preserved and exits `1`;
- unexpected errors return a generic `VINEA_SCHEMA_INVALID` response rather
  than exposing an exception message, cause, or stack trace;
- human errors remain concise on stderr and contain no stack trace.

The CLI now has one top-level `try/catch` boundary instead of command-specific
error paths. This makes `--json` consistent for top-level unknown commands,
`init`, `doctor`, `validate`, and every lifecycle command. `init --json` returns
`{ "initialized": true }`; ordinary `init` retains its original human output.

### Complete command surface

The centralized dispatcher and help contract expose:

- `init`, `orient`, `propose`, and `continue`;
- `task list`, `task show`, `task transition`, `task require`, `task accept`,
  `task set-plan`, and `task set-brief`;
- `context add` and `context list`;
- `evidence record`;
- `check` and `check show`;
- `learning propose`, `learning accept`, and `learning archive`;
- `finish`, `archive`, `doctor`, and `validate`.

The existing explicit `task unblock` command remains available. No successful
business operation was moved into the parser or renderer.

## Contract-level integration fixture

`tests/cli/contract.test.ts` uses the real bundled CLI in one temporary Git
repository and performs the full requested lifecycle:

1. seeds and commits brief, plan, and implementation/context files;
2. runs `init --json`;
3. creates a user-confirmed medium-risk, single-agent TDD task;
4. adds a requirement, controlled brief, controlled plan, and bounded context;
5. records a failing `tdd-red` result and a later passing `tdd-green` result;
6. transitions `planning -> ready -> in_progress -> checking`;
7. records a passing requirement check row backed by the green evidence;
8. proposes and task-locally archives one non-reusable learning candidate;
9. confirms finish and archive;
10. reopens the archived state through `orient --json`, `task show --json`,
    `check show --json`, and `validate --json`.

The fixture parses every JSON response directly and rejects prose-decorated
output.

`tests/cli/errors.test.ts` verifies:

- an unknown command with `--json` is one parseable error object, exits `2`,
  writes no stderr, and contains no stack trace;
- `init --repo ... --json` exits `2` without creating `.vinea/`;
- duplicate `doctor --json --json` exits `2` rather than running doctor;
- a runtime schema failure preserves `VINEA_SCHEMA_INVALID`, exits `1`, and
  contains no stack trace.

## TDD evidence

### RED

Command before production changes:

```text
npm test -- --run tests/cli/contract.test.ts tests/cli/errors.test.ts
```

Observed result:

- exit code `1`;
- `2` test files failed;
- `3` tests failed and `1` passed;
- failures were the intended missing contract: `init --json` emitted prose,
  unknown-command JSON went to human stderr, and `init` accepted `--repo` with
  exit `0` and side effects.

### Focused GREEN

```text
npm run typecheck &&
npm run build &&
npm test -- --run tests/cli/contract.test.ts tests/cli/errors.test.ts
```

Result:

- typecheck passed;
- build passed;
- focused Task 9 suite: `2` files, `4/4` tests passed.

### Normal full regression

```text
npm run check
```

Result:

- typecheck passed;
- full suite: `16` files, `98/98` tests passed;
- final build passed.

`git diff --check` also completed with no output before staging.

## Files in scope

- `src/cli/args.ts`
- `src/cli/render.ts`
- `src/cli.ts`
- `tests/cli/contract.test.ts`
- `tests/cli/errors.test.ts`
- `.superpowers/sdd/2026-07-31-vinea-implementation/task-9-report.md`

## Self-review and residual risk

- Option parsing occurs before mutations for every command handler.
- Duplicate `--json` is no longer silently accepted by doctor.
- The JSON-mode detector is used only to choose the error transport; each
  successful command still uses its parsed option map, so an unknown or
  duplicate `--json` cannot accidentally run as a valid command.
- Core `VineaError` causes are intentionally not serialized because they can
  contain filesystem or runtime internals; stable codes and public messages
  remain unchanged.
- Existing human renderers were moved without content changes, apart from the
  help list now explicitly naming `check show`.
- No blocker or known Task 9 correctness defect remains.
