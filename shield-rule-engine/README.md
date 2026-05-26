# Shield Rule Engine

Real-time multi-tenant fraud-rule engine. Risk users author rules in a
human-readable DSL through the admin UI; rules are compiled to a safe IR and
evaluated server-side on every authorization within a 300 ms SLA.

See [`docs/REQUIREMENTS.md`](./docs/REQUIREMENTS.md),
[`docs/SPEC.md`](./docs/SPEC.md), and [`docs/PLAN.md`](./docs/PLAN.md).

## Workspace

- `packages/domain` — pure DSL: tokenize, parse, validate, compile, evaluate.
- `packages/use-cases` — Integrations only; orchestrate ports + domain.
- `packages/ports` — interface definitions for infrastructure boundaries.
- `packages/adapters-fs` — filesystem-backed `RuleRepo`, `Audit`, `RulesetEvents` (v1).
- `packages/adapters-memory` — in-process `RulesetCache`, `VelocityStore` (v1).
- `packages/adapters-pg`, `packages/adapters-redis` — reserved slots for future swaps.
- `packages/shared` — small cross-package primitives (logger, ids, time, result).
- `apps/shield-admin` — SvelteKit UI + management API.
- `apps/shield-eval` — Fastify evaluation service (300 ms SLA).

## Develop

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm format
```

## Architecture

The codebase follows the **Integration / Operation Segregation Principle**
(IOSP). Every function is either:

- an **Operation** — contains logic but does not call other business
  functions; leaf node; preferably pure.
- an **Integration** — composes Operations in a flat sequence; no `if`,
  no `switch`, no loops.

Domain code (`packages/domain`) never imports infrastructure. Use cases
(`packages/use-cases`) depend on **ports**, not concrete adapters. Adapter
selection happens in each app's composition root and nowhere else.
