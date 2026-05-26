import {
  evaluate,
  extractVelocityRequirements,
  selectDecision,
  type AuthContext,
  type CompiledRuleset,
  type Decision,
  type DecisionAction,
  type VelocityRequirement,
} from "@shield/domain";
import type { Audit, AuthRequest, RulesetCache, VelocityCounts, VelocityStore } from "@shield/ports";

export type EvaluateAuthDeps = Readonly<{
  rulesetCache: RulesetCache;
  velocityStore: VelocityStore;
  audit: Audit;
  failSafe: DecisionAction;
}>;

/**
 * Stratum 3 Integration: the 300 ms hot path.
 *
 * Per PLAN.md § 5 / § 7:
 *   1. Pull the active ruleset from the in-memory cache (cold miss = JSON
 *      read via RuleRepo; logged, off-budget on warm path).
 *   2. Pull velocity counts from the in-memory store, scoped to the
 *      requirements actually referenced by the ruleset.
 *   3. Build an AuthContext (Operation, pure).
 *   4. Evaluate + select decision (Domain Operations, pure).
 *   5. Fire-and-forget audit (off-budget); await velocity increment so the
 *      next request sees the counter bump.
 */
export async function evaluateAuth(req: AuthRequest, deps: EvaluateAuthDeps): Promise<Decision> {
  const ruleset = await deps.rulesetCache.getOrLoad(req.tenantId);
  const requirements = extractVelocityRequirements(ruleset);
  await deps.velocityStore.recordAttempt(req);
  const counts = await deps.velocityStore.fetchFor(req, requirements);
  const ctx = buildContext(req, counts);
  const decision = decide(ruleset, ctx, deps.failSafe);
  fireAuditEvent(deps.audit, req.tenantId, decision, ctx);
  return decision;
}

function buildContext(req: AuthRequest, counts: VelocityCounts): AuthContext {
  return { fields: req.fields, velocityCounts: counts, now: req.now };
}

function decide(ruleset: CompiledRuleset, ctx: AuthContext, failSafe: DecisionAction): Decision {
  const matches = evaluate(ctx, ruleset);
  return selectDecision(matches, failSafe);
}

function fireAuditEvent(
  audit: Audit,
  tenantId: string,
  decision: Decision,
  ctx: AuthContext,
): void {
  void audit.recordEvaluation(tenantId, decision, ctx).catch(() => undefined);
}

export type { AuthRequest, VelocityRequirement };
