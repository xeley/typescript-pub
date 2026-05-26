import { describe, expect, it } from "vitest";
import { tokenize } from "../src/dsl/tokenize.js";
import { parse } from "../src/dsl/parse.js";
import { validate } from "../src/dsl/validate.js";
import { DEFAULT_WHITELIST } from "../src/dsl/whitelist.js";
import type { Rule } from "../src/types/ast.js";

function parseSource(src: string): Rule {
  const { tokens } = tokenize(src);
  const { rule, errors } = parse(tokens);
  if (!rule) throw new Error(`parse failed: ${errors.map((e) => e.message).join(", ")}`);
  return rule;
}

describe("validate", () => {
  it("accepts the three REQUIREMENTS example rules", () => {
    const sources = [
      "IF MCC in {5999, 4829} AND country != US THEN DECLINE",
      "IF CVV failed AND card_not_present THEN LOCK",
      "IF count(card, 10 min) > 5 THEN WARM",
    ];
    for (const src of sources) {
      const rule = parseSource(src);
      const { errors } = validate(rule, DEFAULT_WHITELIST);
      expect(errors, src).toEqual([]);
    }
  });

  it("rejects an unknown field", () => {
    const rule = parseSource("IF wallet_color = blue THEN DECLINE");
    const { errors } = validate(rule, DEFAULT_WHITELIST);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe("unknown-field");
    expect(errors[0]?.message).toMatch(/wallet_color/);
  });

  it("rejects an int field compared against a string", () => {
    const rule = parseSource("IF MCC = grocery THEN DECLINE");
    const { errors } = validate(rule, DEFAULT_WHITELIST);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.kind).toBe("type-mismatch");
  });

  it("rejects a string field compared against an int", () => {
    const rule = parseSource("IF country = 42 THEN DECLINE");
    const { errors } = validate(rule, DEFAULT_WHITELIST);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.kind).toBe("type-mismatch");
  });

  it("rejects 'X failed' applied to a non-cvv field", () => {
    const rule = parseSource("IF MCC failed THEN DECLINE");
    const { errors } = validate(rule, DEFAULT_WHITELIST);
    expect(errors[0]?.kind).toBe("type-mismatch");
  });

  it("rejects a bare non-bool field", () => {
    const rule = parseSource("IF country THEN DECLINE");
    const { errors } = validate(rule, DEFAULT_WHITELIST);
    expect(errors[0]?.kind).toBe("type-mismatch");
  });

  it("rejects count() with a non-allowed grouping field", () => {
    const rule = parseSource("IF count(country, 10 min) > 5 THEN WARM");
    const { errors } = validate(rule, DEFAULT_WHITELIST);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.kind).toBe("type-mismatch");
  });

  it("rejects count() with an out-of-range window", () => {
    const rule = parseSource("IF count(card, 9999 min) > 5 THEN WARM");
    const { errors } = validate(rule, DEFAULT_WHITELIST);
    expect(errors[0]?.kind).toBe("unsupported-window");
  });

  it("accumulates multiple errors", () => {
    const rule = parseSource("IF wallet_color = blue AND mystery_field failed THEN DECLINE");
    const { errors } = validate(rule, DEFAULT_WHITELIST);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
