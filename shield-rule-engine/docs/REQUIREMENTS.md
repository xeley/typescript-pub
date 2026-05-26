# Shield Rule Engine — Requirements

## Overview

Design a **real-time Shield rule engine** where fraud/risk users define
human-readable rules in the UI. Those rules are compiled and safely published,
then evaluated server-side on every authorization request within a strict
**300 ms SLA**.

## Goals

- Empower fraud/risk users to author rules without engineering involvement.
- Compile authored rules into a safe, executable form before publishing.
- Evaluate every authorization request against the active ruleset in real time.
- Stay within a hard end-to-end budget of **300 ms** per authorization decision.

## Rule Language (Examples)

Rules are expressed in a human-readable DSL. Indicative examples:

```text
IF MCC in {5999, 4829} AND country != US THEN DECLINE
IF CVV failed AND card_not_present       THEN LOCK
IF count(card, 10 min) > 5               THEN WARM
```

Supported decision actions (initial set): `DECLINE`, `LOCK`, `WARM`.

## System Shape

```text
UI  ->  APIs  ->  Schema (storage / compiled ruleset)
```

- **UI** — rule authoring, validation, publish workflow.
- **APIs** — rule management (CRUD, compile, publish) and authorization
  evaluation endpoint.
- **Schema** — persistence of source rules and the compiled, published
  ruleset used at evaluation time.

## Non-Functional Requirements

- **Performance:** authorization evaluation must complete within **300 ms**
  (server-side, end-to-end).
- **Multi-tenancy:** support **~100 client tenants** with isolated rules and
  data.
- **Platform independence:** the engine must not be tied to a specific cloud,
  OS, or runtime environment.
- **Safety:** rule compilation must prevent unsafe or runaway expressions
  from reaching production evaluation.

## Open Questions (to confirm with client)

- Full list of supported fields (e.g. `MCC`, `country`, `CVV`, `card_not_present`)
  and aggregate functions (e.g. `count(card, window)`).
- Full list of decision actions beyond `DECLINE`, `LOCK`, `WARM`.
- Audit / versioning expectations for published rulesets.
- Rollback strategy when a newly published ruleset misbehaves.
