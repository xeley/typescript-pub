import { ACTIONS } from "../types/common.js";
import type { Whitelist } from "../types/whitelist.js";

/**
 * v1 bounded DSL surface, derived from REQUIREMENTS.md examples.
 *
 * The five fields and one function below are exactly what the three example
 * rules in REQUIREMENTS.md need. Anything outside this whitelist is rejected
 * by `validate`. The full client-supplied whitelist will replace this in a
 * follow-up phase.
 */
export const DEFAULT_WHITELIST: Whitelist = Object.freeze({
  fields: [
    { name: "MCC", type: "int" },
    { name: "country", type: "string" },
    { name: "CVV", type: "cvv" },
    { name: "card_not_present", type: "bool" },
    { name: "card", type: "string" },
  ],
  functions: [
    {
      name: "count",
      groupingFields: ["card"],
      allowedWindowUnits: ["sec", "min", "h", "d"],
      maxWindowValue: { sec: 86400, min: 1440, h: 24, d: 30 },
    },
  ],
  actions: ACTIONS,
});
