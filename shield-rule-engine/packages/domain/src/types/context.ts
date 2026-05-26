export type FieldValue = number | string | boolean;

/**
 * Inputs the evaluator needs to decide a single authorization request.
 *
 * The Domain stratum is pure: velocity counts are computed by the
 * Integration stratum (use cases / adapters) and passed in here.
 *
 * `velocityCounts` keys are formatted as `${field}|${windowMs}` so the same
 * key shape works for in-process maps today and Redis keys tomorrow.
 */
export type AuthContext = Readonly<{
  fields: Readonly<Record<string, FieldValue | undefined>>;
  velocityCounts: Readonly<Record<string, number>>;
  now: number;
}>;

export function velocityKey(field: string, windowMs: number): string {
  return `${field}|${windowMs}`;
}
