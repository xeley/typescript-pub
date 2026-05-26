import { resolve } from "node:path";
import { createFsAudit, createFsRuleRepo, createFsRulesetEvents } from "@shield/adapters-fs";
import type { Audit, RuleRepo, RulesetEvents } from "@shield/ports";
import { defaultDataDir } from "@shield/shared";

export type AdminDeps = Readonly<{
  dataDir: string;
  tenantId: string;
  ruleRepo: RuleRepo;
  rulesetEvents: RulesetEvents;
  audit: Audit;
}>;

/**
 * Composition root for the admin app. Memoized so the chokidar publisher
 * isn't re-created on every request — there is exactly one set of adapters
 * per process.
 */
let cachedDeps: AdminDeps | null = null;

export function getDeps(): AdminDeps {
  if (cachedDeps) return cachedDeps;
  const dataDir = resolveDataDir();
  const tenantId = readTenantId();
  cachedDeps = {
    dataDir,
    tenantId,
    ruleRepo: createFsRuleRepo({ dataDir }),
    rulesetEvents: createFsRulesetEvents({ dataDir }),
    audit: createFsAudit({ dataDir }),
  };
  return cachedDeps;
}

function resolveDataDir(): string {
  const raw = process.env["DATA_DIR"];
  return raw ? resolve(raw) : defaultDataDir();
}

function readTenantId(): string {
  return process.env["TENANT_ID"] ?? "acme";
}
