import type { Decision, DecisionAction } from "@shield/domain";
import type { AuthRequest } from "@shield/ports";
import { evaluateAuth, type EvaluateAuthDeps } from "./evaluate-auth.js";

export type EvaluateAuthWithSlaDeps = EvaluateAuthDeps &
  Readonly<{
    slaMs: number;
  }>;

export type SlaOutcome = Readonly<{
  decision: Decision;
  slaTimeout: boolean;
  elapsedMs: number;
}>;

const SLA_FAIL_RULE = "__sla_timeout__";

/**
 * Stratum 3 Integration: enforces the 300 ms SLA by racing `evaluateAuth`
 * against a deadline. On timeout the call returns the configured fail-safe
 * action so the upstream issuer always gets a decision within budget.
 */
export async function evaluateAuthWithSla(
  req: AuthRequest,
  deps: EvaluateAuthWithSlaDeps,
): Promise<SlaOutcome> {
  const startedAt = nowFromReq(req);
  const raced = await raceWithDeadline(evaluateAuth(req, deps), deps.slaMs);
  return assembleOutcome(raced, deps.failSafe, startedAt);
}

function nowFromReq(req: AuthRequest): number {
  return req.now;
}

type RaceResult<T> = Readonly<{ kind: "ok"; value: T }> | Readonly<{ kind: "timeout" }>;

async function raceWithDeadline<T>(
  promise: Promise<T>,
  deadlineMs: number,
): Promise<RaceResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RaceResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), deadlineMs);
  });
  const ok = promise.then((value): RaceResult<T> => ({ kind: "ok", value }));
  try {
    return await Promise.race([ok, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assembleOutcome(
  raced: RaceResult<Decision>,
  failSafe: DecisionAction,
  startedAt: number,
): SlaOutcome {
  if (raced.kind === "ok") {
    return { decision: raced.value, slaTimeout: false, elapsedMs: Date.now() - startedAt };
  }
  return {
    decision: { action: failSafe, triggeredRule: SLA_FAIL_RULE },
    slaTimeout: true,
    elapsedMs: Date.now() - startedAt,
  };
}
