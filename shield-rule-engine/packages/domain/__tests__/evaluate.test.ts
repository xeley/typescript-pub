import { describe, expect, it } from "vitest";
import { evaluate } from "../src/evaluate/evaluate.js";
import { bundle } from "../src/compile/compile.js";
import { velocityKey } from "../src/types/context.js";
import { durationMs } from "../src/types/common.js";
import type { AuthContext } from "../src/types/context.js";
import type { CompiledRule } from "../src/types/compiled.js";

function ctx(
  fields: AuthContext["fields"],
  velocity: AuthContext["velocityCounts"] = {},
  now: number = 0,
): AuthContext {
  return { fields, velocityCounts: velocity, now };
}

describe("evaluate", () => {
  it("returns the matching rule on MCC + country", () => {
    const mccRule: CompiledRule = {
      id: "mcc",
      then: "DECLINE",
      source: "",
      if: {
        and: [{ in: ["MCC", [5999, 4829]] }, { neq: ["country", "US"] }],
      },
    };
    const matches = evaluate(ctx({ MCC: 5999, country: "DE" }), bundle([mccRule]));
    expect(matches).toEqual([{ action: "DECLINE", triggeredRule: "mcc" }]);
  });

  it("returns no matches when MCC is in set but country is US", () => {
    const mccRule: CompiledRule = {
      id: "mcc",
      then: "DECLINE",
      source: "",
      if: {
        and: [{ in: ["MCC", [5999, 4829]] }, { neq: ["country", "US"] }],
      },
    };
    const matches = evaluate(ctx({ MCC: 5999, country: "US" }), bundle([mccRule]));
    expect(matches).toEqual([]);
  });

  it("handles CVV failed AND card_not_present", () => {
    const r: CompiledRule = {
      id: "cvv",
      then: "LOCK",
      source: "",
      if: { and: [{ failed: "CVV" }, { bool: "card_not_present" }] },
    };
    const yes = evaluate(ctx({ CVV: "failed", card_not_present: true }), bundle([r]));
    expect(yes).toHaveLength(1);

    const noCvv = evaluate(ctx({ CVV: "ok", card_not_present: true }), bundle([r]));
    expect(noCvv).toEqual([]);

    const noFlag = evaluate(ctx({ CVV: "failed", card_not_present: false }), bundle([r]));
    expect(noFlag).toEqual([]);
  });

  it("evaluates count(card, 10 min) > 5 using velocityCounts", () => {
    const r: CompiledRule = {
      id: "vel",
      then: "WARM",
      source: "",
      if: {
        count: {
          field: "card",
          window: { value: 10, unit: "min" },
          cmp: "gt",
          threshold: 5,
        },
      },
    };
    const windowMs = durationMs({ value: 10, unit: "min" });
    const above = evaluate(ctx({}, { [velocityKey("card", windowMs)]: 6 }), bundle([r]));
    expect(above).toHaveLength(1);

    const at = evaluate(ctx({}, { [velocityKey("card", windowMs)]: 5 }), bundle([r]));
    expect(at).toEqual([]);

    const missingCounter = evaluate(ctx({}, {}), bundle([r]));
    expect(missingCounter).toEqual([]);
  });

  it("handles NOT and OR", () => {
    const r: CompiledRule = {
      id: "complex",
      then: "DECLINE",
      source: "",
      if: {
        not: {
          or: [{ eq: ["MCC", 5999] }, { eq: ["MCC", 4829] }],
        },
      },
    };
    const matches = evaluate(ctx({ MCC: 1234 }), bundle([r]));
    expect(matches).toHaveLength(1);
    const noMatch = evaluate(ctx({ MCC: 5999 }), bundle([r]));
    expect(noMatch).toEqual([]);
  });

  it("returns matches in source order for multiple matching rules", () => {
    const r1: CompiledRule = { id: "a", then: "WARM", source: "", if: { gt: ["MCC", 0] } };
    const r2: CompiledRule = { id: "b", then: "DECLINE", source: "", if: { gt: ["MCC", 0] } };
    const matches = evaluate(ctx({ MCC: 1 }), bundle([r1, r2]));
    expect(matches.map((m) => m.triggeredRule)).toEqual(["a", "b"]);
  });

  it("treats missing fields as non-matching for cmp/in", () => {
    const r: CompiledRule = { id: "x", then: "DECLINE", source: "", if: { eq: ["MCC", 5999] } };
    expect(evaluate(ctx({}), bundle([r]))).toEqual([]);
  });
});
