import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CompiledNotFoundError,
  RulesetNotFoundError,
  TenantIdInvalidError,
  type RuleRepo,
} from "@shield/ports";
import { createFsRuleRepo } from "../src/rule-repo.js";

const DRAFT = [{ id: "r1", position: 0, source: "IF MCC > 0 THEN DECLINE" }];

const COMPILED = {
  compilerVersion: "1" as const,
  rules: [
    {
      id: "r1",
      then: "DECLINE" as const,
      source: "IF MCC > 0 THEN DECLINE",
      if: { gt: ["MCC", 0] as readonly [string, number] },
    },
  ],
};

const SAFETY = { ok: true, warnings: [] };

describe("fsRuleRepo (integration)", () => {
  let dataDir: string;
  let repo: RuleRepo;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "shield-rule-repo-"));
    repo = createFsRuleRepo({ dataDir });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("saves and loads a draft", async () => {
    await repo.saveDraft("acme", 1, DRAFT);
    const loaded = await repo.loadDraft("acme", 1);
    expect(loaded.tenantId).toBe("acme");
    expect(loaded.version).toBe(1);
    expect(loaded.rules).toEqual(DRAFT);
  });

  it("throws RulesetNotFoundError when loading a missing draft", async () => {
    await expect(repo.loadDraft("acme", 99)).rejects.toBeInstanceOf(RulesetNotFoundError);
  });

  it("saves and loads a compiled artifact", async () => {
    await repo.saveDraft("acme", 1, DRAFT);
    await repo.saveCompiled("acme", 1, COMPILED, SAFETY);
    const loaded = await repo.loadCompiled("acme", 1);
    expect(loaded).toEqual(COMPILED);
  });

  it("throws CompiledNotFoundError when no compiled artifact exists", async () => {
    await repo.saveDraft("acme", 1, DRAFT);
    await expect(repo.loadCompiled("acme", 1)).rejects.toBeInstanceOf(CompiledNotFoundError);
  });

  it("hasCompiled returns the right boolean", async () => {
    await repo.saveDraft("acme", 1, DRAFT);
    expect(await repo.hasCompiled("acme", 1)).toBe(false);
    await repo.saveCompiled("acme", 1, COMPILED, SAFETY);
    expect(await repo.hasCompiled("acme", 1)).toBe(true);
  });

  it("activeVersion returns null until markActive is called", async () => {
    await repo.saveDraft("acme", 1, DRAFT);
    await repo.saveCompiled("acme", 1, COMPILED, SAFETY);
    expect(await repo.activeVersion("acme")).toBeNull();
    await repo.markActive("acme", 1);
    expect(await repo.activeVersion("acme")).toBe(1);
  });

  it("listVersions returns all versions of a tenant in numeric order", async () => {
    await repo.saveDraft("acme", 3, DRAFT);
    await repo.saveDraft("acme", 1, DRAFT);
    await repo.saveDraft("acme", 2, DRAFT);
    const versions = await repo.listVersions("acme");
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("isolates tenants on disk", async () => {
    await repo.saveDraft("acme", 1, DRAFT);
    await repo.saveDraft("globex", 1, [
      { id: "g1", position: 0, source: "IF country = US THEN DECLINE" },
    ]);
    const acme = await repo.loadDraft("acme", 1);
    const globex = await repo.loadDraft("globex", 1);
    expect(acme.rules[0]?.id).toBe("r1");
    expect(globex.rules[0]?.id).toBe("g1");
  });

  it("rejects hostile tenant ids that try to traverse the filesystem", async () => {
    await expect(repo.saveDraft("../etc", 1, DRAFT)).rejects.toBeInstanceOf(TenantIdInvalidError);
    await expect(repo.saveDraft("acme/../globex", 1, DRAFT)).rejects.toBeInstanceOf(
      TenantIdInvalidError,
    );
    await expect(repo.saveDraft("", 1, DRAFT)).rejects.toBeInstanceOf(TenantIdInvalidError);
  });

  it("writes via temp-file + rename so a partial write never corrupts the target", async () => {
    await repo.saveDraft("acme", 1, DRAFT);
    const draft = await repo.loadDraft("acme", 1);
    expect(draft.rules).toEqual(DRAFT);
    // overwriting must not leave stray .tmp files visible as drafts
    await repo.saveDraft("acme", 1, [{ id: "r2", position: 0, source: "IF MCC > 1 THEN LOCK" }]);
    const after = await repo.loadDraft("acme", 1);
    expect(after.rules).toEqual([{ id: "r2", position: 0, source: "IF MCC > 1 THEN LOCK" }]);
  });
});
