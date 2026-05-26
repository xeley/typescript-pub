import { beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryAudit,
  createMemoryRuleRepo,
  createMemoryRulesetEvents,
} from "@shield/adapters-memory";
import type { RuleRepo } from "@shield/ports";
import { RulesetNotFoundError } from "@shield/ports";
import { compileRuleset } from "../src/compile-ruleset.js";
import { publishRuleset, CompiledArtifactMissingError } from "../src/publish-ruleset.js";

const EXAMPLE_DRAFT = [
  { id: "r1", position: 0, source: "IF MCC in {5999, 4829} AND country != US THEN DECLINE" },
  { id: "r2", position: 1, source: "IF CVV failed AND card_not_present THEN LOCK" },
  { id: "r3", position: 2, source: "IF count(card, 10 min) > 5 THEN WARM" },
];

describe("compileRuleset", () => {
  let repo: RuleRepo;

  beforeEach(() => {
    repo = createMemoryRuleRepo();
  });

  it("compiles every rule and saves a compiled artifact when all are valid", async () => {
    await repo.saveDraft("acme", 1, EXAMPLE_DRAFT);
    const result = await compileRuleset({ tenantId: "acme", version: 1 }, { ruleRepo: repo });
    expect(result.errorCount).toBe(0);
    expect(result.safety.ok).toBe(true);
    expect(result.saved).toBe(true);
    expect(result.ruleset?.rules).toHaveLength(3);
    expect(await repo.hasCompiled("acme", 1)).toBe(true);
  });

  it("does NOT save a compiled artifact when any rule has errors", async () => {
    await repo.saveDraft("acme", 1, [
      { id: "r1", position: 0, source: "IF MCC > 0 THEN DECLINE" },
      { id: "r2", position: 1, source: "IF wallet_color = blue THEN DECLINE" },
    ]);
    const result = await compileRuleset({ tenantId: "acme", version: 1 }, { ruleRepo: repo });
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.safety.ok).toBe(false);
    expect(result.saved).toBe(false);
    expect(result.ruleset).toBeNull();
    expect(await repo.hasCompiled("acme", 1)).toBe(false);
  });

  it("reports per-rule errors with their original ruleId and position", async () => {
    await repo.saveDraft("acme", 1, [
      { id: "good", position: 0, source: "IF MCC > 0 THEN DECLINE" },
      { id: "bad", position: 1, source: "IF wallet_color = blue THEN DECLINE" },
    ]);
    const result = await compileRuleset({ tenantId: "acme", version: 1 }, { ruleRepo: repo });
    const bad = result.perRule.find((r) => r.ruleId === "bad");
    expect(bad?.errors.length).toBeGreaterThan(0);
    expect(bad?.compiled).toBeNull();
    expect(bad?.position).toBe(1);
    const good = result.perRule.find((r) => r.ruleId === "good");
    expect(good?.errors).toEqual([]);
    expect(good?.compiled).not.toBeNull();
  });

  it("throws RulesetNotFoundError when the draft does not exist", async () => {
    await expect(
      compileRuleset({ tenantId: "ghost", version: 99 }, { ruleRepo: repo }),
    ).rejects.toBeInstanceOf(RulesetNotFoundError);
  });
});

describe("publishRuleset", () => {
  it("marks active, fires the event, and records audit", async () => {
    const repo = createMemoryRuleRepo();
    const events = createMemoryRulesetEvents();
    const audit = createMemoryAudit();
    const received: Array<{ tenantId: string; version: number }> = [];
    await events.subscribe((e) => {
      received.push({ tenantId: e.tenantId, version: e.version });
    });

    await repo.saveDraft("acme", 1, EXAMPLE_DRAFT);
    await compileRuleset({ tenantId: "acme", version: 1 }, { ruleRepo: repo });

    const result = await publishRuleset(
      { tenantId: "acme", version: 1, actor: "alice" },
      { ruleRepo: repo, rulesetEvents: events, audit },
    );

    expect(result).toEqual({ active: 1, previous: null });
    expect(await repo.activeVersion("acme")).toBe(1);
    expect(received).toEqual([{ tenantId: "acme", version: 1 }]);
  });

  it("returns the previous version when swapping a tenant's active ruleset", async () => {
    const repo = createMemoryRuleRepo();
    const events = createMemoryRulesetEvents();
    const audit = createMemoryAudit();

    await repo.saveDraft("acme", 1, EXAMPLE_DRAFT);
    await compileRuleset({ tenantId: "acme", version: 1 }, { ruleRepo: repo });
    await publishRuleset(
      { tenantId: "acme", version: 1 },
      { ruleRepo: repo, rulesetEvents: events, audit },
    );

    await repo.saveDraft("acme", 2, EXAMPLE_DRAFT);
    await compileRuleset({ tenantId: "acme", version: 2 }, { ruleRepo: repo });
    const result = await publishRuleset(
      { tenantId: "acme", version: 2 },
      { ruleRepo: repo, rulesetEvents: events, audit },
    );

    expect(result).toEqual({ active: 2, previous: 1 });
  });

  it("rejects publishing a version without a compiled artifact", async () => {
    const repo = createMemoryRuleRepo();
    const events = createMemoryRulesetEvents();
    const audit = createMemoryAudit();

    await repo.saveDraft("acme", 1, EXAMPLE_DRAFT);
    // Note: NO compile step here.
    await expect(
      publishRuleset(
        { tenantId: "acme", version: 1 },
        { ruleRepo: repo, rulesetEvents: events, audit },
      ),
    ).rejects.toBeInstanceOf(CompiledArtifactMissingError);
    expect(await repo.activeVersion("acme")).toBeNull();
  });

  it("isolates tenants: publishing in one does not change another", async () => {
    const repo = createMemoryRuleRepo();
    const events = createMemoryRulesetEvents();
    const audit = createMemoryAudit();

    await repo.saveDraft("acme", 1, EXAMPLE_DRAFT);
    await compileRuleset({ tenantId: "acme", version: 1 }, { ruleRepo: repo });
    await publishRuleset(
      { tenantId: "acme", version: 1 },
      { ruleRepo: repo, rulesetEvents: events, audit },
    );

    await repo.saveDraft("globex", 7, EXAMPLE_DRAFT);
    await compileRuleset({ tenantId: "globex", version: 7 }, { ruleRepo: repo });
    await publishRuleset(
      { tenantId: "globex", version: 7 },
      { ruleRepo: repo, rulesetEvents: events, audit },
    );

    expect(await repo.activeVersion("acme")).toBe(1);
    expect(await repo.activeVersion("globex")).toBe(7);
  });
});
