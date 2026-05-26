import {
  bundle,
  type CompiledRule,
  type CompiledRuleset,
  type DslError,
  type Whitelist,
} from "@shield/domain";
import { DEFAULT_WHITELIST } from "@shield/domain";
import type { Draft, DraftRule, RuleRepo, SafetyReport } from "@shield/ports";
import { validateRule } from "./validate-rule.js";

export type CompileRulesetInput = Readonly<{
  tenantId: string;
  version: number;
}>;

export type CompileRulesetDeps = Readonly<{
  ruleRepo: RuleRepo;
  whitelist?: Whitelist;
}>;

export type PerRuleResult = Readonly<{
  ruleId: string;
  source: string;
  position: number;
  compiled: CompiledRule | null;
  errors: readonly DslError[];
}>;

export type CompileRulesetResult = Readonly<{
  tenantId: string;
  version: number;
  ruleset: CompiledRuleset | null;
  perRule: readonly PerRuleResult[];
  safety: SafetyReport;
  errorCount: number;
  saved: boolean;
}>;

/**
 * Stratum 3 Integration: compile every draft rule for a tenant's ruleset
 * version. Writes the compiled artifact + safety report back through the
 * `RuleRepo` port iff every rule compiled cleanly.
 */
export async function compileRuleset(
  input: CompileRulesetInput,
  deps: CompileRulesetDeps,
): Promise<CompileRulesetResult> {
  const whitelist = deps.whitelist ?? DEFAULT_WHITELIST;
  const draft = await deps.ruleRepo.loadDraft(input.tenantId, input.version);
  const perRule = compileAllDraftRules(draft, whitelist);
  const safety = checkSafety(perRule);
  const ruleset = bundleIfAllValid(perRule);
  const saved = await persistIfReady(deps.ruleRepo, input, ruleset, safety);
  return assembleResult(input, perRule, ruleset, safety, saved);
}

function compileAllDraftRules(draft: Draft, whitelist: Whitelist): PerRuleResult[] {
  return draft.rules.map((dr) => compileOneDraftRule(dr, whitelist));
}

function compileOneDraftRule(dr: DraftRule, whitelist: Whitelist): PerRuleResult {
  const result = validateRule({ source: dr.source, whitelist, ruleId: dr.id });
  return {
    ruleId: dr.id,
    source: dr.source,
    position: dr.position,
    compiled: result.compiled,
    errors: result.errors,
  };
}

function checkSafety(perRule: readonly PerRuleResult[]): SafetyReport {
  const warnings: string[] = [];
  for (const r of perRule) {
    if (r.errors.length > 0) warnings.push(`Rule ${r.ruleId}: ${r.errors.length} error(s)`);
  }
  return { ok: warnings.length === 0, warnings };
}

function bundleIfAllValid(perRule: readonly PerRuleResult[]): CompiledRuleset | null {
  const allCompiled = perRule.every((r) => r.compiled !== null && r.errors.length === 0);
  if (!allCompiled) return null;
  const compiled = perRule.map((r) => r.compiled as CompiledRule);
  return bundle(compiled);
}

async function persistIfReady(
  repo: RuleRepo,
  input: CompileRulesetInput,
  ruleset: CompiledRuleset | null,
  safety: SafetyReport,
): Promise<boolean> {
  if (!ruleset) return false;
  await repo.saveCompiled(input.tenantId, input.version, ruleset, safety);
  return true;
}

function assembleResult(
  input: CompileRulesetInput,
  perRule: PerRuleResult[],
  ruleset: CompiledRuleset | null,
  safety: SafetyReport,
  saved: boolean,
): CompileRulesetResult {
  return {
    tenantId: input.tenantId,
    version: input.version,
    ruleset,
    perRule,
    safety,
    errorCount: perRule.reduce((n, r) => n + r.errors.length, 0),
    saved,
  };
}
