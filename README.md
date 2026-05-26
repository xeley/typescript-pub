# TypeScript-Pub

A collection of public TypeScript projects.

## Projects

### [`shield-rule-engine`](./shield-rule-engine)

A real-time, multi-tenant fraud-rule engine. Risk analysts author rules in a
human-readable DSL through an admin UI; rules are compiled to a safe IR and
evaluated server-side on every authorization within a 300 ms SLA.

Built as a pnpm monorepo (SvelteKit admin + Fastify evaluator) following the
**Integration / Operation Segregation Principle** (IOSP) — domain code stays
pure, infrastructure is reached only through ports.

See the project's [README](./shield-rule-engine/README.md) for the
screenshot, workspace layout, development commands, architecture details,
and the agent-driven SDLC story.
