import type { AuthContext, Decision } from "@shield/domain";

export interface Audit {
  recordPublish(
    tenantId: string,
    from: number | null,
    to: number,
    actor: string | null,
  ): Promise<void>;
  recordEvaluation(tenantId: string, decision: Decision, ctx: AuthContext): Promise<void>;
}
