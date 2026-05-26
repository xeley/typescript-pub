import type { Position, Span } from "../types/common.js";
import type { DslError } from "../types/error.js";
import { KEYWORDS, type Token, type TokenKind } from "../types/token.js";

export type TokenizeResult = Readonly<{
  tokens: Token[];
  errors: DslError[];
}>;

type Cursor = {
  src: string;
  i: number;
  line: number;
  col: number;
};

/**
 * Pure Operation: source string -> tokens + lexical errors.
 *
 * Never throws. Unknown characters are recorded as errors and skipped so
 * the rest of the source still produces useful tokens for the editor.
 */
export function tokenize(source: string): TokenizeResult {
  const cur: Cursor = { src: source, i: 0, line: 1, col: 1 };
  const tokens: Token[] = [];
  const errors: DslError[] = [];

  while (cur.i < cur.src.length) {
    skipTrivia(cur);
    if (cur.i >= cur.src.length) break;
    const start = posOf(cur);
    const ch = cur.src[cur.i] as string;

    if (isDigit(ch)) {
      tokens.push(readInteger(cur, start));
      continue;
    }
    if (ch === '"' || ch === "'") {
      const result = readString(cur, start);
      tokens.push(result.token);
      if (result.error) errors.push(result.error);
      continue;
    }
    if (isIdentStart(ch)) {
      tokens.push(readIdentifierOrKeyword(cur, start));
      continue;
    }
    if (isOperatorChar(ch)) {
      tokens.push(readOperator(cur, start));
      continue;
    }
    if (isPunctuation(ch)) {
      advance(cur);
      tokens.push({ kind: "punc", text: ch, span: spanOf(start, posOf(cur)) });
      continue;
    }

    advance(cur);
    errors.push({
      kind: "syntax",
      message: `Unexpected character ${JSON.stringify(ch)}`,
      span: spanOf(start, posOf(cur)),
    });
  }

  const eofStart = posOf(cur);
  tokens.push({ kind: "eof", text: "", span: spanOf(eofStart, eofStart) });
  return { tokens, errors };
}

function skipTrivia(cur: Cursor): void {
  while (cur.i < cur.src.length) {
    const ch = cur.src[cur.i] as string;
    if (ch === " " || ch === "\t" || ch === "\r") {
      advance(cur);
      continue;
    }
    if (ch === "\n") {
      cur.i += 1;
      cur.line += 1;
      cur.col = 1;
      continue;
    }
    if (ch === "/" && cur.src[cur.i + 1] === "/") {
      while (cur.i < cur.src.length && cur.src[cur.i] !== "\n") advance(cur);
      continue;
    }
    break;
  }
}

function readInteger(cur: Cursor, start: Position): Token {
  let text = "";
  while (cur.i < cur.src.length && isDigit(cur.src[cur.i] as string)) {
    text += cur.src[cur.i];
    advance(cur);
  }
  return { kind: "int", text, span: spanOf(start, posOf(cur)) };
}

function readString(cur: Cursor, start: Position): { token: Token; error: DslError | null } {
  const quote = cur.src[cur.i] as string;
  advance(cur);
  let body = "";
  let closed = false;
  while (cur.i < cur.src.length) {
    const ch = cur.src[cur.i] as string;
    if (ch === quote) {
      advance(cur);
      closed = true;
      break;
    }
    if (ch === "\n") break;
    body += ch;
    advance(cur);
  }
  const span = spanOf(start, posOf(cur));
  if (!closed) {
    return {
      token: { kind: "string", text: body, span },
      error: { kind: "syntax", message: "Unterminated string literal", span },
    };
  }
  return { token: { kind: "string", text: body, span }, error: null };
}

function readIdentifierOrKeyword(cur: Cursor, start: Position): Token {
  let text = "";
  while (cur.i < cur.src.length && isIdentCont(cur.src[cur.i] as string)) {
    text += cur.src[cur.i];
    advance(cur);
  }
  const lowered = text.toLowerCase();
  const kind: TokenKind = KEYWORDS.has(lowered) ? "kw" : "ident";
  const canonical = kind === "kw" ? lowered : text;
  return { kind, text: canonical, span: spanOf(start, posOf(cur)) };
}

function readOperator(cur: Cursor, start: Position): Token {
  const ch = cur.src[cur.i] as string;
  const next = cur.src[cur.i + 1];
  advance(cur);
  const isTwoChar =
    (ch === "!" && next === "=") || (ch === "<" && next === "=") || (ch === ">" && next === "=");
  const text = isTwoChar ? ch + (next as string) : ch;
  if (isTwoChar) advance(cur);
  return { kind: "op", text, span: spanOf(start, posOf(cur)) };
}

function advance(cur: Cursor): void {
  cur.i += 1;
  cur.col += 1;
}

function posOf(cur: Cursor): Position {
  return { offset: cur.i, line: cur.line, column: cur.col };
}

function spanOf(start: Position, end: Position): Span {
  return { start, end };
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentCont(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function isOperatorChar(ch: string): boolean {
  return ch === "=" || ch === "!" || ch === "<" || ch === ">";
}

function isPunctuation(ch: string): boolean {
  return ch === "{" || ch === "}" || ch === "(" || ch === ")" || ch === ",";
}
