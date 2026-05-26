import type { CmpOp, Primitive } from "../types/common.js";
import { durationMs } from "../types/common.js";
import type { CompiledExpr, CompiledRule, CompiledRuleset } from "../types/compiled.js";
import type { AuthContext, FieldValue } from "../types/context.js";
import { velocityKey } from "../types/context.js";
import type { Decision } from "../types/decision.js";

/**
 * Pure Operation: evaluate a CompiledRuleset against an AuthContext.
 *
 * Returns the list of rules that matched, in source order. The "first match
 * wins" policy is applied by `selectDecision` (a separate Operation) so the
 * picking policy stays swappable without re-running evaluation.
 */
export function evaluate(ctx: AuthContext, ruleset: CompiledRuleset): Decision[] {
  const matches: Decision[] = [];
  for (const rule of ruleset.rules) {
    if (matchesRule(rule, ctx)) {
      matches.push({ action: rule.then, triggeredRule: rule.id });
    }
  }
  return matches;
}

function matchesRule(rule: CompiledRule, ctx: AuthContext): boolean {
  return matchesExpr(rule.if, ctx);
}

function matchesExpr(expr: CompiledExpr, ctx: AuthContext): boolean {
  if ("and" in expr) return expr.and.every((e) => matchesExpr(e, ctx));
  if ("or" in expr) return expr.or.some((e) => matchesExpr(e, ctx));
  if ("not" in expr) return !matchesExpr(expr.not, ctx);
  if ("eq" in expr) return cmp("eq", readField(ctx, expr.eq[0]), expr.eq[1]);
  if ("neq" in expr) return cmp("neq", readField(ctx, expr.neq[0]), expr.neq[1]);
  if ("lt" in expr) return cmp("lt", readField(ctx, expr.lt[0]), expr.lt[1]);
  if ("le" in expr) return cmp("le", readField(ctx, expr.le[0]), expr.le[1]);
  if ("gt" in expr) return cmp("gt", readField(ctx, expr.gt[0]), expr.gt[1]);
  if ("ge" in expr) return cmp("ge", readField(ctx, expr.ge[0]), expr.ge[1]);
  if ("in" in expr) return matchesIn(expr.in[0], expr.in[1], ctx);
  if ("failed" in expr) return readField(ctx, expr.failed) === "failed";
  if ("bool" in expr) return readField(ctx, expr.bool) === true;
  return matchesCount(expr.count, ctx);
}

function matchesIn(field: string, values: readonly Primitive[], ctx: AuthContext): boolean {
  const v = readField(ctx, field);
  if (v === undefined) return false;
  return values.some((candidate) => candidate === v);
}

function matchesCount(
  cnt: {
    field: string;
    window: { value: number; unit: "sec" | "min" | "h" | "d" };
    cmp: CmpOp;
    threshold: number;
  },
  ctx: AuthContext,
): boolean {
  const windowMs = durationMs(cnt.window);
  const key = velocityKey(cnt.field, windowMs);
  const count = ctx.velocityCounts[key] ?? 0;
  return cmp(cnt.cmp, count, cnt.threshold);
}

function cmp(op: CmpOp, left: FieldValue | undefined, right: Primitive): boolean {
  if (left === undefined) return false;
  if (typeof left === "boolean") return false;
  switch (op) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "lt":
      return left < right;
    case "le":
      return left <= right;
    case "gt":
      return left > right;
    case "ge":
      return left >= right;
  }
}

function readField(ctx: AuthContext, name: string): FieldValue | undefined {
  return ctx.fields[name];
}
