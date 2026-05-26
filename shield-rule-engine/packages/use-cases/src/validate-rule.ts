import {
  compile,
  DEFAULT_WHITELIST,
  parse,
  tokenize,
  validate,
  type CompileOptions,
  type CompileRuleResult,
  type CompiledRule,
  type DslError,
  type ParseResult,
  type Rule,
  type Token,
  type TokenizeResult,
  type ValidateResult,
  type Whitelist,
} from "@shield/domain";

export type ValidateRuleInput = Readonly<{
  source: string;
  whitelist?: Whitelist;
  ruleId?: string;
}>;

export type ValidateRuleResult = Readonly<{
  source: string;
  tokens: readonly Token[];
  rule: Rule | null;
  compiled: CompiledRule | null;
  errors: readonly DslError[];
}>;

/**
 * Stratum 3 Integration: live-validation of a single rule source.
 *
 * Used by the editor UI to feed back syntax / semantic errors as the user
 * types. Pure — no ports, no I/O. Domain Operations only.
 */
export function validateRule(input: ValidateRuleInput): ValidateRuleResult {
  const whitelist = input.whitelist ?? DEFAULT_WHITELIST;
  const opts: CompileOptions = { id: input.ruleId ?? "preview", source: input.source };

  const tokenized = tokenize(input.source);
  const parsed = parse(tokenized.tokens);
  const validated = validateIfPresent(parsed.rule, whitelist);
  const compiled = compileIfPresent(parsed.rule, opts);
  return mergeValidationResults(input.source, tokenized, parsed, validated, compiled);
}

function validateIfPresent(rule: Rule | null, whitelist: Whitelist): ValidateResult | null {
  return rule ? validate(rule, whitelist) : null;
}

function compileIfPresent(rule: Rule | null, opts: CompileOptions): CompileRuleResult | null {
  return rule ? compile(rule, opts) : null;
}

function mergeValidationResults(
  source: string,
  tokenized: TokenizeResult,
  parsed: ParseResult,
  validated: ValidateResult | null,
  compiled: CompileRuleResult | null,
): ValidateRuleResult {
  const errors = collectErrors(tokenized, parsed, validated, compiled);
  return {
    source,
    tokens: tokenized.tokens,
    rule: parsed.rule,
    compiled: pickSafeCompiled(compiled, errors),
    errors,
  };
}

function pickSafeCompiled(
  compiled: CompileRuleResult | null,
  errors: readonly DslError[],
): CompiledRule | null {
  if (errors.length > 0) return null;
  return compiled?.compiled ?? null;
}

function collectErrors(
  tokenized: TokenizeResult,
  parsed: ParseResult,
  validated: ValidateResult | null,
  compiled: CompileRuleResult | null,
): readonly DslError[] {
  return [
    ...tokenized.errors,
    ...parsed.errors,
    ...(validated?.errors ?? []),
    ...(compiled?.errors ?? []),
  ];
}
