import type { Decision, DecisionAction } from "../types/decision.js";

/**
 * Pure Operation: pick the final Decision from the matches `evaluate`
 * produced.
 *
 * v1 policy is "first matching rule wins". When no rule matches the
 * `defaultAction` is returned (typically APPROVE; see REQUIREMENTS.md Open
 * Questions for client confirmation).
 */
export function selectDecision(
  matches: readonly Decision[],
  defaultAction: DecisionAction,
): Decision {
  const first = matches[0];
  if (first) return first;
  return { action: defaultAction, triggeredRule: null };
}
