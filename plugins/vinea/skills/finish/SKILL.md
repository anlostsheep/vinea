---
name: finish
description: Use when the user explicitly asks Vinea to deliver a task with acceptance evidence and clearly identified remaining gaps.
---

# Vinea Finish

Public entry: `vinea:finish`.

Stay within the selected Vinea workflow unless the user explicitly chooses another workflow framework. Similar skill names, task stages and copied plan headers do not authorize a switch or addition. Task-specific tools and domain skills remain available within the existing authorization.

Resolve `<plugin-root>` by removing `/skills/finish/SKILL.md` from this file; Claude Code may use `${CLAUDE_PLUGIN_ROOT}`. Use `node <plugin-root>/bin/vinea.mjs` in the target worktree. Read [CLI.md](../../CLI.md) for delivery operations.

As the current responsible owner, identify the exact delivery inputs and relevant integrated contributions. Verify current acceptance coverage, command and environment conditions, and recorded exceptions. Failed or unverified checks must be resolved or explicitly accounted for; never silently omit a current failure. Preserve accepted gaps as gaps, and for a TDD contract require genuine ordered RED then GREEN evidence.

Capture recoverable selected inputs even if business changes are uncommitted. Do not require an unrelated clean-worktree gate or automatically commit, push, deploy or archive. Submitted contributions are not integrated until the owner records that decision. Task delivery and user acceptance are separate records; only an actual user acceptance may be recorded as such.

Deliver the result, verification and limitations. A defect found by this standalone entry does not expand its authority into repair; use already authorized development or an explicit debug request. Post-delivery repair opens a related task and leaves original evidence unchanged. Reusable learning, additional reviewers and archive are optional, not completion gates.
