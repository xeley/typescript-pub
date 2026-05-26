import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsRuleRepo, createFsRulesetEvents } from "@shield/adapters-fs";
import { compileRuleset, publishRuleset } from "@shield/use-cases";
import { createMemoryAudit } from "@shield/adapters-memory";
import { bootstrap } from "../src/bootstrap.js";
import { wire } from "../src/composition.js";
import type { Config } from "../src/config.js";
import type { AppServer } from "../src/server.js";

const TENANT = "acme";

const DRAFT = [
  {
    id: "mcc-non-us",
    position: 0,
    source: "IF MCC in {5999, 4829} AND country != US THEN DECLINE",
  },
  { id: "cvv-cnp", position: 1, source: "IF CVV failed AND card_not_present THEN LOCK" },
  { id: "velocity", position: 2, source: "IF count(card, 10 min) > 5 THEN WARM" },
];

async function bootShield(dataDir: string): Promise<AppServer> {
  const config: Config = {
    dataDir,
    host: "127.0.0.1",
    port: 0,
    slaMs: 300,
    failSafe: "APPROVE",
    logLevel: "fatal",
  };
  const deps = wire(config);
  return bootstrap(deps, { host: config.host, port: config.port });
}

async function publishExample(dataDir: string): Promise<void> {
  const repo = createFsRuleRepo({ dataDir });
  const events = createFsRulesetEvents({ dataDir });
  const audit = createMemoryAudit();
  await repo.saveDraft(TENANT, 1, DRAFT);
  await compileRuleset({ tenantId: TENANT, version: 1 }, { ruleRepo: repo });
  await publishRuleset(
    { tenantId: TENANT, version: 1 },
    { ruleRepo: repo, rulesetEvents: events, audit },
  );
}

async function postEvaluate(
  server: AppServer,
  body: unknown,
  headers: Record<string, string> = { "x-tenant-id": TENANT },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await server.fastify.inject({
    method: "POST",
    url: "/v1/evaluate",
    headers,
    payload: body,
  });
  return { status: res.statusCode, body: res.json() };
}

describe("shield-eval server", () => {
  let dataDir: string;
  let server: AppServer | null = null;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "shield-eval-srv-"));
  });

  afterEach(async () => {
    if (server) await server.shutdown();
    server = null;
    await rm(dataDir, { recursive: true, force: true });
  });

  it("GET /v1/health returns 200 {ok:true}", async () => {
    server = await bootShield(dataDir);
    const res = await server.fastify.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET /v1/ready returns 200 when DATA_DIR is readable", async () => {
    server = await bootShield(dataDir);
    const res = await server.fastify.inject({ method: "GET", url: "/v1/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, checks: { dataDirReadable: true } });
  });

  it("POST /v1/evaluate returns 503 when the tenant has no active ruleset", async () => {
    server = await bootShield(dataDir);
    const res = await postEvaluate(server, {
      fields: { MCC: 5411, country: "US", CVV: "ok", card_not_present: false },
      cardId: "c1",
    });
    expect(res.status).toBe(503);
    expect(res.body["error"]).toBe("NoActiveRuleset");
  });

  it("POST /v1/evaluate returns 400 when x-tenant-id header is missing", async () => {
    server = await bootShield(dataDir);
    const res = await postEvaluate(
      server,
      { fields: {}, cardId: "c1" },
      {}, // no tenant header
    );
    expect(res.status).toBe(400);
    expect(res.body["error"]).toBe("BadRequest");
  });

  it("POST /v1/evaluate returns 400 when body shape is invalid", async () => {
    server = await bootShield(dataDir);
    const res = await postEvaluate(server, { something: "else" });
    expect(res.status).toBe(400);
  });

  it("POST /v1/evaluate returns DECLINE for the MCC rule after publish", async () => {
    await publishExample(dataDir);
    server = await bootShield(dataDir);
    const res = await postEvaluate(server, {
      fields: { MCC: 5999, country: "DE", CVV: "ok", card_not_present: false },
      cardId: "c1",
    });
    expect(res.status).toBe(200);
    expect(res.body["action"]).toBe("DECLINE");
    expect(res.body["triggeredRule"]).toBe("mcc-non-us");
    expect(res.body["slaTimeout"]).toBe(false);
  });

  it("POST /v1/evaluate returns WARM on the 6th request from the same card", async () => {
    await publishExample(dataDir);
    server = await bootShield(dataDir);
    const body = {
      fields: { MCC: 5411, country: "US", CVV: "ok", card_not_present: false },
      cardId: "card-velocity",
    };
    const actions: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await postEvaluate(server, body);
      actions.push(res.body["action"] as string);
    }
    expect(actions.slice(0, 5).every((a) => a === "APPROVE")).toBe(true);
    expect(actions[5]).toBe("WARM");
    expect(actions[6]).toBe("WARM");
  });

  it("invalidates the cache when a publish event fires (cross-process style)", async () => {
    await publishExample(dataDir);
    server = await bootShield(dataDir);

    const first = await postEvaluate(server, {
      fields: { MCC: 5411, country: "US", CVV: "ok", card_not_present: false },
      cardId: "c1",
    });
    expect(first.body["action"]).toBe("APPROVE");

    const repo = createFsRuleRepo({ dataDir });
    const events = createFsRulesetEvents({ dataDir });
    const audit = createMemoryAudit();
    await repo.saveDraft(TENANT, 2, [
      { id: "everything-declines", position: 0, source: "IF MCC > 0 THEN DECLINE" },
    ]);
    await compileRuleset({ tenantId: TENANT, version: 2 }, { ruleRepo: repo });
    await publishRuleset(
      { tenantId: TENANT, version: 2 },
      { ruleRepo: repo, rulesetEvents: events, audit },
    );

    // Allow the file watcher on the eval server to pick up the event.
    await waitFor(async () => {
      const probe = await postEvaluate(server!, {
        fields: { MCC: 5411, country: "US", CVV: "ok", card_not_present: false },
        cardId: "c-probe",
      });
      return probe.body["action"] === "DECLINE";
    }, 3000);
  });
});

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
