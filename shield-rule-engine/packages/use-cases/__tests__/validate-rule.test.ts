import { describe, expect, it } from "vitest";
import { validateRule } from "../src/validate-rule.js";

describe("validateRule", () => {
  it("returns no errors and a compiled rule for the MCC example", () => {
    const result = validateRule({
      source: "IF MCC in {5999, 4829} AND country != US THEN DECLINE",
    });
    expect(result.errors).toEqual([]);
    expect(result.rule).not.toBeNull();
    expect(result.compiled?.then).toBe("DECLINE");
  });

  it("returns a syntax error for unterminated string", () => {
    const result = validateRule({ source: 'IF country = "US THEN DECLINE' });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.kind).toBe("syntax");
    expect(result.compiled).toBeNull();
  });

  it("returns an unknown-field error", () => {
    const result = validateRule({ source: "IF wallet_color = blue THEN DECLINE" });
    expect(result.errors.some((e) => e.kind === "unknown-field")).toBe(true);
    expect(result.compiled).toBeNull();
  });

  it("returns an empty-source error for blank input", () => {
    const result = validateRule({ source: "" });
    expect(result.errors[0]?.kind).toBe("empty-source");
    expect(result.compiled).toBeNull();
  });

  it("uses 'preview' as the default ruleId for compiled preview", () => {
    const result = validateRule({ source: "IF MCC > 0 THEN DECLINE" });
    expect(result.compiled?.id).toBe("preview");
  });

  it("respects an explicit ruleId override", () => {
    const result = validateRule({ source: "IF MCC > 0 THEN DECLINE", ruleId: "rule-42" });
    expect(result.compiled?.id).toBe("rule-42");
  });
});
