import type { CompiledRuleset } from "@shield/domain";
import type { RuleRepo, RulesetCache } from "@shield/ports";

export type MemoryRulesetCacheConfig = Readonly<{
  ruleRepo: RuleRepo;
}>;

export class NoActiveRulesetError extends Error {
  constructor(public readonly tenantId: string) {
    super(`No active ruleset for tenant=${tenantId}`);
    this.name = "NoActiveRulesetError";
  }
}

/**
 * Process-local cache. On miss, loads the tenant's active ruleset from the
 * RuleRepo. v1 is unbounded; the LRU eviction noted in PLAN.md § 6 will
 * land once cache size becomes a concern.
 */
export function createMemoryRulesetCache(config: MemoryRulesetCacheConfig): RulesetCache {
  const cache = new Map<string, CompiledRuleset>();
  return {
    async getOrLoad(tenantId) {
      const cached = cache.get(tenantId);
      if (cached) return cached;
      const ruleset = await loadActive(config.ruleRepo, tenantId);
      cache.set(tenantId, ruleset);
      return ruleset;
    },
    async invalidate(tenantId) {
      cache.delete(tenantId);
    },
    async invalidateAll() {
      cache.clear();
    },
  };
}

async function loadActive(repo: RuleRepo, tenantId: string): Promise<CompiledRuleset> {
  const version = await repo.activeVersion(tenantId);
  if (version === null) throw new NoActiveRulesetError(tenantId);
  return repo.loadCompiled(tenantId, version);
}
