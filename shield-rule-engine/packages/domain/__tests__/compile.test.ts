import { describe, expect, it } from "vitest";
import { tokenize } from "../src/dsl/tokenize.js";
import { parse } from "../src/dsl/parse.js";
import { bundle, compile } from "../src/compile/compile.js";
import { COMPILER_VERSION } from "../src/types/compiled.js";
import type { Rule } from "../src/types/ast.js";

function parseSource(src: string): Rule {
  const { tokens } = tokenize(src);
  const { rule } = parse(tokens);
  if (!rule) throw new Error("parse failed");
  return rule;
}

describe("compile", () => {
  it("compiles MCC + country rule to the documented IR shape", () => {
    const rule = parseSource("IF MCC in {5999, 4829} AND country != US THEN DECLINE");
    const { compiled, errors } = compile(rule, { id: "r1", source: "<src>" });
    expect(errors).toEqual([]);
    expect(compiled).toEqual({
      id: "r1",
      then: "DECLINE",
      source: "<src>",
      if: {
        and: [{ in: ["MCC", [5999, 4829]] }, { neq: ["country", "US"] }],
      },
    });
  });

  it("compiles CVV failed AND card_not_present", () => {
    const rule = parseSource("IF CVV failed AND card_not_present THEN LOCK");
    const { compiled } = compile(rule, { id: "r2", source: "<src>" });
    expect(compiled?.if).toEqual({
      and: [{ failed: "CVV" }, { bool: "card_not_present" }],
    });
    expect(compiled?.then).toBe("LOCK");
  });

  it("compiles count(card, 10 min) > 5", () => {
    const rule = parseSource("IF count(card, 10 min) > 5 THEN WARM");
    const { compiled } = compile(rule, { id: "r3", source: "<src>" });
    expect(compiled?.if).toEqual({
      count: {
        field: "card",
        window: { value: 10, unit: "min" },
        cmp: "gt",
        threshold: 5,
      },
    });
  });

  it("compiles NOT and OR", () => {
    const rule = parseSource("IF NOT (MCC = 5999 OR MCC = 4829) AND country = US THEN DECLINE");
    const { compiled } = compile(rule, { id: "r4", source: "<src>" });
    expect(compiled?.if).toEqual({
      and: [
        {
          not: {
            or: [{ eq: ["MCC", 5999] }, { eq: ["MCC", 4829] }],
          },
        },
        { eq: ["country", "US"] },
      ],
    });
  });

  it("produces JSON-serializable IR (no functions, no Symbols)", () => {
    const rule = parseSource("IF MCC in {5999, 4829} AND country != US THEN DECLINE");
    const { compiled } = compile(rule, { id: "r1", source: "<src>" });
    const roundTrip = JSON.parse(JSON.stringify(compiled));
    expect(roundTrip).toEqual(compiled);
  });

  it("bundle() wraps rules with the compiler version", () => {
    const rule = parseSource("IF MCC > 0 THEN DECLINE");
    const { compiled } = compile(rule, { id: "r", source: "<src>" });
    if (!compiled) throw new Error("compile returned null");
    const ruleset = bundle([compiled]);
    expect(ruleset.compilerVersion).toBe(COMPILER_VERSION);
    expect(ruleset.rules).toHaveLength(1);
  });
});
