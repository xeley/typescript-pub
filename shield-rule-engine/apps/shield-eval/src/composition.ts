import { createFsAudit, createFsRuleRepo, createFsRulesetEvents } from "@shield/adapters-fs";
import { createMemoryRulesetCache, createMemoryVelocityStore } from "@shield/adapters-memory";
import type { Audit, RuleRepo, RulesetCache, RulesetEvents, VelocityStore } from "@shield/ports";
import type { Config } from "./config.js";

export type EvalDeps = Readonly<{
  config: Config;
  ruleRepo: RuleRepo;
  rulesetCache: RulesetCache;
  velocityStore: VelocityStore;
  rulesetEvents: RulesetEvents;
  audit: Audit;
  now: () => number;
}>;

/**
 * Composition root — the ONLY file in this app that names concrete adapter
 * factories. Per PLAN.md § 6, swapping in `adapters-redis` or `adapters-pg`
 * happens here and nowhere else.
 */
export function wire(config: Config): EvalDeps {
  const ruleRepo = createFsRuleRepo({ dataDir: config.dataDir });
  const rulesetCache = createMemoryRulesetCache({ ruleRepo });
  const velocityStore = createMemoryVelocityStore({ now: Date.now });
  const rulesetEvents = createFsRulesetEvents({ dataDir: config.dataDir });
  const audit = createFsAudit({ dataDir: config.dataDir });
  return {
    config,
    ruleRepo,
    rulesetCache,
    velocityStore,
    rulesetEvents,
    audit,
    now: Date.now,
  };
}
