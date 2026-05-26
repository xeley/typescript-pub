import type { CompiledRuleset } from "@shield/domain";
import type { Draft, DraftRule, RulesetMeta, SafetyReport } from "./types.js";

export interface RuleRepo {
  loadDraft(tenantId: string, version: number): Promise<Draft>;
  saveDraft(tenantId: string, version: number, rules: readonly DraftRule[]): Promise<void>;
  loadCompiled(tenantId: string, version: number): Promise<CompiledRuleset>;
  saveCompiled(
    tenantId: string,
    version: number,
    ir: CompiledRuleset,
    safety: SafetyReport,
  ): Promise<void>;
  hasCompiled(tenantId: string, version: number): Promise<boolean>;
  markActive(tenantId: string, version: number): Promise<void>;
  activeVersion(tenantId: string): Promise<number | null>;
  listVersions(tenantId: string): Promise<readonly RulesetMeta[]>;
}
