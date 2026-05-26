/**
 * Shield Rule Engine — Phase 4 end-to-end CLI demo.
 *
 *   1. Spin up the Fastify eval service (shield-eval) on a random port,
 *      backed by a fresh DATA_DIR on disk.
 *   2. Seed + compile + publish a ruleset through the use cases against the
 *      real adapters-fs RuleRepo.
 *   3. Send real HTTP requests to POST /v1/evaluate covering APPROVE,
 *      DECLINE, LOCK and the velocity → WARM scenarios.
 *   4. Publish a NEW version of the ruleset (everything DECLINEs) and watch
 *      the eval service's chokidar subscriber invalidate its cache so the
 *      next request reflects the new rules.
 *   5. Shut down cleanly. Use `--keep` to leave the data dir for inspection.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createFsAudit, createFsRuleRepo, createFsRulesetEvents } from "@shield/adapters-fs";
import type { DraftRule } from "@shield/ports";
import { compileRuleset, publishRuleset } from "@shield/use-cases";
import { bootstrap, wire, type AppServer } from "@shield/shield-eval";

const TENANT = "acme";

const V1_RULES: readonly DraftRule[] = [
  {
    id: "mcc-non-us",
    position: 0,
    source: "IF MCC in {5999, 4829} AND country != US THEN DECLINE",
  },
  { id: "cvv-cnp", position: 1, source: "IF CVV failed AND card_not_present THEN LOCK" },
  { id: "velocity", position: 2, source: "IF count(card, 10 min) > 5 THEN WARM" },
];

const V2_RULES: readonly DraftRule[] = [
  { id: "everything-declines", position: 0, source: "IF MCC > 0 THEN DECLINE" },
];

type Scenario = Readonly<{
  name: string;
  body: Record<string, unknown>;
  expect: string;
}>;

const SCENARIOS_V1: readonly Scenario[] = [
  {
    name: "Clean transaction",
    body: {
      fields: { MCC: 5411, country: "US", CVV: "ok", card_not_present: false },
      cardId: "card-clean",
    },
    expect: "APPROVE",
  },
  {
    name: "MCC 5999 + non-US",
    body: {
      fields: { MCC: 5999, country: "DE", CVV: "ok", card_not_present: false },
      cardId: "card-decline",
    },
    expect: "DECLINE",
  },
  {
    name: "CVV failed + card-not-present",
    body: {
      fields: { MCC: 5411, country: "US", CVV: "failed", card_not_present: true },
      cardId: "card-lock",
    },
    expect: "LOCK",
  },
];

// ─── Integration ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const keep = process.argv.includes("--keep");
  const dataDir = await mkdtemp(join(tmpdir(), "shield-demo-"));

  printHeader(dataDir);
  const server = await startEvalServer(dataDir);
  const baseUrl = readBaseUrl(server);
  printServerReady(baseUrl);
  await publishV1(dataDir);
  await waitForCacheInvalidation(baseUrl, "card-warmup", "APPROVE");
  await runV1Scenarios(baseUrl);
  await runVelocityScenario(baseUrl);
  await publishV2(dataDir);
  await runV2Scenario(baseUrl);
  await shutdownAndCleanup(server, dataDir, keep);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

// ─── Operations (and small Integrations) ────────────────────────────────────

async function startEvalServer(dataDir: string): Promise<AppServer> {
  const deps = wire({
    dataDir,
    host: "127.0.0.1",
    port: 0,
    slaMs: 300,
    failSafe: "APPROVE",
    logLevel: "fatal",
  });
  return bootstrap(deps, { host: "127.0.0.1", port: 0 });
}

function readBaseUrl(server: AppServer): string {
  const addr = server.fastify.server.address() as AddressInfo;
  return `http://${addr.address}:${addr.port}`;
}

async function publishV1(dataDir: string): Promise<void> {
  await publishVersion(dataDir, 1, V1_RULES);
}

async function publishV2(dataDir: string): Promise<void> {
  printDivider("Publishing v2 (everything DECLINEs) — watch the cache invalidate…");
  await publishVersion(dataDir, 2, V2_RULES);
}

async function publishVersion(
  dataDir: string,
  version: number,
  rules: readonly DraftRule[],
): Promise<void> {
  const repo = createFsRuleRepo({ dataDir });
  const events = createFsRulesetEvents({ dataDir });
  const audit = createFsAudit({ dataDir });
  await repo.saveDraft(TENANT, version, rules);
  await compileRuleset({ tenantId: TENANT, version }, { ruleRepo: repo });
  await publishRuleset(
    { tenantId: TENANT, version, actor: "demo" },
    { ruleRepo: repo, rulesetEvents: events, audit },
  );
}

async function runV1Scenarios(baseUrl: string): Promise<void> {
  printDivider("v1 scenarios → POST /v1/evaluate");
  for (const sc of SCENARIOS_V1) {
    const result = await postEvaluate(baseUrl, sc.body);
    printScenarioLine(sc.name, sc.expect, result.action, result.triggeredRule, result.elapsedMs);
  }
}

async function runVelocityScenario(baseUrl: string): Promise<void> {
  printDivider("Velocity scenario: same card, 7 requests, rule says > 5 → WARM");
  const body = {
    fields: { MCC: 5411, country: "US", CVV: "ok", card_not_present: false },
    cardId: "card-velocity",
  };
  for (let i = 1; i <= 7; i += 1) {
    const result = await postEvaluate(baseUrl, body);
    const expected = i <= 5 ? "APPROVE" : "WARM";
    printScenarioLine(
      `request #${i}`,
      expected,
      result.action,
      result.triggeredRule,
      result.elapsedMs,
    );
  }
}

async function runV2Scenario(baseUrl: string): Promise<void> {
  printDivider("v2 scenario: a previously-APPROVED tx should now DECLINE");
  const body = {
    fields: { MCC: 5411, country: "US", CVV: "ok", card_not_present: false },
    cardId: "card-postupgrade",
  };
  await waitForCacheInvalidation(baseUrl, "card-probe", "DECLINE");
  const result = await postEvaluate(baseUrl, body);
  printScenarioLine(
    "clean tx after v2 publish",
    "DECLINE",
    result.action,
    result.triggeredRule,
    result.elapsedMs,
  );
}

async function waitForCacheInvalidation(
  baseUrl: string,
  probeCardId: string,
  expectedAction: string,
): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const probe = await postEvaluate(baseUrl, {
      fields: { MCC: 5411, country: "US", CVV: "ok", card_not_present: false },
      cardId: probeCardId,
    });
    if (probe.action === expectedAction) return;
    await sleep(50);
  }
}

async function postEvaluate(
  baseUrl: string,
  body: Record<string, unknown>,
): Promise<{ action: string; triggeredRule: string | null; elapsedMs: number }> {
  const res = await fetch(`${baseUrl}/v1/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": TENANT },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    action: string;
    triggeredRule: string | null;
    elapsedMs: number;
  };
  return json;
}

async function shutdownAndCleanup(
  server: AppServer,
  dataDir: string,
  keep: boolean,
): Promise<void> {
  await server.shutdown();
  if (keep) {
    console.log("");
    console.log(c.dim(`Data left at: ${dataDir}`));
    return;
  }
  await rm(dataDir, { recursive: true, force: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Printing ───────────────────────────────────────────────────────────────

function printHeader(dataDir: string): void {
  console.log(c.bold("Shield Rule Engine — Phase 4 demo (HTTP eval service)"));
  console.log(c.dim(`DATA_DIR: ${dataDir}`));
  console.log("");
}

function printServerReady(baseUrl: string): void {
  console.log(c.bold("shield-eval listening:"));
  console.log(`  ${c.cyan(baseUrl)}`);
  console.log("");
}

function printDivider(title: string): void {
  console.log("");
  console.log(c.bold(title));
}

function printScenarioLine(
  name: string,
  expected: string,
  actual: string,
  triggered: string | null,
  elapsedMs: number,
): void {
  const ok = expected === actual;
  const mark = ok ? c.green("PASS") : c.red("FAIL");
  const action = colorAction(actual);
  const trigger = triggered ? c.dim(`triggered by ${triggered}`) : c.dim("no rule matched");
  const ms = c.dim(`${elapsedMs}ms`);
  console.log(`  ${mark}  ${pad(name, 30)} → ${pad(action, 22)} ${pad(trigger, 26)} ${ms}`);
}

function colorAction(action: string): string {
  switch (action) {
    case "APPROVE":
      return c.green(action);
    case "WARM":
      return c.yellow(action);
    case "LOCK":
      return c.red(action);
    case "DECLINE":
      return c.bold(c.red(action));
    default:
      return action;
  }
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

const COLOR_ENABLED = Boolean(process.stdout.isTTY) && process.env["NO_COLOR"] === undefined;
const c = {
  bold: (s: string) => paint(s, "1"),
  dim: (s: string) => paint(s, "2"),
  red: (s: string) => paint(s, "31"),
  green: (s: string) => paint(s, "32"),
  yellow: (s: string) => paint(s, "33"),
  cyan: (s: string) => paint(s, "36"),
};

function paint(s: string, code: string): string {
  return COLOR_ENABLED ? `\x1b[${code}m${s}\x1b[0m` : s;
}
