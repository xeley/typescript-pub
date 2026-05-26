import type { Span } from "../types/common.js";
import { TIME_UNITS } from "../types/common.js";
import type { DslError } from "../types/error.js";
import type { BoolPred, CmpPred, CountPred, Expr, FailedPred, InPred, Rule } from "../types/ast.js";
import type { FieldSpec, FieldType, FunctionSpec, Whitelist } from "../types/whitelist.js";

export type ValidateResult = Readonly<{
  rule: Rule;
  errors: DslError[];
}>;

/**
 * Pure Operation: AST + whitelist -> the same AST, plus semantic errors.
 *
 * Checks every field is whitelisted, every field's use matches its declared
 * type, count() uses an allowed grouping field within an allowed window, and
 * the rule's action is in the whitelist. Never throws.
 */
export function validate(rule: Rule, whitelist: Whitelist): ValidateResult {
  const errors: DslError[] = [];
  validateAction(rule, whitelist, errors);
  validateExpr(rule.if, whitelist, errors);
  return { rule, errors };
}

function validateAction(rule: Rule, whitelist: Whitelist, errors: DslError[]): void {
  const allowed = (whitelist.actions as readonly string[]).includes(rule.then);
  if (!allowed) {
    errors.push({
      kind: "unknown-action",
      message: `Action '${rule.then}' is not allowed (allowed: ${whitelist.actions.join(", ")})`,
      span: rule.span,
    });
  }
}

function validateExpr(expr: Expr, whitelist: Whitelist, errors: DslError[]): void {
  switch (expr.kind) {
    case "and":
    case "or":
      validateExpr(expr.left, whitelist, errors);
      validateExpr(expr.right, whitelist, errors);
      return;
    case "not":
      validateExpr(expr.expr, whitelist, errors);
      return;
    case "cmp":
      validateCmp(expr, whitelist, errors);
      return;
    case "in":
      validateIn(expr, whitelist, errors);
      return;
    case "failed":
      validateFailed(expr, whitelist, errors);
      return;
    case "bool":
      validateBool(expr, whitelist, errors);
      return;
    case "count":
      validateCount(expr, whitelist, errors);
      return;
  }
}

function validateCmp(p: CmpPred, whitelist: Whitelist, errors: DslError[]): void {
  const field = lookupField(p.field, whitelist, p.span, errors);
  if (!field) return;
  const valueType = p.value.kind === "int" ? "int" : "string";
  const allowed = allowedValueTypesForCmp(field.type);
  if (!allowed.includes(valueType)) {
    errors.push(typeMismatch(p.field, field.type, valueType, p.value.span));
  }
}

function validateIn(p: InPred, whitelist: Whitelist, errors: DslError[]): void {
  const field = lookupField(p.field, whitelist, p.span, errors);
  if (!field) return;
  const allowed = allowedValueTypesForCmp(field.type);
  for (const value of p.values) {
    const valueType: "int" | "string" = value.kind === "int" ? "int" : "string";
    if (!allowed.includes(valueType)) {
      errors.push(typeMismatch(p.field, field.type, valueType, value.span));
    }
  }
}

function validateFailed(p: FailedPred, whitelist: Whitelist, errors: DslError[]): void {
  const field = lookupField(p.field, whitelist, p.span, errors);
  if (!field) return;
  if (field.type !== "cvv") {
    errors.push({
      kind: "type-mismatch",
      message: `'${p.field} failed' requires a cvv-typed field (got ${field.type})`,
      span: p.span,
    });
  }
}

function validateBool(p: BoolPred, whitelist: Whitelist, errors: DslError[]): void {
  const field = lookupField(p.field, whitelist, p.span, errors);
  if (!field) return;
  if (field.type !== "bool") {
    errors.push({
      kind: "type-mismatch",
      message: `Bare field '${p.field}' requires a bool-typed field (got ${field.type})`,
      span: p.span,
    });
  }
}

function validateCount(p: CountPred, whitelist: Whitelist, errors: DslError[]): void {
  const fn = lookupFunction("count", whitelist, p.span, errors);
  if (!fn) return;
  const groupingOk = fn.groupingFields.includes(p.field);
  if (!groupingOk) {
    errors.push({
      kind: "type-mismatch",
      message: `count(${p.field}, ...) is not allowed; allowed grouping fields: ${fn.groupingFields.join(", ")}`,
      span: p.span,
    });
  }
  validateWindow(p, fn, errors);
}

function validateWindow(p: CountPred, fn: FunctionSpec, errors: DslError[]): void {
  const unitOk = fn.allowedWindowUnits.includes(p.window.unit);
  if (!unitOk) {
    errors.push({
      kind: "unsupported-window",
      message: `Window unit '${p.window.unit}' is not allowed (allowed: ${TIME_UNITS.join(", ")})`,
      span: p.span,
    });
    return;
  }
  const max = fn.maxWindowValue[p.window.unit];
  if (p.window.value < 1 || p.window.value > max) {
    errors.push({
      kind: "unsupported-window",
      message: `Window value ${p.window.value}${p.window.unit} is out of range (1..${max}${p.window.unit})`,
      span: p.span,
    });
  }
}

function lookupField(
  name: string,
  whitelist: Whitelist,
  span: Span,
  errors: DslError[],
): FieldSpec | null {
  const found = whitelist.fields.find((f) => f.name === name);
  if (!found) {
    errors.push({
      kind: "unknown-field",
      message: `Unknown field '${name}'`,
      span,
    });
    return null;
  }
  return found;
}

function lookupFunction(
  name: string,
  whitelist: Whitelist,
  span: Span,
  errors: DslError[],
): FunctionSpec | null {
  const found = whitelist.functions.find((f) => f.name === name);
  if (!found) {
    errors.push({
      kind: "unknown-function",
      message: `Unknown function '${name}'`,
      span,
    });
    return null;
  }
  return found;
}

function allowedValueTypesForCmp(fieldType: FieldType): readonly ("int" | "string")[] {
  if (fieldType === "int") return ["int"];
  return ["string"];
}

function typeMismatch(
  fieldName: string,
  fieldType: FieldType,
  valueType: "int" | "string",
  span: Span,
): DslError {
  return {
    kind: "type-mismatch",
    message: `Field '${fieldName}' is ${fieldType}; cannot compare with ${valueType} value`,
    span,
  };
}
