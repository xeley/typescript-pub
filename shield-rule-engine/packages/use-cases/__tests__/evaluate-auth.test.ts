import { beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryAudit,
  createMemoryRuleRepo,
  createMemoryRulesetCache,
  createMemoryRulesetEvents,
  createMemoryVelocityStore,
  type MemoryAudit,
} from "@shield/adapters-memory";
import type { AuthRequest, RuleRepo, RulesetCache, VelocityStore } from "@shield/ports";
import { compileRuleset } from "../src/compile-ruleset.js";
import { publishRuleset } from "../src/publish-ruleset.js";
import { evaluateAuth } from "../src/evaluate-auth.js";
import { evaluateAuthWithSla } from "../src/evaluate-auth-with-sla.js";

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

async function seedAndPublish(): Promise<{
  ruleRepo: RuleRepo;
  rulesetCache: RulesetCache;
  velocityStore: VelocityStore;
  audit: MemoryAudit;
}> {
  const ruleRepo = createMemoryRuleRepo();
  const audit = createMemoryAudit();
  const events = createMemoryRulesetEvents();
  await ruleRepo.saveDraft(TENANT, 1, DRAFT);
  await compileRuleset({ tenantId: TENANT, version: 1 }, { ruleRepo });
  await publishRuleset(
    { tenantId: TENANT, version: 1 },
    { ruleRepo, rulesetEvents: events, audit },
  );
  const rulesetCache = createMemoryRulesetCache({ ruleRepo });
  const velocityStore = createMemoryVelocityStore();
  return { ruleRepo, rulesetCache, velocityStore, audit };
}

function req(fields: Record<string, string | number | boolean>, cardId?: string): AuthRequest {
  return { tenantId: TENANT, fields, cardId, now: Date.now() };
}

describe("evaluateAuth", () => {
  let deps: Awaited<ReturnType<typeof seedAndPublish>>;

  beforeEach(async () => {
    deps = await seedAndPublish();
  });

  it("returns DECLINE for MCC in {5999, 4829} with non-US country", async () => {
    const decision = await evaluateAuth(
      req({ MCC: 5999, country: "DE", CVV: "ok", card_not_present: false }, "c1"),
      withFailSafe(deps),
    );
    expect(decision).toEqual({ action: "DECLINE", triggeredRule: "mcc-non-us" });
  });

  it("returns LOCK for CVV failed + card_not_present", async () => {
    const decision = await evaluateAuth(
      req({ MCC: 5411, country: "US", CVV: "failed", card_not_present: true }, "c1"),
      withFailSafe(deps),
    );
    expect(decision).toEqual({ action: "LOCK", triggeredRule: "cvv-cnp" });
  });

  it("returns fail-safe (APPROVE) for a clean transaction", async () => {
    const decision = await evaluateAuth(
      req({ MCC: 5411, country: "US", CVV: "ok", card_not_present: false }, "c1"),
      withFailSafe(deps),
    );
    expect(decision).toEqual({ action: "APPROVE", triggeredRule: null });
  });

  it("triggers WARM on the 6th request from the same card inside the window", async () => {
    const fields = { MCC: 5411, country: "US", CVV: "ok", card_not_present: false };
    const decisions = [];
    for (let i = 0; i < 7; i += 1) {
      decisions.push(await evaluateAuth(req(fields, "card-velocity"), withFailSafe(deps)));
    }
    expect(decisions.slice(0, 5).every((d) => d.action === "APPROVE")).toBe(true);
    expect(decisions[5]?.action).toBe("WARM");
    expect(decisions[5]?.triggeredRule).toBe("velocity");
    expect(decisions[6]?.action).toBe("WARM");
  });

  it("does NOT cross-contaminate velocity between different cards", async () => {
    const fields = { MCC: 5411, country: "US", CVV: "ok", card_not_present: false };
    for (let i = 0; i < 10; i += 1) {
      await evaluateAuth(req(fields, "card-loud"), withFailSafe(deps));
    }
    const decision = await evaluateAuth(req(fields, "card-quiet"), withFailSafe(deps));
    expect(decision.action).toBe("APPROVE");
  });

  it("records every evaluation in the audit log", async () => {
    await evaluateAuth(
      req({ MCC: 5999, country: "DE", CVV: "ok", card_not_present: false }, "c1"),
      withFailSafe(deps),
    );
    await new Promise((r) => setTimeout(r, 5));
    const entries = deps.audit.entries().filter((e) => e.type === "evaluation");
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe("evaluateAuthWithSla", () => {
  it("returns the real decision when evaluation finishes inside the SLA", async () => {
    const deps = await seedAndPublish();
    const outcome = await evaluateAuthWithSla(
      req({ MCC: 5999, country: "DE", CVV: "ok", card_not_present: false }, "c1"),
      { ...withFailSafe(deps), slaMs: 300 },
    );
    expect(outcome.slaTimeout).toBe(false);
    expect(outcome.decision.action).toBe("DECLINE");
  });

  it("returns fail-safe DECLINE on SLA timeout", async () => {
    const deps = await seedAndPublish();
    const slowCache = wrapSlowCache(deps.rulesetCache, 100);
    const outcome = await evaluateAuthWithSla(
      req({ MCC: 5411, country: "US", CVV: "ok", card_not_present: false }, "c1"),
      {
        rulesetCache: slowCache,
        velocityStore: deps.velocityStore,
        audit: deps.audit,
        failSafe: "DECLINE",
        slaMs: 10,
      },
    );
    expect(outcome.slaTimeout).toBe(true);
    expect(outcome.decision.action).toBe("DECLINE");
    expect(outcome.decision.triggeredRule).toBe("__sla_timeout__");
  });
});

function withFailSafe(deps: Awaited<ReturnType<typeof seedAndPublish>>) {
  return {
    rulesetCache: deps.rulesetCache,
    velocityStore: deps.velocityStore,
    audit: deps.audit,
    failSafe: "APPROVE" as const,
  };
}

function wrapSlowCache(cache: RulesetCache, delayMs: number): RulesetCache {
  return {
    async getOrLoad(tenantId) {
      await new Promise((r) => setTimeout(r, delayMs));
      return cache.getOrLoad(tenantId);
    },
    invalidate: (tid) => cache.invalidate(tid),
    invalidateAll: () => cache.invalidateAll(),
  };
}
