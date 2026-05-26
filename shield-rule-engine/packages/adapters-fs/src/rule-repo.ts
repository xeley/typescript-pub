import { readdir } from "node:fs/promises";
import type { CompiledRuleset } from "@shield/domain";
import type { DraftRule, RuleRepo, RulesetMeta, RulesetStatus } from "@shield/ports";
import { CompiledNotFoundError, RulesetNotFoundError } from "@shield/ports";
import { isFileNotFound, readJsonIfExists, writeJsonAtomic } from "./io.js";
import { tenantPath } from "./paths.js";

export type FsRuleRepoConfig = Readonly<{
  dataDir: string;
  now?: () => number;
}>;

type ActivePointer = Readonly<{
  version: number;
  since: number;
  actor: string | null;
}>;

type StoredMeta = Readonly<{
  version: number;
  status: RulesetStatus;
  createdBy: string | null;
  createdAt: number;
}>;

export function createFsRuleRepo(config: FsRuleRepoConfig): RuleRepo {
  const now = config.now ?? Date.now;
  const root = config.dataDir;

  const draftPath = (tid: string, v: number) =>
    tenantPath(root, tid, "rulesets", String(v), "draft.json");
  const metaPath = (tid: string, v: number) =>
    tenantPath(root, tid, "rulesets", String(v), "meta.json");
  const compiledPath = (tid: string, v: number) =>
    tenantPath(root, tid, "rulesets", String(v), "compiled.json");
  const safetyPath = (tid: string, v: number) =>
    tenantPath(root, tid, "rulesets", String(v), "safety.json");
  const activePath = (tid: string) => tenantPath(root, tid, "active.json");
  const rulesetsDir = (tid: string) => tenantPath(root, tid, "rulesets");

  return {
    async loadDraft(tenantId, version) {
      const rules = await readJsonIfExists<DraftRule[]>(draftPath(tenantId, version));
      if (rules === null) throw new RulesetNotFoundError(tenantId, version);
      return { tenantId, version, rules };
    },

    async saveDraft(tenantId, version, rules) {
      const existing = await readMeta(metaPath(tenantId, version));
      const meta: StoredMeta = existing
        ? { ...existing, status: "draft" }
        : { version, status: "draft", createdBy: null, createdAt: now() };
      await writeJsonAtomic(draftPath(tenantId, version), rules);
      await writeJsonAtomic(metaPath(tenantId, version), meta);
    },

    async loadCompiled(tenantId, version) {
      const ir = await readJsonIfExists<CompiledRuleset>(compiledPath(tenantId, version));
      if (ir === null) throw new CompiledNotFoundError(tenantId, version);
      return ir;
    },

    async saveCompiled(tenantId, version, ir, safety) {
      const meta = await readMetaOrThrow(metaPath(tenantId, version), tenantId, version);
      await writeJsonAtomic(compiledPath(tenantId, version), ir);
      await writeJsonAtomic(safetyPath(tenantId, version), safety);
      await writeJsonAtomic(metaPath(tenantId, version), { ...meta, status: "compiled" });
    },

    async hasCompiled(tenantId, version) {
      const ir = await readJsonIfExists<CompiledRuleset>(compiledPath(tenantId, version));
      return ir !== null;
    },

    async markActive(tenantId, version) {
      const meta = await readMetaOrThrow(metaPath(tenantId, version), tenantId, version);
      const pointer: ActivePointer = { version, since: now(), actor: null };
      await writeJsonAtomic(metaPath(tenantId, version), { ...meta, status: "active" });
      await writeJsonAtomic(activePath(tenantId), pointer);
    },

    async activeVersion(tenantId) {
      const pointer = await readJsonIfExists<ActivePointer>(activePath(tenantId));
      return pointer?.version ?? null;
    },

    async listVersions(tenantId) {
      const versionDirs = await listVersionDirs(rulesetsDir(tenantId));
      const metas = await Promise.all(versionDirs.map((v) => readMeta(metaPath(tenantId, v))));
      return metas
        .filter((m): m is StoredMeta => m !== null)
        .map((m) => toMeta(tenantId, m))
        .sort((a, b) => a.version - b.version);
    },
  };

  async function readMeta(path: string): Promise<StoredMeta | null> {
    return readJsonIfExists<StoredMeta>(path);
  }

  async function readMetaOrThrow(
    path: string,
    tenantId: string,
    version: number,
  ): Promise<StoredMeta> {
    const meta = await readMeta(path);
    if (!meta) throw new RulesetNotFoundError(tenantId, version);
    return meta;
  }
}

async function listVersionDirs(dir: string): Promise<number[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => Number.parseInt(e.name, 10))
      .filter((n) => Number.isInteger(n));
  } catch (err) {
    if (isFileNotFound(err)) return [];
    throw err;
  }
}

function toMeta(tenantId: string, stored: StoredMeta): RulesetMeta {
  return {
    tenantId,
    version: stored.version,
    status: stored.status,
    createdBy: stored.createdBy,
    createdAt: stored.createdAt,
  };
}
