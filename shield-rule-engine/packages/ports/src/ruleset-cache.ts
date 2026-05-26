import type { CompiledRuleset } from "@shield/domain";

export interface RulesetCache {
  getOrLoad(tenantId: string): Promise<CompiledRuleset>;
  invalidate(tenantId: string): Promise<void>;
  invalidateAll(): Promise<void>;
}
