import type { Audit, RuleRepo, RulesetEvents } from "@shield/ports";

export type PublishRulesetInput = Readonly<{
  tenantId: string;
  version: number;
  actor?: string | null;
}>;

export type PublishRulesetDeps = Readonly<{
  ruleRepo: RuleRepo;
  rulesetEvents: RulesetEvents;
  audit: Audit;
  now?: () => number;
}>;

export type PublishRulesetResult = Readonly<{
  active: number;
  previous: number | null;
}>;

export class CompiledArtifactMissingError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly version: number,
  ) {
    super(
      `Cannot publish: no compiled artifact for tenant=${tenantId} version=${version}. ` +
        "Run compileRuleset first.",
    );
    this.name = "CompiledArtifactMissingError";
  }
}

/**
 * Stratum 3 Integration: atomically swap the active ruleset version for a
 * tenant, then notify subscribers (eval instances) and record the audit
 * entry.
 */
export async function publishRuleset(
  input: PublishRulesetInput,
  deps: PublishRulesetDeps,
): Promise<PublishRulesetResult> {
  const now = deps.now ?? Date.now;
  await assertCompiledExists(deps.ruleRepo, input);
  const previous = await deps.ruleRepo.activeVersion(input.tenantId);
  await deps.ruleRepo.markActive(input.tenantId, input.version);
  await deps.rulesetEvents.publish({
    type: "ruleset.published",
    tenantId: input.tenantId,
    version: input.version,
    ts: now(),
  });
  await deps.audit.recordPublish(input.tenantId, previous, input.version, input.actor ?? null);
  return { active: input.version, previous };
}

async function assertCompiledExists(repo: RuleRepo, input: PublishRulesetInput): Promise<void> {
  const exists = await repo.hasCompiled(input.tenantId, input.version);
  if (!exists) throw new CompiledArtifactMissingError(input.tenantId, input.version);
}
