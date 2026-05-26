import type { AuthContext, Decision } from "@shield/domain";
import type { Audit } from "@shield/ports";

export type PublishEntry = Readonly<{
  type: "publish";
  tenantId: string;
  from: number | null;
  to: number;
  actor: string | null;
  ts: number;
}>;

export type EvaluationEntry = Readonly<{
  type: "evaluation";
  tenantId: string;
  decision: Decision;
  ctx: AuthContext;
  ts: number;
}>;

export type AuditEntry = PublishEntry | EvaluationEntry;

export type MemoryAudit = Audit & {
  entries(): readonly AuditEntry[];
  clear(): void;
};

export function createMemoryAudit(now: () => number = Date.now): MemoryAudit {
  const log: AuditEntry[] = [];
  return {
    async recordPublish(tenantId, from, to, actor) {
      log.push({ type: "publish", tenantId, from, to, actor, ts: now() });
    },
    async recordEvaluation(tenantId, decision, ctx) {
      log.push({ type: "evaluation", tenantId, decision, ctx, ts: now() });
    },
    entries() {
      return log;
    },
    clear() {
      log.length = 0;
    },
  };
}
