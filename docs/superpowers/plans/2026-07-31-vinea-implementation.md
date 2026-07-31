# Vinea Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an installable Vinea plugin for Codex and Claude Code, backed by one file-first Node CLI that lets a small team create, resume, check, finish, and archive shared AI-coding tasks across new sessions.

**Architecture:** A TypeScript core owns all `.vinea/` schema validation and state mutations. A thin ESM CLI exposes that core through human-readable and JSON output. One prebuilt public plugin tree contains both host manifests, shared `vinea:` skills, and `bin/vinea.mjs`; skills use their host-specific plugin-root contract only to invoke the same CLI. No MCP server, daemon, cloud service, or automatic Git commit is introduced.

**Tech Stack:** Node.js >=18.18, TypeScript, esbuild, Vitest, Node `fs/promises`, JSON/JSONL files, Bash only for developer install helpers.

## Global Constraints

- Keep Vinea independent at `/Users/lostsheep/programing/projects/vinea`; never modify the consumer repository other than an explicit `vinea init` or Vinea lifecycle command.
- Treat `.vinea/` (except `.vinea/.runtime/`) as versioned team state. Never read or replay host chat transcripts.
- All mutations of `task.json`, `inline-audit.jsonl`, `context.jsonl`, `evidence.jsonl`, `journal.md`, `check.md`, and long-term specs must pass through the CLI; host skills must not hand-edit those files.
- `vinea:propose`, TDD selection, delegated execution, task attachment, and learning promotion require an explicit user confirmation in the conversation. CLI flags record the decision but are not a substitute for obtaining it.
- The first release uses explicit `vinea:orient` as the reliable new-session entrypoint. A native session ID is optional: Codex uses `CODEX_THREAD_ID` when present; Claude must work without an assumed undocumented session-ID environment variable.
- Vinea reports and blocks ambiguous or invalid state. It must not silently select a task, invent test results, downgrade delegated mode, or modify Git/production state.
- `vinea finish` must ignore `.vinea/` paths when checking whether *business* changes remain dirty, and it must never create a Git commit.
- Build artifacts under `plugins/vinea/` are intentionally committed public distribution output. Build code must not leave machine-specific absolute paths there.

## Proposed Repository Layout

```text
package.json
tsconfig.json
vitest.config.ts
README.md
LICENSE
src/
  cli.ts
  cli/args.ts
  cli/render.ts
  core/errors.ts
  core/types.ts
  core/paths.ts
  core/json.ts
  core/config.ts
  core/schema.ts
  core/git.ts
  core/task-store.ts
  core/workflow.ts
  core/context.ts
  core/evidence.ts
  core/check.ts
  core/learning.ts
  core/doctor.ts
  core/validate.ts
skills/
  orient/SKILL.md
  propose/SKILL.md
  brainstorm/SKILL.md
  plan/SKILL.md
  continue/SKILL.md
  check/SKILL.md
  finish/SKILL.md
  doctor/SKILL.md
hosts/
  codex/.codex-plugin/plugin.json
  claude/.claude-plugin/plugin.json
scripts/
  build.mjs
  package-public-plugin.mjs
  check-public-plugin.mjs
  install-codex-plugin.sh
  install-claude-plugin.sh
tests/
  helpers/fixture.ts
  core/*.test.ts
  cli/*.test.ts
  plugin/*.test.ts
plugins/vinea/                         # generated, committed public unit
  bin/vinea.mjs
  skills/…
  .codex-plugin/plugin.json
  .claude-plugin/plugin.json
.agents/plugins/marketplace.json       # generated Codex marketplace
.claude-plugin/marketplace.json        # generated Claude marketplace
```

---

### Task 1: Establish the Node project, test harness, and source-of-truth version

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `scripts/build.mjs`
- Create: `src/cli.ts`
- Create: `tests/cli/help.test.ts`
- Create: `README.md`, `LICENSE`, `.gitignore`

- [ ] **Step 1: Add package metadata and deterministic scripts.**
  - Set `name` to `vinea`, `version` to `0.1.0`, `private` to `true`, `type` to `module`, and `engines.node` to `>=18.18`.
  - Add scripts: `build`, `typecheck`, `test`, `package:plugin`, `check:plugin`, `check`, and `test:e2e:manual`.
  - Use `typescript`, `esbuild`, `vitest`, and `@types/node` as development dependencies only. Do not add a runtime framework or MCP dependency.
  - **Expected result:** `npm run typecheck` has one version source (`package.json`) and no implicit global package requirement.

- [ ] **Step 2: Configure strict compilation and a build entrypoint.**
  - Configure TypeScript with `strict`, `noUncheckedIndexedAccess`, `module`/`moduleResolution` `NodeNext`, and output to `build/`.
  - Make `scripts/build.mjs` invoke esbuild on `src/cli.ts` with `bundle: true`, `platform: "node"`, `format: "esm"`, banner `#!/usr/bin/env node`, and output `dist/vinea.mjs`.
  - In `src/cli.ts`, implement only `--help` and `--version` initially, returning exit code `0`; unknown commands return a typed usage error and exit code `2`.
  - **Expected result:** `node dist/vinea.mjs --version` prints the root `package.json` version without reading the project under test.

- [ ] **Step 3: Create reusable temp-repository test helpers.**
  - Add `tests/helpers/fixture.ts` with `createTempRepo()`, `writeJson()`, `readJson()`, `runCli(args, cwd)`, and `git(cwd, args)` helpers using `mkdtemp`, `spawn`, and `git init`.
  - `runCli` must invoke the built `dist/vinea.mjs`, capture stdout/stderr/exit code, and require an explicit fixture `cwd`.
  - Add a help/version test that builds once in `beforeAll`, asserts `--help` lists `init`, `orient`, `propose`, `continue`, `check`, `finish`, `doctor`, and `validate`, and asserts `--version` equals `package.json`.

- [ ] **Step 4: Verify the scaffold.**
  - Run `npm run typecheck && npm test && npm run build`.
  - **Expected result:** tests invoke a real bundled CLI and build produces exactly `dist/vinea.mjs`.

- [ ] **Step 5: Commit the foundation.**
  - Stage only the files listed above.
  - Commit: `chore: scaffold Vinea CLI project`.

### Task 2: Implement the versioned `.vinea/` layout, config, and safe initialization

**Files:**
- Create: `src/core/types.ts`, `src/core/errors.ts`, `src/core/paths.ts`, `src/core/json.ts`, `src/core/config.ts`, `src/core/schema.ts`
- Modify: `src/cli.ts`
- Create: `tests/core/init.test.ts`, `tests/core/schema.test.ts`

- [ ] **Step 1: Define closed TypeScript types and schema constants.**
  - Export `SCHEMA_VERSION = 1`, `Host = "codex" | "claude"`, `TaskStatus`, `RiskLevel`, `QualityMode`, and `ExecutionMode` union types.
  - Define `VineaConfig` with `schemaVersion`, `riskRules.medium`, `riskRules.high`, `context.maxFiles`, and `context.maxEstimatedBytes`.
  - Define `TaskRecord`, `Requirement`, `ContextReference`, `EvidenceRecord`, `CheckRow`, and `LearningCandidate` with explicit `schemaVersion` and ISO timestamp fields where applicable.
  - Create `VineaError` subclasses for `NotInitializedError`, `SchemaError`, `ValidationError`, `AmbiguousTaskError`, `TransitionError`, and `FinishGateError`; assign stable error codes such as `VINEA_NOT_INITIALIZED`.

- [ ] **Step 2: Build path and atomic-JSON utilities.**
  - `paths.ts` must resolve a supplied working directory to `<repo>/.vinea`, `tasks/active`, `tasks/archive`, `specs`, and `.runtime/sessions`, never walking outside the supplied repository root.
  - `json.ts` must parse JSON with filename-qualified errors and write JSON via a sibling temporary file plus rename. It must write JSONL by appending exactly one newline-terminated serialized record.
  - Reject symlink escapes and malformed JSON with a `VineaError`; do not “repair” data implicitly.

- [ ] **Step 3: Implement `vinea init`.**
  - Create `.vinea/config.json` with defaults: medium keywords `behavior, bug, cross-file, external, security, data, deploy`; high keywords `production, migration, credential, permission, delete`; `maxFiles: 12`; `maxEstimatedBytes: 80000`.
  - Create `.vinea/specs/index.md` with an empty indexed-spec section, `.vinea/tasks/active`, `.vinea/tasks/archive`, `.vinea/.runtime/sessions`, and a nested `.vinea/.gitignore` containing only `.runtime/`.
  - Make init idempotent: existing matching files are preserved; a nonmatching `config.json` reports a schema error; no root `.gitignore`, `AGENTS.md`, or `CLAUDE.md` is changed.

- [ ] **Step 4: Implement schema inspection and explicit migration behavior.**
  - Add `readConfig()` and `assertSupportedSchema()`; only schema version `1` is accepted in this release.
  - Add `vinea doctor` JSON/human output that reports `initialized`, config schema, missing required directories, unknown future schema, and migration guidance. Do not alter any file in doctor mode.

- [ ] **Step 5: Cover init behavior with focused tests.**
  - Test a fresh init creates exactly the expected tree and the nested ignore file contains only `.runtime/`.
  - Test init twice is unchanged, existing root guidance files survive, malformed config fails with `VINEA_SCHEMA_INVALID`, and `doctor --json` reports a supported fixture as healthy.

- [ ] **Step 6: Verify and commit.**
  - Run `npm run typecheck && npm test -- --run tests/core/init.test.ts tests/core/schema.test.ts`.
  - Commit: `feat: initialize versioned Vinea workspace`.

### Task 3: Implement task records, risk proposals, and the guarded state machine

**Files:**
- Create: `src/core/task-store.ts`, `src/core/workflow.ts`
- Modify: `src/core/types.ts`, `src/cli.ts`
- Create: `tests/core/workflow.test.ts`, `tests/cli/propose.test.ts`

- [ ] **Step 1: Implement task IDs and initial artifacts.**
  - Create IDs as `t-YYYYMMDD-HHmmss-<slug>` using an injectable clock and deterministic slugification; fail rather than overwrite when a generated path already exists.
  - `createTask()` creates `tasks/active/<id>-<slug>/task.json`, `brief.md`, `plan.md`, `context.jsonl`, `evidence.jsonl`, `check.md`, and `journal.md` in one operation.
  - Initialize `task.json` as `planning` with title, risk `{ level, reasons }`, `qualityMode`, `executionMode`, and empty requirements/acceptance/commit metadata.
  - Seed `journal.md` with a timestamped creation event, not an agent-written claim of implementation.

- [ ] **Step 2: Implement deterministic risk suggestions.**
  - Add `suggestRisk(title, description, changedPaths?)` that normalizes text and matches configured keyword rules; choose `high` over `medium`, otherwise `low`; return every matched reason.
  - Make `vinea propose --title <text> --description <text> --risk auto|low|medium|high --quality standard|tdd --execution single-agent|delegated` print a JSON proposal by default only when `--json` is requested; it must not create a task without `--confirmed`.
  - `--confirmed` creates the task and records `confirmation: "user"` in the first journal event. `--inline-skip-reason <text>` appends one versioned record to `.vinea/inline-audit.jsonl` containing timestamp, request summary, proposed risk, and the user reason; it does not create a task and cannot be combined with `--confirmed`.

- [ ] **Step 3: Encode allowed transitions and required prerequisites.**
  - Allow `planning -> ready -> in_progress -> checking -> finished -> archived`; allow `planning|ready|in_progress|checking -> blocked`; require explicit `unblock --to ready|in_progress|checking` from `blocked`.
  - Require nonempty `brief.md`, `plan.md`, and at least one acceptance/requirement before `ready`; do not use file length alone as proof.
  - Make every transition append a structured journal event containing old status, new status, actor value, and reason. Reject skipped or terminal-invalid transitions with `VINEA_TRANSITION_INVALID`.

- [ ] **Step 4: Add CLI lifecycle commands.**
  - Support `vinea task transition <task-id> --to <state> --reason <text>`, `vinea task list --status active|all --json`, and `vinea task show <task-id> --json`.
  - Human output must show task ID, status, modes, risk reasons, incomplete requirements, and next gate. JSON output must be a single object/array with no decoration.

- [ ] **Step 5: Test risk and lifecycle failures, not only happy paths.**
  - Verify `production migration` proposes high risk, a cross-file behavior change proposes medium risk, and a low-risk task remains inline unless explicitly confirmed.
  - Verify propose without confirmation leaves no task directory, explicit inline skip leaves no task directory but appends an auditable inline record, task creation yields all artifacts, invalid state skips fail, a block/unblock transition is auditable, and JSON output parses.

- [ ] **Step 6: Verify and commit.**
  - Run `npm run typecheck && npm test -- --run tests/core/workflow.test.ts tests/cli/propose.test.ts`.
  - Commit: `feat: add risk-gated Vinea task workflow`.

### Task 4: Add requirement, plan, context, and evidence mutation APIs

**Files:**
- Create: `src/core/context.ts`, `src/core/evidence.ts`
- Modify: `src/core/task-store.ts`, `src/core/workflow.ts`, `src/cli.ts`
- Create: `tests/core/context.test.ts`, `tests/core/evidence.test.ts`

- [ ] **Step 1: Make requirements and acceptance criteria first-class task fields.**
  - Add `vinea task require <task-id> --id R1 --text <text>` and `vinea task accept <task-id> --id A1 --text <text>`.
  - Require IDs unique within a task and preserve insertion order. Journal each addition so a later check can trace a requirement to its creation.
  - Add `vinea task set-plan <task-id> --file <path>` and `vinea task set-brief <task-id> --file <path>`; copy UTF-8 content into the controlled artifact after validating it is nonempty.

- [ ] **Step 2: Implement a bounded context manifest.**
  - `vinea context add <task-id> --path <repo-relative-path> --purpose <text>` resolves a real, non-directory, non-symlink file inside the repository and records `{ path, purpose, estimatedBytes, addedAt }` in `context.jsonl`.
  - Reject missing, duplicate, absolute, parent-traversing, ignored runtime, or out-of-repository references. Enforce both configured `maxFiles` and `maxEstimatedBytes` before write.
  - `vinea context list <task-id> --json` reports the referenced files and cumulative budget, but does not read their full contents.

- [ ] **Step 3: Implement evidence records with TDD gates.**
  - Add `vinea evidence record <task-id> --kind command|manual|tdd-red|tdd-green --summary <text> [--command <text>] [--exit-code <number>] [--result pass|fail]`.
  - Require `tdd-red` to record `result: fail` and a nonzero exit code; require `tdd-green` to record `result: pass` and exit code `0`. Reject contradictory evidence.
  - `evidence.jsonl` records timestamp, kind, summary, optional command/exitCode, result, and actor; command output itself is summarized, never copied without a size bound.

- [ ] **Step 4: Make quality-mode gates inspect evidence.**
  - `assertTddReadyForCheck()` must require at least one valid red record preceding a valid green record whenever `qualityMode === "tdd"`.
  - Standard tasks may enter checking without TDD evidence, but must still have check rows later.

- [ ] **Step 5: Test bounds and ordering.**
  - Test duplicate/escaped context paths and over-budget manifests fail without appending JSONL.
  - Test a green-only TDD task fails its gate, red then green passes, a red marked pass is rejected, and standard mode does not require red/green.

- [ ] **Step 6: Verify and commit.**
  - Run `npm run typecheck && npm test -- --run tests/core/context.test.ts tests/core/evidence.test.ts`.
  - Commit: `feat: track bounded context and quality evidence`.

### Task 5: Implement explicit orient and cross-session continuation

**Files:**
- Modify: `src/core/types.ts`, `src/core/task-store.ts`, `src/core/workflow.ts`, `src/cli.ts`
- Create: `tests/core/orient.test.ts`, `tests/cli/continue.test.ts`

- [ ] **Step 1: Model optional local session bindings.**
  - Store a binding only when the caller supplies both `--host codex|claude` and nonempty `--session-id`; write it to `.vinea/.runtime/sessions/<host>-<safe-session-id>.json` with task ID and `boundAt`.
  - Sanitize session filenames and reject path separators. No binding is created for a missing session ID; recovery remains possible through active-task discovery.

- [ ] **Step 2: Implement `orient` as a pure summary.**
  - `vinea orient --host <host> [--session-id <opaque>] [--json]` reports repository health, `git status --porcelain`, local binding if any, all active task candidates, and a compact candidate summary: ID, title, status, modes, requirements not covered, context references, latest evidence/check event.
  - If a valid binding exists, return `recommendation: "resume-bound"`. If exactly one active task exists, return `recommendation: "confirm-single"`. If more than one exists, return `recommendation: "choose-task"`. Never mutate state or bind a task.

- [ ] **Step 3: Implement confirmed continuation.**
  - `vinea continue <task-id> --host <host> [--session-id <opaque>] --confirmed` validates the task is active, records a journal event, and writes/replaces the optional local binding.
  - When the task is `ready`, transition it to `in_progress` only with `--start --reason <text>`; when it is already in progress/checking, continuation leaves status unchanged. Invalid or archived task IDs fail clearly.

- [ ] **Step 4: Make `orient` resilient to local runtime loss.**
  - Missing `.runtime` or a stale binding must be reported as `binding: null` or `binding: stale`, not an initialization failure.
  - If the active task directory is malformed, doctor/validate diagnostics take precedence; orient must not hide a schema issue by guessing another task.

- [ ] **Step 5: Test the exact resume contract.**
  - Create one active task in a fixture, call orient from host `codex` with a session ID, confirm continuation, then call orient from host `claude` without a session ID and assert it recommends the same single task.
  - Add tests for two active candidates, stale pointer, unsafe session ID, and no mutation from orient.

- [ ] **Step 6: Verify and commit.**
  - Run `npm run typecheck && npm test -- --run tests/core/orient.test.ts tests/cli/continue.test.ts`.
  - Commit: `feat: resume shared tasks across new sessions`.

### Task 6: Generate check matrices, enforce finish gates, and archive cleanly

**Files:**
- Create: `src/core/git.ts`, `src/core/check.ts`
- Modify: `src/core/workflow.ts`, `src/core/task-store.ts`, `src/cli.ts`
- Create: `tests/core/check.test.ts`, `tests/core/finish.test.ts`

- [ ] **Step 1: Build requirement-to-evidence check rows.**
  - `vinea check <task-id> --requirement R1|A1 --plan-item <text> --paths <comma-list> --evidence <evidence-id> --result pass|fail|uncovered --summary <text>` upserts one row per declared requirement or acceptance ID in `check.md` using a stable Markdown table.
  - Validate referenced requirement/acceptance IDs and evidence IDs exist; paths must be repository-relative. A row marked `pass` requires at least one evidence ID.
  - Entering `checking` invokes the TDD gate for TDD tasks; check rows remain editable while checking.

- [ ] **Step 2: Render machine and human check summaries.**
  - `vinea check show <task-id> --json` returns each requirement, plan item, changed paths, evidence IDs, result, summary, and totals.
  - Human `check.md` includes the required columns: requirement or acceptance ID, task item, implementation/change paths, test or verification evidence, and result.

- [ ] **Step 3: Implement business-dirty inspection.**
  - In `git.ts`, run `git status --porcelain=v1 -z`; identify uncommitted business paths by excluding `.vinea/` and any filename under that prefix only.
  - If `git` is unavailable or current root is not a Git repository, return a distinct `gitUnavailable` diagnostic; do not infer cleanliness.

- [ ] **Step 4: Implement finish and archive gates.**
  - `vinea finish <task-id> --confirmed` requires status `checking`, no failed/uncovered check rows, every declared requirement and acceptance criterion covered, valid TDD evidence when applicable, and no business dirty paths.
  - It must also require every learning candidate to be accepted or archived. On success, append a journal event and move to `finished`; it does not move to archive automatically.
  - `vinea archive <task-id> --confirmed` requires `finished`, moves the complete task directory to `tasks/archive/`, updates status to `archived`, and removes stale local bindings that name the task.

- [ ] **Step 5: Test completion barriers.**
  - Test missing requirement or acceptance coverage, failed evidence, green-without-red TDD, business-dirty source file, non-Git repository, and unclassified learning candidates each block finish with a specific code.
  - Test `.vinea/` changes alone do not block finish, archive preserves all task files, active lists no longer include archived tasks, and stale bindings are removed.

- [ ] **Step 6: Verify and commit.**
  - Run `npm run typecheck && npm test -- --run tests/core/check.test.ts tests/core/finish.test.ts`.
  - Commit: `feat: enforce Vinea regression checks and completion gates`.

### Task 7: Add user-confirmed promotion of reusable learning to long-term specs

**Files:**
- Create: `src/core/learning.ts`
- Modify: `src/core/types.ts`, `src/core/task-store.ts`, `src/core/workflow.ts`, `src/cli.ts`
- Create: `tests/core/learning.test.ts`

- [ ] **Step 1: Implement task-local learning candidates.**
  - `vinea learning propose <task-id> --id L1 --domain <slug> --text <rule> --rationale <text>` validates a nonempty durable rule and writes candidate state `proposed` into `task.json`, plus a journal event.
  - Reject an empty rationale, duplicate candidate IDs, invalid domain slugs, and text longer than 500 characters. Candidate creation alone must not alter `.vinea/specs/`.

- [ ] **Step 2: Make promotion explicit and reviewable.**
  - `vinea learning accept <task-id> --id L1 --confirmed-by user` requires `proposed`, appends one dated bullet to `.vinea/specs/<domain>.md`, and adds the domain to `specs/index.md` exactly once.
  - Before appending, normalize whitespace and reject an existing identical rule in the domain spec. Record `acceptedAt` and `confirmedBy` on the candidate. The skill must only call this after the user has accepted the proposal in conversation.

- [ ] **Step 3: Retain non-reusable knowledge only with the task.**
  - Add `vinea learning archive <task-id> --id L1 --reason <text>` to transition a proposed candidate to `archived` without touching specs.
  - Finish validation accepts only `accepted` and `archived`; no bulk “write all learnings” option exists.

- [ ] **Step 4: Test the promotion boundary.**
  - Test propose leaves `specs/` unchanged, accept creates/indexes the expected spec once, duplicate promotion fails without a second line, and archive makes finish eligible while preserving the task-local candidate.

- [ ] **Step 5: Verify and commit.**
  - Run `npm run typecheck && npm test -- --run tests/core/learning.test.ts`.
  - Commit: `feat: promote only confirmed reusable learning`.

### Task 8: Complete `doctor` and host-independent `validate`

**Files:**
- Create: `src/core/doctor.ts`, `src/core/validate.ts`
- Modify: `src/cli.ts`
- Create: `tests/core/doctor.test.ts`, `tests/core/validate.test.ts`

- [ ] **Step 1: Implement exhaustive read-only validation.**
  - `vinea validate [--json]` scans `config.json`, `inline-audit.jsonl`, every active/archive task, required artifact paths, task-schema versions, allowed states, duplicate context entries, context file counts/estimated bytes, and invalid session binding filenames.
  - Validation must report all detected issues with `{ code, path, message }`, exit `0` only when none exist, and make no write call.
  - It intentionally must not run project tests, inspect external services, or substitute for `vinea check`.

- [ ] **Step 2: Differentiate doctor from validate.**
  - `doctor` provides an actionable installation/migration summary and current Git availability; `validate` is CI-oriented and emits deterministic issue records.
  - Both support `--json`; neither needs an AI host or session identity.

- [ ] **Step 3: Test malformed real-world state.**
  - Seed fixtures for future schema versions, unknown status, missing artifact, duplicate context reference, oversized manifest, corrupted JSONL line, and a stale runtime pointer.
  - Assert validate reports paths and codes in a stable sorted order and does not change file modification content; assert doctor reports migration guidance for unsupported schema.

- [ ] **Step 4: Add CI-facing documentation and verify.**
  - In `README.md`, add `vinea validate --json` as the only recommended CI command for structure/state validation, explicitly noting it does not run the project’s own tests.
  - Run `npm run typecheck && npm test -- --run tests/core/doctor.test.ts tests/core/validate.test.ts`.

- [ ] **Step 5: Commit.**
  - Commit: `feat: validate Vinea state without a host session`.

### Task 9: Expose a complete, safe CLI contract

**Files:**
- Create: `src/cli/args.ts`, `src/cli/render.ts`
- Modify: `src/cli.ts`
- Create: `tests/cli/contract.test.ts`, `tests/cli/errors.test.ts`

- [ ] **Step 1: Centralize parsing and output.**
  - Implement a dependency-free parser that accepts named options, rejects unknown/duplicate options, and uses `--json` consistently.
  - Map `VineaError` codes to concise human errors and structured `{ error: { code, message, details } }` JSON. Usage errors exit `2`, runtime/validation errors exit `1`.

- [ ] **Step 2: Wire all documented commands.**
  - Register: `init`, `orient`, `propose`, `continue`, `task list/show/transition/require/accept/set-plan/set-brief`, `context add/list`, `evidence record`, `check/show`, `learning propose/accept/archive`, `finish`, `archive`, `doctor`, and `validate`.
  - Ensure every command resolves its repo from the process working directory; do not add a `--repo` escape hatch in v1.

- [ ] **Step 3: Verify contract-level behavior.**
  - Add a single CLI fixture scenario: init, confirmed medium-risk TDD task, requirements/brief/plan/context, red/green evidence, ready/in-progress/checking transitions, check row, learning archive, finish, and archive.
  - Assert the scenario is readable via `orient --json`, `task show --json`, `check show --json`, and `validate --json`; assert `--json` contains no prose and unknown commands do not produce a stack trace.

- [ ] **Step 4: Verify and commit.**
  - Run `npm run typecheck && npm test -- --run tests/cli/contract.test.ts tests/cli/errors.test.ts && npm run build`.
  - Commit: `feat: ship the Vinea command-line contract`.

### Task 10: Author the shared, prefixed Vinea skills

**Files:**
- Create: `skills/orient/SKILL.md`
- Create: `skills/propose/SKILL.md`
- Create: `skills/brainstorm/SKILL.md`
- Create: `skills/plan/SKILL.md`
- Create: `skills/continue/SKILL.md`
- Create: `skills/check/SKILL.md`
- Create: `skills/finish/SKILL.md`
- Create: `skills/doctor/SKILL.md`
- Create: `tests/plugin/skills.test.ts`

- [ ] **Step 1: Standardize the bundled-CLI invocation contract.**
  - At the top of every skill, state that it uses the public plugin’s `bin/vinea.mjs`, never a global binary.
  - For Codex, instruct the agent to derive plugin root from the absolute path of the current `SKILL.md` by removing `/skills/<current-skill>/SKILL.md`; for Claude Code, use `${CLAUDE_PLUGIN_ROOT}`. In both cases invoke `node <plugin-root>/bin/vinea.mjs` from the target Git repository.
  - Do not mention or require MCP, a daemon, a network service, or a host hook.

- [ ] **Step 2: Define the lifecycle skills around user confirmation.**
  - `vinea:orient`: run read-only orient; when a bound task exists summarize it, when exactly one candidate exists ask for confirmation before `continue`, and when many candidates exist present summaries and ask the user to choose.
  - `vinea:propose`: distinguish direct-answer, low-risk inline, and medium/high-risk changes; explain matched risk reasons, propose mode options, and call `propose --confirmed` only after user approval. Explicit inline work records a short skip reason.
  - `vinea:continue`: confirm selected task/modes and load only the brief, plan, compact journal, check file, and context-manifest references.

- [ ] **Step 3: Recreate the selective brainstorming behavior.**
  - `vinea:brainstorm` reads task-specific context and specs, asks exactly one materially decision-changing question at a time, presents 2–3 options with a recommendation, obtains design approval before implementation, then writes confirmed brief/plan through CLI commands.
  - It must not force brainstorming for clear low-risk work and must not write reusable learnings to specs.
  - `vinea:plan` makes checklist-level task work and quality/execution choices explicit. For behavior changes/bugs, it recommends TDD; it starts TDD only after user confirmation.

- [ ] **Step 4: Define quality, delegation, and finish behavior.**
  - `vinea:check` records real test/manual evidence and fills every requirement row; it stops on missing/failed evidence rather than claiming completion.
  - `vinea:finish` verifies business Git handling, check coverage, and TDD evidence; it proposes only stable portable learning candidates, asks user to accept/archive each one, then invokes finish/archive.
  - Delegated mode is optional and must be user-confirmed. It assigns research/check read-only roles and one implementer business-write role only if the host supports it; otherwise it asks the user to select single-agent or another host, with no silent fallback.
  - `vinea:doctor` runs the read-only diagnostics and explains the exact next safe action.

- [ ] **Step 5: Add static skill contract tests.**
  - Assert all eight skill directories exist and expose the logical names `orient`, `propose`, `brainstorm`, `plan`, `continue`, `check`, `finish`, and `doctor`; the plugin host prefix must therefore publish them as `vinea:<name>`. Assert no bare aliases such as `start` or `finish` appear as additional published names, all skills name `bin/vinea.mjs`, and `vinea:brainstorm` contains one-question/2–3-options/approval requirements.
  - Assert no skill claims automatic host recovery or automatic learning promotion.

- [ ] **Step 6: Verify and commit.**
  - Run `npm test -- --run tests/plugin/skills.test.ts`.
  - Commit: `feat: add prefixed Vinea workflow skills`.

### Task 11: Package both host plugins from one public distribution tree

**Files:**
- Create: `hosts/codex/.codex-plugin/plugin.json`
- Create: `hosts/claude/.claude-plugin/plugin.json`
- Create: `scripts/package-public-plugin.mjs`, `scripts/check-public-plugin.mjs`
- Modify: `package.json`, `README.md`
- Create: `tests/plugin/package.test.ts`
- Generate and commit: `plugins/vinea/**`, `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json`

- [ ] **Step 1: Create source manifests with shared metadata.**
  - Define both source manifests with name `vinea`, description mentioning shared task state for Codex and Claude Code, `skills: "./skills/"`, a real author name, required interface metadata, and a version placeholder replaced by the packager.
  - Do not declare `mcpServers`, hooks, apps, or a runtime dependency that is not part of the first release.

- [ ] **Step 2: Implement a Node-only public packager.**
  - `scripts/package-public-plugin.mjs` first runs the build, reads root version, deletes/recreates only `plugins/vinea`, then copies `dist/vinea.mjs` to `plugins/vinea/bin/vinea.mjs`, all skills, `README.md`, and `LICENSE`.
  - It writes versioned Codex/Claude manifests to the public tree and creates both marketplace files with source `./plugins/vinea` and the version from root `package.json`.
  - Use `fs.cp`/`fs.rm`, never `rsync`, so the build does not depend on a platform-specific external tool.

- [ ] **Step 3: Implement release checks.**
  - `scripts/check-public-plugin.mjs` checks both manifests exist and match root version, `bin/vinea.mjs` is executable/readable by Node, all eight skills exist, marketplace source paths are correct, and no public text artifact contains `/Users/`, `/home/`, a literal local plugin cache path, or an unresolved scaffold placeholder.
  - It must execute `node plugins/vinea/bin/vinea.mjs --help` and fail if the expected lifecycle commands are absent.

- [ ] **Step 4: Test distribution parity.**
  - Add tests that run `npm run package:plugin`, parse both manifests, compare versions and skills paths, inspect the public skill contract, and invoke the public CLI in a fresh fixture with `init` then `validate`.
  - **Expected result:** the user can install either host plugin from the same committed `plugins/vinea` directory and receives identical CLI semantics.

- [ ] **Step 5: Verify and commit generated output.**
  - Run `npm run package:plugin && npm run check:plugin && npm test -- --run tests/plugin/package.test.ts`.
  - Stage source files plus the regenerated public tree and marketplace manifests.
  - Commit: `feat: package Vinea for Codex and Claude Code`.

### Task 12: Add local developer installation helpers and end-to-end documentation

**Files:**
- Create: `scripts/install-codex-plugin.sh`, `scripts/install-claude-plugin.sh`
- Modify: `README.md`
- Create: `docs/manual-e2e.md`
- Create: `tests/plugin/install-scripts.test.ts`

- [ ] **Step 1: Implement the Codex local-install helper.**
  - Build/package first, sync `plugins/vinea/` into a documented personal marketplace location under `~/.codex/plugins/vinea`, and write a personal marketplace entry using `./.codex/plugins/vinea`.
  - If `codex` is available, invoke its documented marketplace/plugin commands; if unavailable, report the exact files created and manual enablement steps without treating it as successful activation.
  - The helper must print that a new Codex session is required because skills/plugins are not hot-reloaded.

- [ ] **Step 2: Implement the Claude Code local-install helper.**
  - Build/package first, sync the same public tree into `~/.claude/plugins/marketplaces/vinea-local/plugins/vinea`, write the local Claude marketplace manifest, then use `claude plugin validate`, marketplace add/update, and user-scope install when the CLI exists.
  - Keep `${CLAUDE_PLUGIN_ROOT}` literal only inside skill text; do not expand it during package/install.
  - The helper must print new-session activation instructions and never write external credentials.

- [ ] **Step 3: Document install, workflow, and explicit limitations.**
  - `README.md` must show the two install paths, the `vinea:` public skills, `.vinea/` versioning rules, and a concise lifecycle example.
  - Document that first-release recovery is explicit `vinea:orient`; Codex uses `CODEX_THREAD_ID` if it is supplied by the host, while Claude recovery still works by user-confirmed active-task selection when no session ID is available.
  - Document TDD/delegation/long-term learning confirmations, no-MCP/no-daemon constraints, `validate` vs project tests, and both install helpers’ effects.

- [ ] **Step 4: Write the manual two-host acceptance script.**
  - In `docs/manual-e2e.md`, list reproducible steps: install both plugins into a fixture Git repo; create confirmed medium-risk TDD single-agent task in Codex; record red/green evidence; open a new Claude session and invoke `vinea:orient`; confirm the same task; fill check matrix; process business Git changes; archive a non-reusable learning; finish/archive; run `vinea validate`.
  - Include no-hook/manual-orient and delegated-unsupported expected outcomes, plus expected files/results after every milestone.

- [ ] **Step 5: Test helpers without mutating user plugin directories.**
  - Add a static test that shell-parses both scripts, requires `package:plugin`, source `plugins/vinea`, their respective marketplace paths, new-session guidance, and no hard-coded `/Users/` or credentials.
  - Do not execute installers against the developer’s actual home directory in automated tests.

- [ ] **Step 6: Run the full automated release gate and commit.**
  - Run `npm run check` where it expands to `typecheck`, `test`, `package:plugin`, and `check:plugin`; also run `git diff --check`.
  - Commit: `docs: document Vinea installation and cross-host workflow`.

### Task 13: Perform the manual two-host validation and record only observed results

**Files:**
- Modify: `docs/manual-e2e.md` only if an observed command/path differs from the scripted expectation
- Generate only in a disposable fixture repository outside this source tree: `.vinea/**`

- [ ] **Step 1: Prepare isolated fixtures.**
  - Create a temporary Git repository with one small behavior change and a real test command; do not use the Vinea source repository as the consumer fixture.
  - Package the public tree, install/enable both plugins using the documented helpers or host UI, and start fresh host sessions so skills are discovered.

- [ ] **Step 2: Verify Codex task creation and TDD evidence.**
  - From Codex, use `vinea:propose` for the fixture behavior change, accept medium risk + TDD + single-agent, add requirements/context, record a genuinely failing test using `tdd-red`, make the small implementation, then record the passing test using `tdd-green`.
  - Verify the task’s shared facts appear under the fixture’s `.vinea/tasks/active/` and `vinea validate` succeeds.

- [ ] **Step 3: Verify new-session Claude recovery.**
  - Open a fresh Claude Code session in the same fixture repository, invoke `vinea:orient`, confirm the offered active task, and verify task ID/requirements/context/evidence match the Codex-created records.
  - If host-native Claude session identity is absent, verify the documented explicit-confirmation fallback, not a fictitious automatic binding.

- [ ] **Step 4: Verify check, finish, learning, and archive gates.**
  - Use `vinea:check` to cover every requirement with observed evidence; first try a finish failure for an uncovered row or unclassified learning, then resolve it through archive/acceptance.
  - Ensure the fixture’s business change is committed through its own Git workflow, then finish/archive and verify task files moved under `.vinea/tasks/archive/`.

- [ ] **Step 5: Record the result honestly.**
  - Update `docs/manual-e2e.md` only with observed version/host behavior, exact failures, and any remaining manual limitation. Do not claim a host hook, automatic binding, or delegated role execution that was not actually observed.
  - Re-run `npm run check` if documentation changes, then commit: `test: record Vinea cross-host acceptance evidence`.

## Final Verification Checklist

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run package:plugin && npm run check:plugin` passes from a clean checkout.
- [ ] `node plugins/vinea/bin/vinea.mjs --help` succeeds.
- [ ] Both public manifests and both marketplace manifests use the root package version.
- [ ] `npm run check:plugin` confirms that generated public artifacts have no local absolute paths or unresolved scaffold placeholders.
- [ ] A fixture proves Codex-created task state can be explicitly selected and continued in a fresh Claude session.
- [ ] A TDD task cannot finish without ordered red/green evidence; an uncovered requirement or business dirty file blocks finish.
- [ ] Learning reaches `.vinea/specs/` only after an explicit acceptance command, while non-reusable items remain in the archived task.
