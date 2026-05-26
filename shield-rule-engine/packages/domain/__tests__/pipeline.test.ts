import { describe, expect, it } from "vitest";
import {
  bundle,
  compile,
  DEFAULT_WHITELIST,
  durationMs,
  evaluate,
  parse,
  selectDecision,
  tokenize,
  validate,
  velocityKey,
} from "../src/index.js";
import type { AuthContext } from "../src/types/context.js";
import type { CompiledRule, CompiledRuleset } from "../src/types/compiled.js";

/**
 * End-to-end Phase 1 acceptance: tokenize -> parse -> validate -> compile
 * -> evaluate -> selectDecision, for every rule in docs/REQUIREMENTS.md.
 *
 * This is the executable counterpart of docs/SPEC.md
 * "Feature: Authorization evaluation".
 */

const EXAMPLE_RULES: { id: string; source: string }[] = [
  {
    id: "mcc-non-us",
    source: "IF MCC in {5999, 4829} AND country != US THEN DECLINE",
  },
  {
    id: "cvv-cnp",
    source: "IF CVV failed AND card_not_present THEN LOCK",
  },
  {
    id: "velocity",
    source: "IF count(card, 10 min) > 5 THEN WARM",
  },
];

function buildRuleset(): CompiledRuleset {
  const compiled: CompiledRule[] = EXAMPLE_RULES.map(({ id, source }) => {
    const { tokens } = tokenize(source);
    const { rule, errors: parseErrors } = parse(tokens);
    expect(parseErrors, source).toEqual([]);
    if (!rule) throw new Error("parse failed: " + source);
    const { errors: validateErrors } = validate(rule, DEFAULT_WHITELIST);
    expect(validateErrors, source).toEqual([]);
    const { compiled: c, errors: compileErrors } = compile(rule, { id, source });
    expect(compileErrors, source).toEqual([]);
    if (!c) throw new Error("compile failed: " + source);
    return c;
  });
  return bundle(compiled);
}

function ctx(
  fields: AuthContext["fields"],
  velocity: AuthContext["velocityCounts"] = {},
): AuthContext {
  return { fields, velocityCounts: velocity, now: 0 };
}

describe("Phase 1 pipeline (SPEC.md § Authorization evaluation)", () => {
  const ruleset = buildRuleset();

  it("DECLINES on MCC in set + non-US country", () => {
    const matches = evaluate(
      ctx({ MCC: 5999, country: "DE", CVV: "ok", card_not_present: false }),
      ruleset,
    );
    const decision = selectDecision(matches, "APPROVE");
    expect(decision).toEqual({ action: "DECLINE", triggeredRule: "mcc-non-us" });
  });

  it("LOCKS on failed CVV in card-not-present", () => {
    const matches = evaluate(
      ctx({ MCC: 5411, country: "US", CVV: "failed", card_not_present: true }),
      ruleset,
    );
    const decision = selectDecision(matches, "APPROVE");
    expect(decision).toEqual({ action: "LOCK", triggeredRule: "cvv-cnp" });
  });

  it("WARMs on high-frequency card use", () => {
    const windowMs = durationMs({ value: 10, unit: "min" });
    const matches = evaluate(
      ctx(
        { MCC: 5411, country: "US", CVV: "ok", card_not_present: false },
        { [velocityKey("card", windowMs)]: 6 },
      ),
      ruleset,
    );
    const decision = selectDecision(matches, "APPROVE");
    expect(decision).toEqual({ action: "WARM", triggeredRule: "velocity" });
  });

  it("APPROVEs when no rule matches", () => {
    const windowMs = durationMs({ value: 10, unit: "min" });
    const matches = evaluate(
      ctx(
        { MCC: 5411, country: "US", CVV: "ok", card_not_present: false },
        { [velocityKey("card", windowMs)]: 1 },
      ),
      ruleset,
    );
    const decision = selectDecision(matches, "APPROVE");
    expect(decision).toEqual({ action: "APPROVE", triggeredRule: null });
  });

  it("first matching rule wins when multiple match", () => {
    const windowMs = durationMs({ value: 10, unit: "min" });
    const matches = evaluate(
      ctx(
        { MCC: 5999, country: "DE", CVV: "failed", card_not_present: true },
        { [velocityKey("card", windowMs)]: 10 },
      ),
      ruleset,
    );
    expect(matches.map((m) => m.triggeredRule)).toEqual(["mcc-non-us", "cvv-cnp", "velocity"]);
    const decision = selectDecision(matches, "APPROVE");
    expect(decision.action).toBe("DECLINE");
  });

  it("compiled ruleset is JSON-safe (round-trips through JSON.stringify)", () => {
    const roundTripped = JSON.parse(JSON.stringify(ruleset));
    expect(roundTripped).toEqual(ruleset);
  });
});
