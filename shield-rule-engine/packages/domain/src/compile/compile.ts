import type { CmpOp, Primitive } from "../types/common.js";
import type { DslError } from "../types/error.js";
import type { Expr, Predicate, Rule, ValueExpr } from "../types/ast.js";
import {
  COMPILER_VERSION,
  type CompiledExpr,
  type CompiledRule,
  type CompiledRuleset,
} from "../types/compiled.js";

export type CompileOptions = Readonly<{
  id: string;
  source: string;
}>;

export type CompileRuleResult = Readonly<{
  compiled: CompiledRule | null;
  errors: DslError[];
}>;

/**
 * Pure Operation: validated Rule -> CompiledRule (JSON-serializable IR).
 *
 * `compile` does not re-validate. It assumes `validate` has already run
 * (errors from there are kept by the use case Integration). Compilation
 * itself can fail only if the IR shape gives up on some input; in v1 it
 * always succeeds and returns `errors: []`.
 */
export function compile(rule: Rule, opts: CompileOptions): CompileRuleResult {
  const ir: CompiledExpr = compileExpr(rule.if);
  const compiled: CompiledRule = {
    id: opts.id,
    if: ir,
    then: rule.then,
    source: opts.source,
  };
  return { compiled, errors: [] };
}

/**
 * Pure Operation: wrap individual CompiledRules into a CompiledRuleset.
 */
export function bundle(rules: readonly CompiledRule[]): CompiledRuleset {
  return { compilerVersion: COMPILER_VERSION, rules };
}

function compileExpr(expr: Expr): CompiledExpr {
  switch (expr.kind) {
    case "and":
      return { and: [compileExpr(expr.left), compileExpr(expr.right)] };
    case "or":
      return { or: [compileExpr(expr.left), compileExpr(expr.right)] };
    case "not":
      return { not: compileExpr(expr.expr) };
    default:
      return compilePredicate(expr);
  }
}

function compilePredicate(pred: Predicate): CompiledExpr {
  switch (pred.kind) {
    case "cmp":
      return compileCmp(pred.op, pred.field, valueOf(pred.value));
    case "in":
      return { in: [pred.field, pred.values.map(valueOf)] };
    case "failed":
      return { failed: pred.field };
    case "bool":
      return { bool: pred.field };
    case "count":
      return {
        count: {
          field: pred.field,
          window: pred.window,
          cmp: pred.op,
          threshold: pred.threshold,
        },
      };
  }
}

function compileCmp(op: CmpOp, field: string, value: Primitive): CompiledExpr {
  switch (op) {
    case "eq":
      return { eq: [field, value] };
    case "neq":
      return { neq: [field, value] };
    case "lt":
      return { lt: [field, value] };
    case "le":
      return { le: [field, value] };
    case "gt":
      return { gt: [field, value] };
    case "ge":
      return { ge: [field, value] };
  }
}

function valueOf(value: ValueExpr): Primitive {
  return value.value;
}
