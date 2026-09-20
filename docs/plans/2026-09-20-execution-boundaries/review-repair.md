# Independent Review Repair

## Brief

The user authorized reproduction and treatment of the Grok review findings.
Repair task: `e9beac4e-13b6-4098-8c2b-559fed2d94be`, linked to delivery
`512b8143-0c07-4d50-a088-ef511a9b066f`. The original delivery and its evidence
remain frozen. Use the selected installed 1.0.1 coordinator only for this local
repair; exercise the candidate protocol in disposable fixtures.

Scope: restoration versus suspension/contract revision, planning integrity on
cached-token paths, replayed authorization results, pre-protocol readiness, and
documentation accuracy. No host enforcement, automatic migration, commit, push,
publication, plugin installation or changes to the AI portal repositories.

## Plan

1. Add deterministic failing regression tests for concurrent restoration and
   revocation, then for cached-token contribution/snapshot/delivery operations.
2. Record the failing tests against a pre-repair snapshot before changing source.
3. Repair confirmed paths; preserve interrupted recovery and historical evidence.
4. Test authorization replay and old-protocol readiness before treating them as
   defects. Distinguish real behavior gaps from documentation wording.
5. Run focused RED-to-GREEN and the complete typecheck/test/package checks.
   Document actual coverage and remaining host-level limits separately.

Acceptance: no restoration write after an effective revocation; partial recovery
remains retryable only while its reservation and authorization are valid; damaged
planning blocks all cached-token protocol operations; revoked authorization never
returns as a successful usable grant; unsupported active tasks are not ready.
