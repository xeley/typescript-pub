/**
 * Errors that adapter implementations are expected to throw, and that use
 * cases catch / surface. Naming follows "<Subject><Reason>Error".
 */

export class RulesetNotFoundError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly version: number,
  ) {
    super(`Ruleset not found: tenant=${tenantId} version=${version}`);
    this.name = "RulesetNotFoundError";
  }
}

export class CompiledNotFoundError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly version: number,
  ) {
    super(`No compiled artifact for tenant=${tenantId} version=${version}`);
    this.name = "CompiledNotFoundError";
  }
}

export class TenantIdInvalidError extends Error {
  constructor(public readonly tenantId: string) {
    super(`Invalid tenantId: ${JSON.stringify(tenantId)}`);
    this.name = "TenantIdInvalidError";
  }
}
