import { describe, expect, it } from "vitest";
import { tokenize } from "../src/dsl/tokenize.js";
import { parse } from "../src/dsl/parse.js";

function parseSource(src: string) {
  const { tokens } = tokenize(src);
  return parse(tokens);
}

describe("parse", () => {
  it("parses MCC in {…} AND country != US THEN DECLINE", () => {
    const { rule, errors } = parseSource("IF MCC in {5999, 4829} AND country != US THEN DECLINE");
    expect(errors).toEqual([]);
    expect(rule).toBeTruthy();
    expect(rule?.then).toBe("DECLINE");
    expect(rule?.if.kind).toBe("and");
    const cond = rule?.if as Extract<NonNullable<typeof rule>["if"], { kind: "and" }>;
    expect(cond.left.kind).toBe("in");
    expect(cond.right.kind).toBe("cmp");
  });

  it("parses CVV failed AND card_not_present THEN LOCK", () => {
    const { rule, errors } = parseSource("IF CVV failed AND card_not_present THEN LOCK");
    expect(errors).toEqual([]);
    expect(rule?.then).toBe("LOCK");
    const cond = rule?.if as Extract<NonNullable<typeof rule>["if"], { kind: "and" }>;
    expect(cond.left.kind).toBe("failed");
    expect(cond.right.kind).toBe("bool");
  });

  it("parses count(card, 10 min) > 5 THEN WARM", () => {
    const { rule, errors } = parseSource("IF count(card, 10 min) > 5 THEN WARM");
    expect(errors).toEqual([]);
    expect(rule?.then).toBe("WARM");
    const cond = rule?.if as Extract<NonNullable<typeof rule>["if"], { kind: "count" }>;
    expect(cond.kind).toBe("count");
    expect(cond.field).toBe("card");
    expect(cond.window).toEqual({ value: 10, unit: "min" });
    expect(cond.op).toBe("gt");
    expect(cond.threshold).toBe(5);
  });

  it("parses NOT, OR, and parentheses", () => {
    const { rule, errors } = parseSource(
      "IF NOT (MCC = 5999 OR MCC = 4829) AND country = US THEN DECLINE",
    );
    expect(errors).toEqual([]);
    expect(rule?.if.kind).toBe("and");
    const top = rule?.if as Extract<NonNullable<typeof rule>["if"], { kind: "and" }>;
    expect(top.left.kind).toBe("not");
  });

  it("reports a syntax error on missing THEN", () => {
    const { rule, errors } = parseSource("IF MCC > 0 DECLINE");
    expect(rule).toBeNull();
    expect(errors[0]?.kind).toBe("syntax");
    expect(errors[0]?.message).toMatch(/THEN/i);
  });

  it("reports a syntax error on unknown action", () => {
    const { rule, errors } = parseSource("IF MCC > 0 THEN EXPLODE");
    expect(rule).toBeNull();
    expect(errors[0]?.kind).toBe("syntax");
    expect(errors[0]?.message).toMatch(/action/i);
  });

  it("reports a syntax error on missing closing brace", () => {
    const { rule, errors } = parseSource("IF MCC in {1, 2 THEN DECLINE");
    expect(rule).toBeNull();
    expect(errors[0]?.kind).toBe("syntax");
  });

  it("reports a syntax error on empty source", () => {
    const { rule, errors } = parseSource("");
    expect(rule).toBeNull();
    expect(errors[0]?.kind).toBe("empty-source");
  });

  it("reports an unknown duration unit", () => {
    const { rule, errors } = parseSource("IF count(card, 10 years) > 5 THEN WARM");
    expect(rule).toBeNull();
    expect(errors[0]?.message).toMatch(/years/);
  });

  it("attaches source spans to errors", () => {
    const { errors } = parseSource("IF MCC > THEN DECLINE");
    expect(errors[0]?.span).toBeDefined();
  });
});
