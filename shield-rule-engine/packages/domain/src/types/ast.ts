import type { Action, CmpOp, Duration, Span } from "./common.js";

export type ValueExpr =
  | Readonly<{ kind: "int"; value: number; span: Span }>
  | Readonly<{ kind: "string"; value: string; span: Span }>;

export type CmpPred = Readonly<{
  kind: "cmp";
  field: string;
  op: CmpOp;
  value: ValueExpr;
  span: Span;
}>;

export type InPred = Readonly<{
  kind: "in";
  field: string;
  values: ValueExpr[];
  span: Span;
}>;

export type FailedPred = Readonly<{
  kind: "failed";
  field: string;
  span: Span;
}>;

export type BoolPred = Readonly<{
  kind: "bool";
  field: string;
  span: Span;
}>;

export type CountPred = Readonly<{
  kind: "count";
  field: string;
  window: Duration;
  op: CmpOp;
  threshold: number;
  span: Span;
}>;

export type Predicate = CmpPred | InPred | FailedPred | BoolPred | CountPred;

export type AndExpr = Readonly<{
  kind: "and";
  left: Expr;
  right: Expr;
  span: Span;
}>;

export type OrExpr = Readonly<{
  kind: "or";
  left: Expr;
  right: Expr;
  span: Span;
}>;

export type NotExpr = Readonly<{
  kind: "not";
  expr: Expr;
  span: Span;
}>;

export type Expr = AndExpr | OrExpr | NotExpr | Predicate;

export type Rule = Readonly<{
  kind: "rule";
  if: Expr;
  then: Action;
  span: Span;
}>;
