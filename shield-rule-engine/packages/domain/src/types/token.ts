import type { Span } from "./common.js";

export type TokenKind = "kw" | "ident" | "int" | "string" | "punc" | "op" | "eof";

export type Token = Readonly<{
  kind: TokenKind;
  text: string;
  span: Span;
}>;

export const KEYWORDS = new Set<string>([
  "if",
  "then",
  "and",
  "or",
  "not",
  "in",
  "failed",
  "count",
  "decline",
  "lock",
  "warm",
]);

export const ACTION_KEYWORDS = new Set<string>(["decline", "lock", "warm"]);
