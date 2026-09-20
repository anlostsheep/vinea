# Planning and Execution Boundaries

## Goal

Prevent a planning conversation from becoming writable solely because an agent
changes its declared entry to `run`. Make planning deliverables, execution
requests, protocol identity and stopped ownership inspectable kernel facts.

## Scope and Authority

The user approved implementation on 2026-09-20 after agreeing to kernel, CLI,
skill and regression changes. This does not authorize host enforcement,
automatic migration, installation, commit, push or publication. Existing local
task records and the two AI portal repositories must remain untouched.

This implementation is coordinated by the installed 1.0.1 CLI under task
`df1170cb-9f90-419a-a725-6f6a0300a7ed`. The new protocol is tested in disposable
fixtures, not by upgrading the live store managing this change.

## Acceptance

- A1: Persistent explicit planning stores readable brief and plan artifacts
  tied to the current contract. Required missing or stale artifacts block work.
- A2: Entry selection and a contract grant are insufficient for business writes.
  A separate execution request records the user's words and an actual reference;
  continuation and plan approval are not implementation requests.
- A3: New tasks pin their protocol; older tasks remain readable without silent
  migration or newly inferred execution authority.
- A4: Suspending execution revokes authorization and fences old tokens. Unknown
  remote writers remain held; bookkeeping never pretends to stop a process.
- A5: Public documentation, skills and regression tests describe the same rules,
  including the limits of caller-supplied authorization records.

## Non-goals and Limits

No fixed brainstorm-plan-run ceremony for already authorized small work. No
language-model intent classifier, authentication service, hook or sandbox.
Provenance is caller-reported, not proof of genuine user approval. An actor with
arbitrary filesystem access can still bypass the CLI. Historical incident logs
and credentials are not copied into the repository.
