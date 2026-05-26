import type { Span } from "./common.js";

export type DslErrorKind =
  | "syntax"
  | "unknown-field"
  | "unknown-function"
  | "unknown-action"
  | "type-mismatch"
  | "unsupported-window"
  | "unsafe-expression"
  | "empty-source";

export type DslError = Readonly<{
  kind: DslErrorKind;
  message: string;
  span?: Span;
}>;
