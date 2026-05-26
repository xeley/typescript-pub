import type { Action, CmpOp, Duration, Primitive } from "./common.js";

/**
 * Compiled IR matching the shape documented in docs/PLAN.md § 4.
 * JSON-serializable; no functions, no Symbols. Walked by `evaluate`.
 */
export type CompiledExpr =
  | { readonly and: readonly CompiledExpr[] }
  | { readonly or: readonly CompiledExpr[] }
  | { readonly not: CompiledExpr }
  | { readonly eq: readonly [string, Primitive] }
  | { readonly neq: readonly [string, Primitive] }
  | { readonly lt: readonly [string, Primitive] }
  | { readonly le: readonly [string, Primitive] }
  | { readonly gt: readonly [string, Primitive] }
  | { readonly ge: readonly [string, Primitive] }
  | { readonly in: readonly [string, readonly Primitive[]] }
  | { readonly failed: string }
  | { readonly bool: string }
  | {
      readonly count: {
        readonly field: string;
        readonly window: Duration;
        readonly cmp: CmpOp;
        readonly threshold: number;
      };
    };

export type CompiledRule = Readonly<{
  id: string;
  if: CompiledExpr;
  then: Action;
  source: string;
}>;

export type CompiledRuleset = Readonly<{
  compilerVersion: string;
  rules: readonly CompiledRule[];
}>;

export const COMPILER_VERSION = "1";
