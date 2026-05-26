# Shield Rule Engine — Implementation Plan

> Implementation plan derived from [`REQUIREMENTS.md`](./REQUIREMENTS.md) and
> [`SPEC.md`](./SPEC.md). The structure follows Ralf Westphal's **IOSP**
> (Integration / Operation Segregation Principle): every function is either an
> **Integration** (sequence of calls, no logic) or an **Operation** (logic,
> no calls into other business functions). Domain code never reaches into
> infrastructure; infrastructure is called from the Integration stratum and
> its results are handed down to Domain Operations.

---

## 1. Stack at a glance

| Concern              | Choice                                     | Why                                                              |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| Admin UI             | **SvelteKit** (Svelte 5 + runes)           | Component model fits stratification; SSR + routing.              |
| Auth-eval API        | **Node.js + Fastify**                      | Tiny, fast, predictable latency for the 300 ms SLA.              |
| Management API       | **SvelteKit endpoints** (same app)         | Co-located with UI; not on the hot path.                         |
| Language             | **TypeScript** everywhere                  | Same domain code shared by UI and services.                      |
| Persistence          | **JSON files on disk** (port; DB later)    | Zero infra for v1; everything is `data/**/*.json` you can `cat`. |
| Hot cache / velocity | **In-memory** (port; Redis adapter later)  | Zero new infra for v1; ports keep Domain unaware of the swap.    |
| Cross-process events | **File-watch on append-only JSONL** (port) | No broker, no DB. `chokidar` handles cross-platform watching.    |
| Packaging            | **OCI container** per service              | Platform independence (`SPEC.md` § Platform).                    |
| Build / workspace    | **pnpm workspaces** monorepo               | Share `domain` + `use-cases` across services and UI.             |

V1 runtime requirements collapse to: **Node.js + a writable directory.** No
Postgres, no Redis, no broker. That makes "platform independence" (`SPEC.md`)
trivially true — it runs anywhere `node` and a filesystem exist.

Two deployables, not one:

- `apps/shield-admin` — SvelteKit app: UI + management API (CRUD, compile, publish).
- `apps/shield-eval` — Fastify service: only the authorization evaluation endpoint, tuned for the 300 ms SLA.

This split is deliberate: SSR/UI workloads never share a runtime with the
latency-critical evaluator. Both processes share the same `DATA_DIR` (mounted
volume, network share, or just a local folder).

---

## 2. Stratification (IOSP)

Four strata, top → bottom. Higher strata may call lower strata; lower strata
never call up.

```text
┌─────────────────────────────────────────────────────────────┐
│  Stratum 4 — Delivery (Integrations)                        │
│  SvelteKit routes, Svelte pages, Fastify handlers           │
├─────────────────────────────────────────────────────────────┤
│  Stratum 3 — Use cases (Integrations)                       │
│  validateRule, compileRuleset, publishRuleset, evaluateAuth │
├─────────────────────────────────────────────────────────────┤
│  Stratum 2 — Domain (Operations, pure)                      │
│  tokenize, parse, validate, compile, evaluate, selectDecision│
├─────────────────────────────────────────────────────────────┤
│  Stratum 1 — Adapters behind Ports (Operations, infra leaves)│
│  fsRuleRepo, memoryRulesetCache, memoryVelocityStore,       │
│  fsRulesetEvents, clock                                     │
└─────────────────────────────────────────────────────────────┘
```

Rules:

- **Stratum 2** has zero imports from Stratum 1 or 4. Pure functions only.
- **Stratum 3** Integrations contain no `if`, no `switch`, no loops — only a
  sequence of calls. Any branching/looping is pushed down into an Operation.
- **Stratum 1** adapter functions are themselves Operations from the caller's
  point of view: each one does one I/O thing and returns data. Use cases
  depend on **port interfaces**, not concrete adapters (see § 6).
- **Stratum 4** handlers are Integrations: parse request → call use case →
  format response. Validation/branching belongs to Operations they call.

---

## 3. Monorepo layout

```text
shield-rule-engine/
├── apps/
│   ├── shield-admin/           # SvelteKit (UI + management API)
│   └── shield-eval/            # Fastify (auth eval endpoint)
├── packages/
│   ├── domain/                 # Stratum 2 — pure
│   │   ├── dsl/                #   tokenize, parse, validate
│   │   ├── compile/            #   AST → CompiledRuleset (data, not code)
│   │   ├── evaluate/           #   evaluate(ctx, ruleset) → Decision
│   │   └── types/              #   Rule, AST, CompiledRuleset, Decision
│   ├── use-cases/              # Stratum 3 — integrations only
│   │   ├── validateRule.ts
│   │   ├── compileRuleset.ts
│   │   ├── publishRuleset.ts
│   │   └── evaluateAuth.ts
│   ├── ports/                  # interfaces (RuleRepo, RulesetCache, ...)
│   ├── adapters-fs/            # Stratum 1 — filesystem JSON impls (v1)
│   ├── adapters-memory/        # Stratum 1 — in-process impls (v1)
│   ├── adapters-pg/            # Stratum 1 — PostgreSQL impls (v2, later)
│   ├── adapters-redis/         # Stratum 1 — Redis impls (v2, later)
│   └── shared/                 # logger, ids, time, result types
└── docs/                       # REQUIREMENTS.md, SPEC.md, PLAN.md, ADRs
```

`adapters-pg/` and `adapters-redis/` are intentionally listed but **empty for
v1** — the directories and their `package.json` files reserve the slots so
the swaps in § 6 stay config changes, not refactors.

---

## 4. Domain (Stratum 2) — the heart

All pure, all unit-testable without I/O.

**DSL pipeline (each step is an Operation, returns `{value, errors}`):**

```text
source: string
  → tokenize(source)            → Tokens
  → parse(tokens)               → AST
  → validate(ast, whitelist)    → ValidatedAST
  → compile(validatedAst)       → CompiledRule       (JSON-serializable IR)
```

The `CompiledRule` is **data**, not code — a tagged tree like:

```json
{
  "if": { "and": [{ "in": ["MCC", [5999, 4829]] }, { "neq": ["country", "US"] }] },
  "then": "DECLINE"
}
```

This is the "safely published" form: no `eval`, no dynamic code; the evaluator
walks the tree. It is trivially portable across runtimes — directly serves the
**Platform independence** requirement. It is also literally what gets written
to disk by the v1 file-based adapter (see § 8).

**Evaluation (Operation):**

```text
evaluate(ctx: AuthContext, ruleset: CompiledRuleset) → Decision
```

`AuthContext` is a plain object: `{ mcc, country, cvv, cardNotPresent,
cardId, velocityCounts, now }`. Velocity counts are passed **in** — the
evaluator does not fetch anything. That keeps Domain pure and lets the
Integration decide what to fetch and when.

**Action defaulting (Operation):**

```text
selectDecision(matches: Decision[], failSafe: Action) → Decision
```

Implements "first matching rule wins, otherwise APPROVE" (or whatever the
client confirms — see `REQUIREMENTS.md` Open Questions).

---

## 5. Use cases (Stratum 3) — Integrations only

Each use case is a flat sequence of calls. No `if`, no loops. Examples:

**`validateRule(source)`**

```ts
// pseudocode — no branching, no loops
const tokens = tokenize(source);
const ast = parse(tokens);
const validated = validate(ast, whitelist);
const compiled = compile(validated);
return toValidationResult(tokens, ast, validated, compiled);
```

`toValidationResult` is an Operation that aggregates errors from each step.
The Integration itself never inspects errors.

**`compileRuleset({ tenantId, version })`**

```ts
const draft = ruleRepo.loadDraft(tenantId, version);
const compiled = compileAll(draft.rules); // Operation; loop lives here
const safety = checkSafety(compiled, safetyPolicy); // Operation
ruleRepo.saveCompiled(tenantId, version, compiled, safety);
return toCompileResult(compiled, safety);
```

**`publishRuleset({ tenantId, version })`**

```ts
const compiled = ruleRepo.loadCompiled(tenantId, version);
const previous = ruleRepo.activeVersion(tenantId);
ruleRepo.markActive(tenantId, version);
rulesetEvents.publish({ type: "ruleset.published", tenantId, version });
audit.recordPublish(tenantId, previous, version);
return { active: version, previous };
```

Note: `publishRuleset` does **not** call `rulesetCache.invalidate` directly,
because the cache it would invalidate lives in another process (the eval
service). Instead it emits a `ruleset.published` event via the
`RulesetEvents` port. Each eval instance has a subscriber that invokes its
own local `rulesetCache.invalidate(tenantId)`. See § 6.

**`evaluateAuth(request)` — the hot path**

```ts
const ruleset = rulesetCache.getOrLoad(tenant); // adapter Operation
const counts = velocityStore.fetchFor(request); // adapter Operation
const ctx = buildContext(request, counts, clock.now()); // Operation
const matches = evaluate(ctx, ruleset); // Domain Operation
const decision = selectDecision(matches, failSafe); // Domain Operation
audit.recordEvaluation(decision, ctx); // fire-and-forget adapter
return decision;
```

SLA enforcement is itself an Integration wrapping `evaluateAuth`:

```ts
const raced = raceWithDeadline(evaluateAuth(req), sla.ms);
const decision = pickDecision(raced, failSafeOnTimeout); // Operation
return decision;
```

---

## 6. Ports & adapters (swap-by-config)

Infrastructure is reached **only** through narrow TypeScript interfaces
("ports") defined in `packages/ports`. The v1 implementations live in
`packages/adapters-fs` (durable storage) and `packages/adapters-memory`
(hot cache + velocity). DB- and Redis-backed adapters land later as
`packages/adapters-pg` and `packages/adapters-redis`, and slot in via
configuration without touching the Domain or Use-case strata.

### Port interfaces

```ts
// packages/ports/rule-repo.ts
export interface RuleRepo {
  loadDraft(tenantId: string, version: number): Promise<Draft>;
  saveDraft(tenantId: string, version: number, rules: Rule[]): Promise<void>;
  loadCompiled(tenantId: string, version: number): Promise<CompiledRuleset>;
  saveCompiled(
    tenantId: string,
    version: number,
    ir: CompiledRuleset,
    safety: SafetyReport,
  ): Promise<void>;
  markActive(tenantId: string, version: number): Promise<void>;
  activeVersion(tenantId: string): Promise<number | null>;
}

// packages/ports/ruleset-cache.ts
export interface RulesetCache {
  getOrLoad(tenantId: string): Promise<CompiledRuleset>;
  invalidate(tenantId: string): Promise<void>;
}

// packages/ports/velocity-store.ts
export interface VelocityStore {
  fetchFor(req: AuthRequest): Promise<VelocityCounts>;
  incrementOnDecision(req: AuthRequest, d: Decision): Promise<void>;
}

// packages/ports/ruleset-events.ts
export interface RulesetEvents {
  publish(event: RulesetPublishedEvent): Promise<void>;
  subscribe(onEvent: (e: RulesetPublishedEvent) => void): Unsubscribe;
}

// packages/ports/audit.ts
export interface Audit {
  recordPublish(tenantId: string, from: number | null, to: number): Promise<void>;
  recordEvaluation(decision: Decision, ctx: AuthContext): Promise<void>;
}
```

### v1 adapters (filesystem + in-memory)

| Port            | v1 adapter                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `RuleRepo`      | `adapters-fs` — JSON files under `DATA_DIR`; atomic temp-file-then-rename writes (see § 8)        |
| `Audit`         | `adapters-fs` — append-only JSONL files per tenant                                                |
| `RulesetEvents` | `adapters-fs` — append a JSON line to `data/events/ruleset.jsonl`; `chokidar` watches it for subs |
| `RulesetCache`  | `adapters-memory` — process-local `Map<tenantId, CompiledRuleset>` with LRU eviction              |
| `VelocityStore` | `adapters-memory` — process-local sliding-window counters in a `Map` with bucketed expiry         |

Each eval instance owns its own cache and velocity counters. On
`ruleset.published`, every subscribed eval instance independently calls
`rulesetCache.invalidate(tenantId)`. Next eval request for that tenant
re-loads from `RuleRepo` (which is a JSON read off disk in v1).

### v2 adapters (DB / Redis), when scale or ops demand them

Drop in `packages/adapters-pg` (or SQLite, MySQL, whatever the client
operates) providing `RuleRepo`, `Audit`, and `RulesetEvents` (via
`LISTEN/NOTIFY`). Drop in `packages/adapters-redis` providing
`RulesetCache`, `VelocityStore`, and optionally `RulesetEvents` via pub/sub.
Selection happens in **each app's composition root** — the only file in
either app that names a concrete adapter:

```ts
// apps/shield-eval/src/composition.ts
import { createFsRuleRepo, createFsRulesetEvents } from "@shield/adapters-fs";
import { createMemoryRulesetCache, createMemoryVelocityStore } from "@shield/adapters-memory";
// import { createPgRuleRepo } from '@shield/adapters-pg';        // v2
// import { createRedisRulesetCache } from '@shield/adapters-redis'; // v2

export function wire(config: Config): Deps {
  const repo =
    config.storage.driver === "pg"
      ? createFsRuleRepo(config.storage.fs) // swap to createPgRuleRepo later
      : createFsRuleRepo(config.storage.fs);

  const cache =
    config.cache.driver === "redis"
      ? createMemoryRulesetCache(config.cache.memory)
      : createMemoryRulesetCache(config.cache.memory);

  // ...
}
```

Everything above this file — Use cases, Domain, components — is unchanged
when DB or Redis adapters are introduced. The IOSP boundary holds.

### Known v1 limitations (intentional, scoped)

| Limit                                                          | Trigger to upgrade                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| Per-instance velocity counters under-count across N eval nodes | Need more than 1 eval instance → ship `adapters-redis`              |
| Filesystem writes are not transactional across files           | Multiple concurrent admin writers → ship `adapters-pg`              |
| No ad-hoc query of audit log                                   | Compliance / analytics need SQL → ship `adapters-pg` for Audit only |
| Two admin replicas could race on `markActive`                  | Run a single admin instance for v1, document it                     |

---

## 7. Hot-path latency budget (300 ms)

Indicative target split (server-side, end-to-end, p99):

| Step                                  |     Budget |
| ------------------------------------- | ---------: |
| Network in + parse                    |      10 ms |
| Auth + tenant resolution              |       5 ms |
| Load active ruleset (in-memory, warm) |       1 ms |
| Fetch velocity counters (in-memory)   |       1 ms |
| Build context                         |       1 ms |
| Evaluate compiled ruleset             |      10 ms |
| Audit emit (async, off-budget)        |       0 ms |
| Serialize + network out               |      10 ms |
| **Headroom**                          | **262 ms** |

On the hot path there is **no disk I/O** — the cache is in memory. Disk I/O
only happens on:

- Cold start (warm top-N tenants from JSON files on boot).
- Cache miss for an inactive tenant (synchronous JSON read + `WARN` log).
- Publish (admin appends one JSONL line + writes one `active.json`).
- Audit emit (off-budget; batched async append).

Hard rules to keep the budget real:

- Active ruleset is always served from the in-memory cache.
- No JSON file read on the hot path. The `RuleRepo` is touched on cold miss
  only, and cold misses are logged + counted.
- Velocity counters use bucketed in-memory maps with cheap expiry, not scans.

---

## 8. Data model (filesystem layout)

V1 stores all state as plain files under a configurable `DATA_DIR` (default
`./data/`). Everything is human-readable JSON / JSONL — you can debug a
tenant by `cat`ing files.

```text
data/
├── tenants/
│   ├── <tenantId>/
│   │   ├── tenant.json                     # { id, name, createdAt }
│   │   ├── users/
│   │   │   └── <userId>.json               # { id, email, role }
│   │   ├── rulesets/
│   │   │   └── <version>/
│   │   │       ├── meta.json               # { version, status, createdBy, createdAt }
│   │   │       ├── draft.json              # [{ id, source, position }]
│   │   │       ├── compiled.json           # CompiledRuleset IR (see § 4)
│   │   │       └── safety.json             # SafetyReport
│   │   ├── active.json                     # { version, since, actor }
│   │   └── audit/
│   │       ├── publishes.jsonl             # 1 line per publish event
│   │       └── evaluations.jsonl           # 1 line per auth decision (rotated)
│   └── ...
└── events/
    └── ruleset.jsonl                       # append-only cross-process event log
```

In-process keyspace (per eval instance, behind `RulesetCache` /
`VelocityStore` ports — shape is deliberately broker-compatible so the v2
adapter is a straight port):

```text
ruleset:active:{tenantId}                       → CompiledRuleset (object ref)
velocity:card:{tenantId}:{cardId}:{bucketMin}   → counter (entry TTL = window + slack)
```

### Write rules (atomicity)

All file writes go through one shared `writeJsonAtomic(path, value)`
Operation:

1. Serialize to JSON.
2. Write to `path + '.tmp'` (`fs.writeFile`).
3. `fs.rename` over the destination (atomic on POSIX; same-volume on
   Windows).

Append-only logs (`*.jsonl`, `events/ruleset.jsonl`) use `fs.appendFile`
with one JSON object per line (no enclosing array). This keeps appends cheap
and the file always-parseable line-by-line, even if a writer crashes
mid-line (last partial line is discarded by the reader).

### `RulesetEvents` over file-watch

- **publish:** admin calls `fs.appendFile('data/events/ruleset.jsonl',
JSON.stringify(event) + '\n')`.
- **subscribe:** eval starts a `chokidar` watcher on `data/events/`. On
  change, reads from the last known byte offset to EOF, parses each new
  line, invokes the callback. Offset is persisted to
  `data/events/.cursor-<instanceId>.json` so a restart resumes cleanly.
- **on subscriber restart:** before catching up, invalidate **all** cached
  tenants once (cheap; just drops the `Map`) to guarantee we never serve
  stale rules after a missed event.

### Optional bridge to "real DB"

If JSON-on-disk feels too loose before Phase 9, the same `adapters-fs`
shape works with **SQLite** (single file, no server) as a drop-in: same
ports, just a different storage encoding. SQLite is mentioned only as an
option — v1 ships JSON unless the client asks otherwise.

---

## 9. SvelteKit admin app

### Routes

```text
/login
/t/[tenant]/rules                # list draft rules
/t/[tenant]/rules/[id]           # edit one rule (DSL editor + live validation)
/t/[tenant]/rulesets             # versions list, diff, publish controls
/t/[tenant]/rulesets/[v]         # ruleset detail
/t/[tenant]/audit                # publish & evaluation audit
```

### Component stratification

Components mirror the IOSP split:

- **Operation components** (pure, no fetch, no stores): `<ValidationBadge>`,
  `<DiffView>`, `<RuleSourceHighlighter>`, `<DecisionBadge>`.
- **Integration components** (compose Operations + call API client + bind
  stores): `<RuleEditor>`, `<PublishControls>`, `<VersionList>`,
  `<RulesetDetail>`.
- **Route files** (`+page.svelte`, `+page.server.ts`) are Integrations:
  load data via use cases, hand it to integration components.

### Stores (Svelte 5 runes)

- `currentRuleset` — active editing target.
- `validationState` — derived rune from latest `validateRule` result.
- `publishState` — pending / success / failure of last publish.

The DSL editor uses CodeMirror 6 with a Lezer grammar generated from the same
DSL spec the backend parses — single source of truth for syntax.

### API client

Plain Operations wrapping `fetch`, one per endpoint:

```ts
api.validateRule(source)            → ValidationResult
api.saveDraft(tenant, version, rules)
api.compileRuleset(tenant, version) → CompileResult
api.publishRuleset(tenant, version) → PublishResult
api.listVersions(tenant)            → Version[]
```

Components never call `fetch` directly; they call the client.

---

## 10. Auth-eval service (Fastify)

Endpoints:

```text
POST /v1/evaluate         # the 300 ms hot path
GET  /v1/health
GET  /v1/ready            # confirms DATA_DIR is readable + a probe load succeeds
```

Routing handler is a 5-line Integration that calls `evaluateAuthWithSla`.

Startup behavior:

- Calls `rulesetEvents.subscribe(...)` (v1: `chokidar` watch on
  `data/events/ruleset.jsonl`) and invokes `rulesetCache.invalidate(tenantId)`
  on each event — no cold miss after a publish.
- On subscriber start (including reconnect / restart), invalidates **all**
  cached tenants once before consuming events, to guarantee correctness
  after any missed window.
- Optionally warms the cache for the top-N most active tenants from
  `RuleRepo.activeVersion` on boot.
- Exposes Prometheus metrics: latency histogram, decision counters per
  tenant, SLA-timeout counter, cache-miss counter, event-lag gauge.

---

## 11. Multi-tenancy

- `tenantId` is a directory name under `data/tenants/` in v1 (and would be a
  column / key prefix in v2 DB / Redis adapters).
- `tenantId` is resolved from the auth token at the edge (admin app) or from
  a signed header from the issuer (eval service) and **passed explicitly**
  into every use case — never read from a global.
- Path-construction Operations in `adapters-fs` always concatenate via a
  `tenantPath(tenantId, ...rest)` helper that asserts no `..` segments —
  prevents one tenant from reading another tenant's files even if a bug
  passes a hostile `tenantId` upstream.
- Tests assert isolation by running two tenants side-by-side in the same
  process and checking neither can see the other's rules.

---

## 12. Roadmap (phased)

Each phase is shippable and adds capability.

**Phase 0 — Foundations (1–2 days)**

- pnpm workspace, TS config, lint, format.
- Empty `domain`, `use-cases`, `ports`, `adapters-fs`, `adapters-memory`,
  `adapters-pg` (placeholder), `adapters-redis` (placeholder), `apps/*`
  packages.
- CI: build + unit tests.

**Phase 1 — Domain core (3–5 days)**

- DSL: tokenize, parse, validate, compile (covers the three example rules).
- Evaluator over compiled IR.
- 100% unit tests in `packages/domain` — no I/O.

**Phase 2 — Persistence (filesystem) + use cases (3–5 days)**

- `adapters-fs`: `fsRuleRepo`, `fsAudit`, `fsRulesetEvents` with atomic
  writes and `chokidar`-based subscriber.
- `writeJsonAtomic` Operation + path-safety helper.
- Use cases: `validateRule`, `compileRuleset`, `publishRuleset`.
- Use-case tests against an in-memory fake `RuleRepo` from `adapters-memory`
  and an integration test against the real `fsRuleRepo` in a temp dir.

**Phase 3 — Admin UI (5–7 days)**

- SvelteKit app + auth.
- Rule editor with live `validateRule` round-trip.
- Versions list + publish flow + diff view.
- Publish emits `ruleset.published` via `fsRulesetEvents`.

**Phase 4 — Eval service + SLA (3–5 days)**

- Fastify service.
- `adapters-memory` for `RulesetCache` + `VelocityStore`.
- `adapters-fs` for `RulesetEvents` (subscribe + invalidate on publish).
- `evaluateAuth` use case + SLA wrapper + fail-safe.
- Load test against `SPEC.md` § 300 ms SLA scenarios.

**Phase 5 — Multi-tenant hardening (2–3 days)**

- Tenant resolution, filesystem path isolation tests, per-tenant rate limits.

**Phase 6 — Observability + audit (2–3 days)**

- Structured logs, metrics, traces.
- Audit log rotation (size + age) for `evaluations.jsonl`.
- Publish/rollback UI surfaces audit.

**Phase 7 — Packaging (1–2 days)**

- OCI images for both apps.
- Helm chart or plain Compose; `DATA_DIR` mounted as a volume.
- No cloud-specific SDKs.

**Phase 8 (later, on demand) — Redis adapters**

- Implement `adapters-redis` for `RulesetCache`, `VelocityStore`, and
  (optionally) `RulesetEvents`.
- Add `cache.driver=redis` config branch in each app's composition root.
- Re-run Phase 4 load tests to validate cross-instance velocity correctness.

**Phase 9 (later, on demand) — Database adapter**

- Implement `adapters-pg` (or SQLite as a stepping stone) for `RuleRepo`,
  `Audit`, and `RulesetEvents` (`LISTEN/NOTIFY`).
- Add `storage.driver=pg` config branch.
- One-time migration tool: walks `DATA_DIR` JSON tree → inserts into DB.
- After cut-over, JSON files become the backup format.

---

## 13. Risks & mitigations

| Risk                                                           | Mitigation                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| DSL surface area grows and parser becomes a mess               | Keep grammar in one file; reject anything outside whitelist.                     |
| Compiled IR change breaks active rulesets                      | `compiler_version` on every artifact; recompile on version bump.                 |
| Eval p99 drifts above 300 ms                                   | Latency histogram + SLO alert; SLA wrapper enforces fail-safe.                   |
| **Per-instance velocity counters under-count across N nodes**  | Single eval instance OR sticky-by-`cardId` LB for v1; ship Redis adapter.        |
| **In-memory cache lost on restart (cold-start latency spike)** | Warm top-N tenants on boot; cache miss logged + counted as `WARN`.               |
| **`chokidar` misses events on some filesystems (NFS, SMB)**    | On subscriber start/reconnect, invalidate all tenants once before catching up.   |
| **Append-only audit logs grow without bound**                  | Phase 6 rotation by size/age; archive rotated files alongside JSON state.        |
| **Concurrent admin writers race on `markActive`**              | v1: single admin instance, documented; v2: `adapters-pg` for transactional swap. |
| **Filesystem permissions are the only tenant isolation layer** | `tenantPath` helper rejects `..` segments; integration tests assert isolation.   |
| One tenant's bad rule starves others                           | Per-tenant eval CPU budget, circuit-break tenants over budget.                   |
| "Safe compilation" not actually safe                           | No `eval`/`Function`; IR is data; fuzz the compiler.                             |

---

## 14. Things to confirm with the client before Phase 1

(Carried over from `REQUIREMENTS.md` Open Questions, plus plan-level items.)

- Full field whitelist and aggregate function set.
- Full action set beyond `DECLINE`, `LOCK`, `WARM`; default action when no rule matches.
- Fail-safe decision on SLA timeout (`APPROVE`? `DECLINE`? configurable per tenant?).
- Expected peak TPS per tenant and globally (drives Phase 4 load targets and
  the trigger thresholds for Phase 8 Redis / Phase 9 DB adapters).
- Where `DATA_DIR` will live in the target environment (local disk, mounted
  volume, network share) and the backup/retention policy for it.
- Retention period for audit logs (compliance vs storage cost).
