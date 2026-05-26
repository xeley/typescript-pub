import type { CompiledRuleset } from "@shield/domain";
import type {
  Draft,
  DraftRule,
  RuleRepo,
  RulesetMeta,
  RulesetStatus,
  SafetyReport,
} from "@shield/ports";
import { CompiledNotFoundError, RulesetNotFoundError } from "@shield/ports";

type VersionRecord = {
  meta: RulesetMeta;
  draft: readonly DraftRule[];
  compiled: CompiledRuleset | null;
  safety: SafetyReport | null;
};

type TenantState = {
  versions: Map<number, VersionRecord>;
  activeVersion: number | null;
};

export function createMemoryRuleRepo(now: () => number = Date.now): RuleRepo {
  const tenants = new Map<string, TenantState>();

  return {
    async loadDraft(tenantId, version) {
      const record = requireVersion(tenants, tenantId, version);
      return draftFrom(record);
    },
    async saveDraft(tenantId, version, rules) {
      const tenant = ensureTenant(tenants, tenantId);
      const existing = tenant.versions.get(version);
      const meta: RulesetMeta = existing?.meta ?? createMeta(tenantId, version, "draft", now());
      tenant.versions.set(version, {
        meta: { ...meta, status: "draft" },
        draft: rules,
        compiled: existing?.compiled ?? null,
        safety: existing?.safety ?? null,
      });
    },
    async loadCompiled(tenantId, version) {
      const record = requireVersion(tenants, tenantId, version);
      if (!record.compiled) throw new CompiledNotFoundError(tenantId, version);
      return record.compiled;
    },
    async saveCompiled(tenantId, version, ir, safety) {
      const tenant = ensureTenant(tenants, tenantId);
      const existing = requireVersion(tenants, tenantId, version);
      tenant.versions.set(version, {
        meta: { ...existing.meta, status: "compiled" },
        draft: existing.draft,
        compiled: ir,
        safety,
      });
    },
    async hasCompiled(tenantId, version) {
      return Boolean(tenants.get(tenantId)?.versions.get(version)?.compiled);
    },
    async markActive(tenantId, version) {
      const tenant = ensureTenant(tenants, tenantId);
      const record = requireVersion(tenants, tenantId, version);
      tenant.activeVersion = version;
      tenant.versions.set(version, { ...record, meta: { ...record.meta, status: "active" } });
    },
    async activeVersion(tenantId) {
      return tenants.get(tenantId)?.activeVersion ?? null;
    },
    async listVersions(tenantId) {
      const tenant = tenants.get(tenantId);
      if (!tenant) return [];
      return Array.from(tenant.versions.values())
        .map((r) => r.meta)
        .sort((a, b) => a.version - b.version);
    },
  };
}

function ensureTenant(tenants: Map<string, TenantState>, tenantId: string): TenantState {
  const existing = tenants.get(tenantId);
  if (existing) return existing;
  const fresh: TenantState = { versions: new Map(), activeVersion: null };
  tenants.set(tenantId, fresh);
  return fresh;
}

function requireVersion(
  tenants: Map<string, TenantState>,
  tenantId: string,
  version: number,
): VersionRecord {
  const record = tenants.get(tenantId)?.versions.get(version);
  if (!record) throw new RulesetNotFoundError(tenantId, version);
  return record;
}

function createMeta(
  tenantId: string,
  version: number,
  status: RulesetStatus,
  ts: number,
): RulesetMeta {
  return { tenantId, version, status, createdBy: null, createdAt: ts };
}

function draftFrom(record: VersionRecord): Draft {
  return {
    tenantId: record.meta.tenantId,
    version: record.meta.version,
    rules: record.draft,
  };
}
