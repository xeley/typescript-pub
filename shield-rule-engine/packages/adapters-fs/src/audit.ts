import type { Audit } from "@shield/ports";
import { appendJsonl } from "./io.js";
import { tenantPath } from "./paths.js";

export type FsAuditConfig = Readonly<{
  dataDir: string;
  now?: () => number;
}>;

export function createFsAudit(config: FsAuditConfig): Audit {
  const now = config.now ?? Date.now;
  const root = config.dataDir;

  const publishesPath = (tid: string) => tenantPath(root, tid, "audit", "publishes.jsonl");
  const evaluationsPath = (tid: string) => tenantPath(root, tid, "audit", "evaluations.jsonl");

  return {
    async recordPublish(tenantId, from, to, actor) {
      await appendJsonl(publishesPath(tenantId), {
        type: "publish",
        tenantId,
        from,
        to,
        actor,
        ts: now(),
      });
    },
    async recordEvaluation(tenantId, decision, ctx) {
      await appendJsonl(evaluationsPath(tenantId), {
        type: "evaluation",
        tenantId,
        decision,
        ctxFields: ctx.fields,
        ts: now(),
      });
    },
  };
}
