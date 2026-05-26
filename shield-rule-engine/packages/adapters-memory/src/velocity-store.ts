import { velocityKey, type VelocityRequirement } from "@shield/domain";
import type { AuthRequest, VelocityCounts, VelocityStore } from "@shield/ports";

export type MemoryVelocityStoreConfig = Readonly<{
  now?: () => number;
}>;

type EventLog = number[];

/**
 * Process-local sliding-window velocity counters.
 *
 * Stores one append-only array of event timestamps per `(tenantId, field,
 * fieldValue)` tuple — currently always `card`, since the v1 whitelist only
 * exposes `count(card, ...)`. Expired timestamps are pruned lazily on read.
 *
 * Counts are reported under the canonical `velocityKey(field, windowMs)` so
 * the Domain `evaluate` Operation can look them up without knowing how they
 * were stored.
 */
export function createMemoryVelocityStore(config: MemoryVelocityStoreConfig = {}): VelocityStore {
  const now = config.now ?? Date.now;
  const logs = new Map<string, EventLog>();

  return {
    async fetchFor(req: AuthRequest, requirements) {
      return computeCounts(req, requirements, logs, now());
    },
    async recordAttempt(req: AuthRequest) {
      recordEvent(req, logs, now());
    },
  };
}

function logKey(tenantId: string, field: string, fieldValue: string): string {
  return `${tenantId}|${field}|${fieldValue}`;
}

function recordEvent(req: AuthRequest, logs: Map<string, EventLog>, ts: number): void {
  const value = readFieldFor(req, "card");
  if (value === undefined) return;
  const key = logKey(req.tenantId, "card", value);
  const existing = logs.get(key);
  if (existing) existing.push(ts);
  else logs.set(key, [ts]);
}

function computeCounts(
  req: AuthRequest,
  requirements: readonly VelocityRequirement[],
  logs: Map<string, EventLog>,
  nowMs: number,
): VelocityCounts {
  const counts: Record<string, number> = {};
  for (const r of requirements) {
    counts[velocityKey(r.field, r.windowMs)] = countForRequirement(req, r, logs, nowMs);
  }
  return counts;
}

function countForRequirement(
  req: AuthRequest,
  requirement: VelocityRequirement,
  logs: Map<string, EventLog>,
  nowMs: number,
): number {
  const value = readFieldFor(req, requirement.field);
  if (value === undefined) return 0;
  const key = logKey(req.tenantId, requirement.field, value);
  const log = logs.get(key);
  if (!log) return 0;
  const cutoff = nowMs - requirement.windowMs;
  pruneOlderThan(log, cutoff);
  return log.length;
}

function pruneOlderThan(log: EventLog, cutoff: number): void {
  let dropped = 0;
  while (dropped < log.length && (log[dropped] as number) < cutoff) dropped += 1;
  if (dropped > 0) log.splice(0, dropped);
}

function readFieldFor(req: AuthRequest, field: string): string | undefined {
  if (field === "card") return req.cardId;
  const raw = req.fields[field];
  if (raw === undefined) return undefined;
  return String(raw);
}
