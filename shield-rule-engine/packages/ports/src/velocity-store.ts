import type { VelocityRequirement } from "@shield/domain";
import type { AuthRequest, VelocityCounts } from "./types.js";

export interface VelocityStore {
  /**
   * Record that an evaluation attempt happened for `req`. v1 counts every
   * attempt; future versions may split this into attempt-vs-decision so
   * declined requests don't inflate velocity.
   */
  recordAttempt(req: AuthRequest): Promise<void>;
  /**
   * Return the velocity counts the evaluator needs, keyed by
   * `velocityKey(field, windowMs)`. Counts INCLUDE attempts already
   * recorded via `recordAttempt`.
   */
  fetchFor(req: AuthRequest, requirements: readonly VelocityRequirement[]): Promise<VelocityCounts>;
}
