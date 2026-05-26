import { describe, expect, it } from "vitest";
import { tokenize } from "../src/dsl/tokenize.js";

describe("tokenize", () => {
  it("tokenizes the MCC + country example rule", () => {
    const { tokens, errors } = tokenize("IF MCC in {5999, 4829} AND country != US THEN DECLINE");
    expect(errors).toEqual([]);
    const summary = tokens.map((t) => `${t.kind}:${t.text}`);
    expect(summary).toEqual([
      "kw:if",
      "ident:MCC",
      "kw:in",
      "punc:{",
      "int:5999",
      "punc:,",
      "int:4829",
      "punc:}",
      "kw:and",
      "ident:country",
      "op:!=",
      "ident:US",
      "kw:then",
      "kw:decline",
      "eof:",
    ]);
  });

  it("tokenizes the CVV failed + bool example rule", () => {
    const { tokens, errors } = tokenize("IF CVV failed AND card_not_present THEN LOCK");
    expect(errors).toEqual([]);
    expect(tokens.map((t) => t.kind + ":" + t.text)).toEqual([
      "kw:if",
      "ident:CVV",
      "kw:failed",
      "kw:and",
      "ident:card_not_present",
      "kw:then",
      "kw:lock",
      "eof:",
    ]);
  });

  it("tokenizes the count() velocity example rule", () => {
    const { tokens, errors } = tokenize("IF count(card, 10 min) > 5 THEN WARM");
    expect(errors).toEqual([]);
    expect(tokens.map((t) => t.kind + ":" + t.text)).toEqual([
      "kw:if",
      "kw:count",
      "punc:(",
      "ident:card",
      "punc:,",
      "int:10",
      "ident:min",
      "punc:)",
      "op:>",
      "int:5",
      "kw:then",
      "kw:warm",
      "eof:",
    ]);
  });

  it("treats keywords case-insensitively but preserves identifier case", () => {
    const { tokens } = tokenize("if McC In {1} ThEn declinE");
    const summary = tokens.map((t) => `${t.kind}:${t.text}`);
    expect(summary).toContain("kw:if");
    expect(summary).toContain("ident:McC");
    expect(summary).toContain("kw:in");
    expect(summary).toContain("kw:then");
    expect(summary).toContain("kw:decline");
  });

  it("reads operators including two-char != <= >=", () => {
    const { tokens, errors } = tokenize("= != < <= > >=");
    expect(errors).toEqual([]);
    expect(tokens.filter((t) => t.kind === "op").map((t) => t.text)).toEqual([
      "=",
      "!=",
      "<",
      "<=",
      ">",
      ">=",
    ]);
  });

  it("reads double- and single-quoted strings", () => {
    const { tokens, errors } = tokenize(`"hello" 'world'`);
    expect(errors).toEqual([]);
    const strings = tokens.filter((t) => t.kind === "string").map((t) => t.text);
    expect(strings).toEqual(["hello", "world"]);
  });

  it("reports an error on an unterminated string", () => {
    const { errors } = tokenize(`IF country = "US`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.kind).toBe("syntax");
    expect(errors[0]?.message).toMatch(/Unterminated string/i);
  });

  it("reports an error on an unknown character but keeps tokenizing", () => {
    const { tokens, errors } = tokenize("IF @ THEN DECLINE");
    expect(errors.length).toBe(1);
    expect(errors[0]?.kind).toBe("syntax");
    const summary = tokens.map((t) => `${t.kind}:${t.text}`);
    expect(summary).toContain("kw:if");
    expect(summary).toContain("kw:then");
    expect(summary).toContain("kw:decline");
  });

  it("skips // line comments", () => {
    const { tokens, errors } = tokenize("IF MCC > 0 THEN DECLINE // trailing comment\n");
    expect(errors).toEqual([]);
    expect(tokens.at(-1)?.kind).toBe("eof");
  });

  it("tracks line and column positions across newlines", () => {
    const { tokens } = tokenize("IF MCC\n  > 0 THEN DECLINE");
    const gt = tokens.find((t) => t.text === ">");
    expect(gt?.span.start.line).toBe(2);
    expect(gt?.span.start.column).toBeGreaterThan(1);
  });
});
