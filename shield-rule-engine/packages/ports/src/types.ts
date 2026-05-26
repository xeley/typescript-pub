import type { AuthContext } from "@shield/domain";

/**
 * Shared data shapes used by ports. These are persistence / orchestration
 * concepts — kept out of `@shield/domain` so the Domain stratum stays unaware
 * of how rules are stored or shipped between processes.
 */

export type DraftRule = Readonly<{
  id: string;
  source: string;
  position: number;
}>;

export type Draft = Readonly<{
  tenantId: string;
  version: number;
  rules: readonly DraftRule[];
}>;

export type RulesetStatus = "draft" | "compiled" | "active" | "retired";

export type RulesetMeta = Readonly<{
  tenantId: string;
  version: number;
  status: RulesetStatus;
  createdBy: string | null;
  createdAt: number;
}>;

export type SafetyReport = Readonly<{
  ok: boolean;
  warnings: readonly string[];
}>;

export type AuthRequest = Readonly<{
  tenantId: string;
  fields: AuthContext["fields"];
  cardId: string | undefined;
  now: number;
}>;

export type VelocityCounts = AuthContext["velocityCounts"];

export type RulesetPublishedEvent = Readonly<{
  type: "ruleset.published";
  tenantId: string;
  version: number;
  ts: number;
}>;

export type Unsubscribe = () => Promise<void>;

export type { AuthContext, CompiledRuleset, Decision } from "@shield/domain";
export type { VelocityRequirement } from "@shield/domain";
