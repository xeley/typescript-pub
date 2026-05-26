# shield-demo

End-to-end CLI demo of the Shield Rule Engine. Boots a real `shield-eval`
Fastify server in-process, seeds a fresh `DATA_DIR`, publishes a ruleset
through the use cases, then drives the running server with real HTTP
requests covering every decision path (`APPROVE` / `DECLINE` / `LOCK` /
`WARM`) and a cross-process cache-invalidation scenario.

It exists to prove the architecture works without a browser, without
manual setup, and without leaving any state behind.

## About the project

The Shield Rule Engine is a multi-tenant fraud-rule platform: risk
users author rules in a human-readable DSL through an admin UI, the rules
are compiled to a safe JSON IR, and a separate evaluation service serves
authorization decisions within a 300 ms SLA.

The codebase follows Ralf Westphal's **IOSP** (Integration / Operation
Segregation Principle) and a ports-and-adapters layout. v1 ships with
filesystem JSON persistence and in-memory cache/velocity — Redis and
Postgres adapters slot in later behind the same ports.

For the full picture see the root [`README.md`](../../README.md) and the
planning docs under [`docs/`](../../docs/) (`REQUIREMENTS.md`, `SPEC.md`,
`PLAN.md`).

## What the demo does

In order, the demo:

1. Creates a fresh temp `DATA_DIR` (e.g. `%TEMP%\shield-demo-xxxx`).
2. Wires the filesystem + in-memory adapters and starts `shield-eval`
   on a random local port.
3. Saves a draft ruleset (the three example rules from
   `docs/REQUIREMENTS.md`), compiles it, and publishes it via the
   `compileRuleset` + `publishRuleset` use cases — exactly what the
   admin UI does.
4. Sends real HTTP `POST /v1/evaluate` requests for every decision path:
   - clean transaction → `APPROVE`
   - blocked MCC + non-US country → `DECLINE`
   - failed CVV + card-not-present → `LOCK`
   - 7 requests from the same card, velocity rule `count(card, 10 min) > 5`
     → `APPROVE`×5 then `WARM`×2
5. Publishes a **new** ruleset (everything declines) and watches the
   running server's `chokidar` watcher pick up the file-change event and
   invalidate its cache — the next HTTP request reflects the new rules
   with no server restart.
6. Shuts down cleanly and removes the temp data dir (unless `--keep`).

## Run

From the **project root**:

```bash
pnpm install     # first time only
pnpm demo
```

That runs `pnpm build` first (to make sure the workspace dist is current),
then executes this app via `tsx`.

Pass `--keep` to leave the temp `DATA_DIR` on disk for inspection:

```bash
pnpm demo -- --keep
```

The path is printed in the demo's header. You can `cat` / explore the
created `data/tenants/acme/rulesets/<v>/{draft,compiled,meta,safety}.json`,
`data/tenants/acme/active.json`, `data/tenants/acme/audit/*.jsonl`, and
`data/events/ruleset.jsonl` after the run finishes.

## Expected output

```text
Shield Rule Engine — Phase 4 demo (HTTP eval service)
DATA_DIR: C:\Users\...\AppData\Local\Temp\shield-demo-xxxx

shield-eval listening:
  http://127.0.0.1:<random>

v1 scenarios → POST /v1/evaluate
  PASS  Clean transaction              → APPROVE                no rule matched            0ms
  PASS  MCC 5999 + non-US              → DECLINE                triggered by mcc-non-us    0ms
  PASS  CVV failed + card-not-present  → LOCK                   triggered by cvv-cnp       2ms

Velocity scenario: same card, 7 requests, rule says > 5 → WARM
  PASS  request #1..#5                 → APPROVE                no rule matched
  PASS  request #6                     → WARM                   triggered by velocity      1ms
  PASS  request #7                     → WARM                   triggered by velocity      1ms

Publishing v2 (everything DECLINEs) — watch the cache invalidate…

v2 scenario: a previously-APPROVED tx should now DECLINE
  PASS  clean tx after v2 publish      → DECLINE                triggered by everything-declines 0ms
```

All elapsed times come from the eval service's own SLA wrapper (300 ms
budget). On a developer laptop typical decisions land in 0–4 ms.

## Run the services separately instead

If you want to play with the admin UI and eval API by hand instead of
through the CLI demo, run each in its own terminal:

```bash
pnpm eval:dev     # Fastify eval service on http://127.0.0.1:3001
pnpm admin:dev    # SvelteKit admin UI   on http://127.0.0.1:5173
```

Both default `DATA_DIR` to `<projectRoot>/data`, so publishes from the UI
invalidate the running eval service's cache via the chokidar watcher.
Override with `DATA_DIR=...` if you want them to use a different folder.

The admin UI looks like this:

![Shield Admin UI — tenant acme](./docs/admin-ui.png)

The header shows the current tenant, active ruleset version, and shared
`DATA_DIR`. The editor takes one rule per line in the DSL; `Validate`
parses/compiles without persisting, `Compile & Publish` writes a new
version and emits a `ruleset.published` event the eval service picks up
within milliseconds.

## How it relates to the planning docs

| Doc | Relevance |
| --- | --- |
| `docs/REQUIREMENTS.md` | The three example rules the demo seeds + the 300 ms SLA the eval wrapper enforces. |
| `docs/SPEC.md` | Gherkin features the demo's scenarios map to (rule compilation, publish, authorization evaluation, SLA, multi-tenant isolation, platform independence). |
| `docs/PLAN.md` | The phased roadmap. The demo exercises everything through Phase 4 (Domain core + filesystem persistence + use cases + Fastify eval + SLA wrapper + cross-process invalidation). |

## What the demo does *not* prove

- No load testing — it's a correctness walkthrough, not a benchmark.
- No auth — the eval service trusts the `x-tenant-id` header; the demo
  passes `acme`. Production needs a signed header / mTLS.
- No multi-process — the eval server runs in the same Node process as the
  demo driver. The chokidar invalidation still uses real OS filesystem
  events, so the protocol is identical to a multi-process deployment;
  this is a packaging convenience, not an architectural shortcut. For an
  actually-multi-process run, use `pnpm eval:dev` in one shell and the
  admin UI (or curl/Invoke-WebRequest) in another against the same
  `DATA_DIR`.
