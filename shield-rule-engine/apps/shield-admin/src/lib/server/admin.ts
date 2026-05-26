import type { Draft, DraftRule, RuleRepo, RulesetMeta } from "@shield/ports";
import {
  compileRuleset,
  publishRuleset,
  validateRule,
  type CompileRulesetResult,
  type PublishRulesetResult,
  type ValidateRuleResult,
} from "@shield/use-cases";
import type { AdminDeps } from "./composition.js";

export type AdminState = Readonly<{
  tenantId: string;
  dataDir: string;
  activeVersion: number | null;
  versions: readonly RulesetMeta[];
  shownVersion: number | null;
  shownDraft: readonly DraftRule[];
}>;

export type PublishOutcome = Readonly<{
  savedAs: number;
  compile: CompileRulesetResult;
  published: PublishRulesetResult | null;
}>;

export type LineValidation = Readonly<{
  position: number;
  source: string;
  errors: ValidateRuleResult["errors"];
}>;

const RULE_ID_PREFIX = "r";

// ─── State (read) ───────────────────────────────────────────────────────────

export async function readState(deps: AdminDeps): Promise<AdminState> {
  const versions = await deps.ruleRepo.listVersions(deps.tenantId);
  const activeVersion = await deps.ruleRepo.activeVersion(deps.tenantId);
  const shown = await pickShownDraft(deps.ruleRepo, deps.tenantId, versions);
  return assembleState(deps, versions, activeVersion, shown);
}

async function pickShownDraft(
  repo: RuleRepo,
  tenantId: string,
  versions: readonly RulesetMeta[],
): Promise<{ version: number | null; draft: readonly DraftRule[] }> {
  if (versions.length === 0) return { version: null, draft: [] };
  const latest = versions[versions.length - 1] as RulesetMeta;
  const draft = await repo.loadDraft(tenantId, latest.version);
  return { version: latest.version, draft: draft.rules };
}

function assembleState(
  deps: AdminDeps,
  versions: readonly RulesetMeta[],
  activeVersion: number | null,
  shown: { version: number | null; draft: readonly DraftRule[] },
): AdminState {
  return {
    tenantId: deps.tenantId,
    dataDir: deps.dataDir,
    activeVersion,
    versions,
    shownVersion: shown.version,
    shownDraft: shown.draft,
  };
}

// ─── Validate (no persistence) ──────────────────────────────────────────────

export function validateText(text: string): readonly LineValidation[] {
  const rules = parseRulesText(text);
  return rules.map((r) => validateOne(r));
}

function validateOne(rule: DraftRule): LineValidation {
  const result = validateRule({ source: rule.source, ruleId: rule.id });
  return { position: rule.position, source: rule.source, errors: result.errors };
}

// ─── Publish: save draft → compile → publish ────────────────────────────────

export async function saveCompileAndPublish(
  deps: AdminDeps,
  text: string,
): Promise<PublishOutcome> {
  const rules = parseRulesText(text);
  const version = await pickNextVersion(deps);
  await deps.ruleRepo.saveDraft(deps.tenantId, version, rules);
  const compile = await compileRuleset(
    { tenantId: deps.tenantId, version },
    { ruleRepo: deps.ruleRepo },
  );
  const published = await publishIfSafe(deps, version, compile);
  return { savedAs: version, compile, published };
}

async function pickNextVersion(deps: AdminDeps): Promise<number> {
  const versions = await deps.ruleRepo.listVersions(deps.tenantId);
  return nextVersionNumber(versions);
}

function nextVersionNumber(versions: readonly RulesetMeta[]): number {
  if (versions.length === 0) return 1;
  return Math.max(...versions.map((v) => v.version)) + 1;
}

async function publishIfSafe(
  deps: AdminDeps,
  version: number,
  compile: CompileRulesetResult,
): Promise<PublishRulesetResult | null> {
  if (!compile.saved) return null;
  return publishRuleset(
    { tenantId: deps.tenantId, version, actor: "admin-ui" },
    { ruleRepo: deps.ruleRepo, rulesetEvents: deps.rulesetEvents, audit: deps.audit },
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function parseRulesText(text: string): DraftRule[] {
  const lines = text.split(/\r?\n/);
  const rules: DraftRule[] = [];
  let position = 0;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (skippableLine(trimmed)) continue;
    rules.push({ id: `${RULE_ID_PREFIX}${position + 1}`, position, source: trimmed });
    position += 1;
  }
  return rules;
}

function skippableLine(line: string): boolean {
  if (line.length === 0) return true;
  if (line.startsWith("//")) return true;
  return false;
}

export function draftToText(draft: readonly DraftRule[]): string {
  return draft.map((r) => r.source).join("\n");
}

export type { Draft, DraftRule, RulesetMeta };
