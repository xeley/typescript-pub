import { resolve } from "node:path";
import type { DecisionAction } from "@shield/domain";
import { defaultDataDir } from "@shield/shared";

export type Config = Readonly<{
  dataDir: string;
  host: string;
  port: number;
  slaMs: number;
  failSafe: DecisionAction;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
}>;

const FAIL_SAFE_ACTIONS: ReadonlySet<DecisionAction> = new Set([
  "APPROVE",
  "DECLINE",
  "LOCK",
  "WARM",
]);

/**
 * Operation: assemble a validated, frozen Config from environment vars +
 * sensible defaults. The composition root is the only file that calls this.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Object.freeze({
    dataDir: env["DATA_DIR"] ? resolve(env["DATA_DIR"]) : defaultDataDir(),
    host: env["HOST"] ?? "127.0.0.1",
    port: parsePort(env["PORT"], 3001),
    slaMs: parseSlaMs(env["SLA_MS"], 300),
    failSafe: parseFailSafe(env["FAIL_SAFE"]),
    logLevel: parseLogLevel(env["LOG_LEVEL"]),
  });
}

function parsePort(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return n;
}

function parseSlaMs(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid SLA_MS: ${raw}`);
  return n;
}

function parseFailSafe(raw: string | undefined): DecisionAction {
  // Default APPROVE: fraud-detection rules are "decline-on-match"; the
  // absence of a match means no flag, which should let the tx through.
  // Override via FAIL_SAFE=DECLINE for a deny-by-default posture.
  const upper = (raw ?? "APPROVE").toUpperCase() as DecisionAction;
  if (!FAIL_SAFE_ACTIONS.has(upper)) throw new Error(`Invalid FAIL_SAFE: ${raw}`);
  return upper;
}

function parseLogLevel(raw: string | undefined): Config["logLevel"] {
  const candidates: ReadonlyArray<Config["logLevel"]> = [
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
  ];
  const lower = (raw ?? "info").toLowerCase() as Config["logLevel"];
  if (!candidates.includes(lower)) throw new Error(`Invalid LOG_LEVEL: ${raw}`);
  return lower;
}
