import { durationMs } from "../types/common.js";
import type { CompiledExpr, CompiledRuleset } from "../types/compiled.js";
import type { VelocityRequirement } from "../types/velocity.js";

/**
 * Pure Operation: extract every distinct `(field, windowMs)` pair referenced
 * by `count(...)` predicates in a compiled ruleset. Eval composition uses
 * this to tell the VelocityStore exactly which counters need to be present
 * in the AuthContext for a given tenant.
 */
export function extractVelocityRequirements(
  ruleset: CompiledRuleset,
): readonly VelocityRequirement[] {
  const seen = new Map<string, VelocityRequirement>();
  for (const rule of ruleset.rules) walkExpr(rule.if, seen);
  return Array.from(seen.values());
}

function walkExpr(expr: CompiledExpr, seen: Map<string, VelocityRequirement>): void {
  if ("and" in expr) {
    for (const child of expr.and) walkExpr(child, seen);
    return;
  }
  if ("or" in expr) {
    for (const child of expr.or) walkExpr(child, seen);
    return;
  }
  if ("not" in expr) {
    walkExpr(expr.not, seen);
    return;
  }
  if ("count" in expr) {
    recordRequirement(expr.count.field, durationMs(expr.count.window), seen);
    return;
  }
}

function recordRequirement(
  field: string,
  windowMs: number,
  seen: Map<string, VelocityRequirement>,
): void {
  const key = `${field}|${windowMs}`;
  if (seen.has(key)) return;
  seen.set(key, { field, windowMs });
}
