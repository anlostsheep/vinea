---
name: check
description: Use when the user explicitly requests Vinea to assess a task against acceptance criteria, without authorizing fixes to business code.
---

# Vinea Check

Public entry: `vinea:check`.

Resolve `<plugin-root>` by removing `/skills/check/SKILL.md` from this file; Claude Code may use `${CLAUDE_PLUGIN_ROOT}`. Use `node <plugin-root>/bin/vinea.mjs` from the target worktree. Read [CLI.md](../../CLI.md) for evidence and check payloads.

Check the current contract against selected, recoverable inputs. Use project-native verification where appropriate; Vinea's optional runner is not mandatory. Declare evidence as command-runner, agent-report or user-observation truthfully. Existing passing evidence can support a conclusion only when contract version, snapshot, actual command and relevant environment still match.

Report each acceptance criterion as pass, fail, unverified or an explicitly user-accepted gap. A gap is never a pass. If recording an independent check, use this assessor's own evidence, not relabeled implementation evidence. Independence is an explicit intent, not a mandatory second agent.

Do not edit business code or silently transition into repair. Verification commands may write caches or fixtures: inspect their side effects and obtain appropriate authority before executing them. `persist=false` permits no Vinea writes and no invocation of Vinea's runner. Return failures and evidence boundaries; a later explicit debug request may authorize a repair. Internal self-checking during an already authorized run can repair within its existing scope.
