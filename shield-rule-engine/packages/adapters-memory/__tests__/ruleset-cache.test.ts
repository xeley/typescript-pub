import { beforeEach, describe, expect, it, vi } from "vitest";
import { compile, bundle } from "@shield/domain";
import { parse, tokenize } from "@shield/domain";
import {
  createMemoryRuleRepo,
  createMemoryRulesetCache,
  NoActiveRulesetError,
} from "../src/index.js";

function compileSourceToRuleset(id: string, source: string) {
  const tokens = tokenize(source);
  const parsed = parse(tokens.tokens);
  if (!parsed.rule) throw new Error(`parse failed: ${source}`);
  const compiled = compile(parsed.rule, { id, source });
  if (!compiled.compiled) throw new Error(`compile failed: ${source}`);
  return bundle([compiled.compiled]);
}

describe("memoryRulesetCache", () => {
  let repo: ReturnType<typeof createMemoryRuleRepo>;

  beforeEach(() => {
    repo = createMemoryRuleRepo();
  });

  it("throws NoActiveRulesetError when the tenant has no active version", async () => {
    const cache = createMemoryRulesetCache({ ruleRepo: repo });
    await expect(cache.getOrLoad("ghost")).rejects.toBeInstanceOf(NoActiveRulesetError);
  });

  it("loads from the repo on first call, then serves cached copies", async () => {
    const ruleset = compileSourceToRuleset("r1", "IF MCC > 0 THEN DECLINE");
    await repo.saveDraft("acme", 1, [{ id: "r1", position: 0, source: "IF MCC > 0 THEN DECLINE" }]);
    await repo.saveCompiled("acme", 1, ruleset, { ok: true, warnings: [] });
    await repo.markActive("acme", 1);

    const loadSpy = vi.spyOn(repo, "loadCompiled");
    const cache = createMemoryRulesetCache({ ruleRepo: repo });

    const first = await cache.getOrLoad("acme");
    const second = await cache.getOrLoad("acme");
    expect(first).toBe(second);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it("re-loads from the repo after invalidate(tenantId)", async () => {
    const ruleset = compileSourceToRuleset("r1", "IF MCC > 0 THEN DECLINE");
    await repo.saveDraft("acme", 1, [{ id: "r1", position: 0, source: "IF MCC > 0 THEN DECLINE" }]);
    await repo.saveCompiled("acme", 1, ruleset, { ok: true, warnings: [] });
    await repo.markActive("acme", 1);

    const loadSpy = vi.spyOn(repo, "loadCompiled");
    const cache = createMemoryRulesetCache({ ruleRepo: repo });

    await cache.getOrLoad("acme");
    await cache.invalidate("acme");
    await cache.getOrLoad("acme");
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });

  it("invalidateAll drops every tenant from the cache", async () => {
    const ruleset = compileSourceToRuleset("r1", "IF MCC > 0 THEN DECLINE");
    await repo.saveDraft("acme", 1, [{ id: "r1", position: 0, source: "IF MCC > 0 THEN DECLINE" }]);
    await repo.saveCompiled("acme", 1, ruleset, { ok: true, warnings: [] });
    await repo.markActive("acme", 1);
    await repo.saveDraft("globex", 1, [
      { id: "r1", position: 0, source: "IF MCC > 0 THEN DECLINE" },
    ]);
    await repo.saveCompiled("globex", 1, ruleset, { ok: true, warnings: [] });
    await repo.markActive("globex", 1);

    const cache = createMemoryRulesetCache({ ruleRepo: repo });
    await cache.getOrLoad("acme");
    await cache.getOrLoad("globex");
    const loadSpy = vi.spyOn(repo, "loadCompiled");
    await cache.invalidateAll();
    await cache.getOrLoad("acme");
    await cache.getOrLoad("globex");
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });
});
