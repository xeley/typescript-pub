import { describe, expect, it } from "vitest";
import { selectDecision } from "../src/evaluate/selectDecision.js";
import type { Decision } from "../src/types/decision.js";

describe("selectDecision", () => {
  it("returns the first match when there are matches", () => {
    const matches: Decision[] = [
      { action: "WARM", triggeredRule: "a" },
      { action: "DECLINE", triggeredRule: "b" },
    ];
    expect(selectDecision(matches, "APPROVE")).toEqual(matches[0]);
  });

  it("returns the default action with a null triggeredRule when no match", () => {
    expect(selectDecision([], "APPROVE")).toEqual({
      action: "APPROVE",
      triggeredRule: null,
    });
  });

  it("respects a non-APPROVE default action", () => {
    expect(selectDecision([], "DECLINE")).toEqual({
      action: "DECLINE",
      triggeredRule: null,
    });
  });
});
