import type { Action } from "./common.js";

export type DecisionAction = Action | "APPROVE";

export type Decision = Readonly<{
  action: DecisionAction;
  triggeredRule: string | null;
}>;
