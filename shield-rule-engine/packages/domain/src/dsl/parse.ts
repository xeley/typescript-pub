import type { Action, CmpOp, Duration, Position, Span, TimeUnit } from "../types/common.js";
import { SOURCE_CMP_OPS, TIME_UNITS, ZERO_POS } from "../types/common.js";
import type { DslError } from "../types/error.js";
import { ACTION_KEYWORDS, type Token } from "../types/token.js";
import type { CountPred, Expr, InPred, Predicate, Rule, ValueExpr } from "../types/ast.js";

export type ParseResult = Readonly<{
  rule: Rule | null;
  errors: DslError[];
}>;

type ParserState = {
  tokens: Token[];
  i: number;
  errors: DslError[];
};

class BailError extends Error {
  constructor(public readonly error: DslError) {
    super(error.message);
  }
}

/**
 * Pure Operation: tokens -> single Rule + parse errors.
 *
 * v1 parses one rule per source. Multi-rule rulesets are parsed by the use
 * case caller iterating over draft rules. On the first syntax error the
 * parser bails and returns `rule: null` with a precise error span.
 */
export function parse(tokens: Token[]): ParseResult {
  const state: ParserState = { tokens, i: 0, errors: [] };

  if (isEmpty(state)) {
    return {
      rule: null,
      errors: [{ kind: "empty-source", message: "Empty rule source" }],
    };
  }

  try {
    const rule = parseRule(state);
    expectEof(state);
    return { rule, errors: state.errors };
  } catch (err) {
    if (err instanceof BailError) {
      return { rule: null, errors: [...state.errors, err.error] };
    }
    throw err;
  }
}

function parseRule(state: ParserState): Rule {
  const ifTok = expectKeyword(state, "if");
  const condition = parseExpr(state);
  expectKeyword(state, "then");
  const action = parseAction(state);
  const end = previousEnd(state);
  return {
    kind: "rule",
    if: condition,
    then: action,
    span: { start: ifTok.span.start, end },
  };
}

function parseExpr(state: ParserState): Expr {
  return parseOr(state);
}

function parseOr(state: ParserState): Expr {
  let left = parseAnd(state);
  while (matchKeyword(state, "or")) {
    const right = parseAnd(state);
    left = { kind: "or", left, right, span: spanCombine(left.span, right.span) };
  }
  return left;
}

function parseAnd(state: ParserState): Expr {
  let left = parseUnary(state);
  while (matchKeyword(state, "and")) {
    const right = parseUnary(state);
    left = { kind: "and", left, right, span: spanCombine(left.span, right.span) };
  }
  return left;
}

function parseUnary(state: ParserState): Expr {
  const notTok = matchKeyword(state, "not");
  if (notTok) {
    const inner = parseUnary(state);
    return { kind: "not", expr: inner, span: spanCombine(notTok.span, inner.span) };
  }
  return parsePrimary(state);
}

function parsePrimary(state: ParserState): Expr {
  if (matchPunc(state, "(")) {
    const inner = parseExpr(state);
    expectPunc(state, ")");
    return inner;
  }
  return parsePredicate(state);
}

function parsePredicate(state: ParserState): Predicate {
  const head = peek(state);
  if (isKeyword(head, "count")) return parseCount(state);
  if (head.kind !== "ident") {
    throw bail(state, "Expected a field name or 'count(...)'", head.span);
  }
  return parseIdentPredicate(state);
}

function parseCount(state: ParserState): CountPred {
  const countTok = expectKeyword(state, "count");
  expectPunc(state, "(");
  const fieldTok = expectIdent(state);
  expectPunc(state, ",");
  const window = parseDuration(state);
  expectPunc(state, ")");
  const op = parseCmpOp(state);
  const threshold = parseIntLiteral(state);
  return {
    kind: "count",
    field: fieldTok.text,
    window,
    op,
    threshold,
    span: spanCombine(countTok.span, previousSpan(state)),
  };
}

function parseIdentPredicate(state: ParserState): Predicate {
  const fieldTok = expectIdent(state);
  const next = peek(state);

  if (isKeyword(next, "in")) return parseInPredicate(state, fieldTok);
  if (isKeyword(next, "failed")) {
    advance(state);
    return {
      kind: "failed",
      field: fieldTok.text,
      span: spanCombine(fieldTok.span, previousSpan(state)),
    };
  }
  if (next.kind === "op") {
    const op = parseCmpOp(state);
    const value = parseValue(state);
    return {
      kind: "cmp",
      field: fieldTok.text,
      op,
      value,
      span: spanCombine(fieldTok.span, value.span),
    };
  }
  return { kind: "bool", field: fieldTok.text, span: fieldTok.span };
}

function parseInPredicate(state: ParserState, fieldTok: Token): InPred {
  expectKeyword(state, "in");
  expectPunc(state, "{");
  const values: ValueExpr[] = [parseValue(state)];
  while (matchPunc(state, ",")) {
    values.push(parseValue(state));
  }
  expectPunc(state, "}");
  return {
    kind: "in",
    field: fieldTok.text,
    values,
    span: spanCombine(fieldTok.span, previousSpan(state)),
  };
}

function parseDuration(state: ParserState): Duration {
  const value = parseIntLiteral(state);
  const unitTok = expectIdent(state);
  if (!isTimeUnit(unitTok.text)) {
    throw bail(
      state,
      `Unknown duration unit '${unitTok.text}' (expected one of: ${TIME_UNITS.join(", ")})`,
      unitTok.span,
    );
  }
  return { value, unit: unitTok.text };
}

function parseValue(state: ParserState): ValueExpr {
  const tok = peek(state);
  if (tok.kind === "int") {
    advance(state);
    return { kind: "int", value: Number.parseInt(tok.text, 10), span: tok.span };
  }
  if (tok.kind === "string" || tok.kind === "ident") {
    advance(state);
    return { kind: "string", value: tok.text, span: tok.span };
  }
  throw bail(state, "Expected a value (integer, string, or identifier)", tok.span);
}

function parseCmpOp(state: ParserState): CmpOp {
  const tok = peek(state);
  if (tok.kind !== "op") {
    throw bail(state, "Expected a comparison operator (=, !=, <, <=, >, >=)", tok.span);
  }
  const op = SOURCE_CMP_OPS[tok.text];
  if (!op) {
    throw bail(state, `Unknown comparison operator '${tok.text}'`, tok.span);
  }
  advance(state);
  return op;
}

function parseIntLiteral(state: ParserState): number {
  const tok = peek(state);
  if (tok.kind !== "int") {
    throw bail(state, "Expected an integer literal", tok.span);
  }
  advance(state);
  return Number.parseInt(tok.text, 10);
}

function parseAction(state: ParserState): Action {
  const tok = peek(state);
  if (tok.kind === "kw" && ACTION_KEYWORDS.has(tok.text)) {
    advance(state);
    return tok.text.toUpperCase() as Action;
  }
  throw bail(state, "Expected an action (DECLINE, LOCK, WARM)", tok.span);
}

function isTimeUnit(text: string): text is TimeUnit {
  return (TIME_UNITS as readonly string[]).includes(text);
}

function isKeyword(tok: Token, kw: string): boolean {
  return tok.kind === "kw" && tok.text === kw;
}

function peek(state: ParserState): Token {
  return state.tokens[state.i] as Token;
}

function previous(state: ParserState): Token {
  return state.tokens[state.i - 1] as Token;
}

function previousSpan(state: ParserState): Span {
  return previous(state).span;
}

function previousEnd(state: ParserState): Position {
  const prev = state.tokens[state.i - 1];
  return prev ? prev.span.end : ZERO_POS;
}

function advance(state: ParserState): Token {
  const tok = state.tokens[state.i] as Token;
  state.i += 1;
  return tok;
}

function matchKeyword(state: ParserState, kw: string): Token | null {
  const tok = peek(state);
  if (isKeyword(tok, kw)) {
    advance(state);
    return tok;
  }
  return null;
}

function matchPunc(state: ParserState, p: string): Token | null {
  const tok = peek(state);
  if (tok.kind === "punc" && tok.text === p) {
    advance(state);
    return tok;
  }
  return null;
}

function expectKeyword(state: ParserState, kw: string): Token {
  const tok = peek(state);
  if (!isKeyword(tok, kw)) {
    throw bail(state, `Expected '${kw.toUpperCase()}'`, tok.span);
  }
  advance(state);
  return tok;
}

function expectIdent(state: ParserState): Token {
  const tok = peek(state);
  if (tok.kind !== "ident") {
    throw bail(state, "Expected an identifier (field name)", tok.span);
  }
  advance(state);
  return tok;
}

function expectPunc(state: ParserState, p: string): Token {
  const tok = peek(state);
  if (tok.kind !== "punc" || tok.text !== p) {
    throw bail(state, `Expected '${p}'`, tok.span);
  }
  advance(state);
  return tok;
}

function expectEof(state: ParserState): void {
  const tok = peek(state);
  if (tok.kind !== "eof") {
    throw bail(state, "Unexpected trailing input", tok.span);
  }
}

function isEmpty(state: ParserState): boolean {
  return state.tokens.length === 0 || state.tokens[0]?.kind === "eof";
}

function bail(_state: ParserState, message: string, span: Span | undefined): BailError {
  const err: DslError = span ? { kind: "syntax", message, span } : { kind: "syntax", message };
  return new BailError(err);
}

function spanCombine(a: Span, b: Span): Span {
  return { start: a.start, end: b.end };
}
