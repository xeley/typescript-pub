import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RulesetEvents, RulesetPublishedEvent, Unsubscribe } from "@shield/ports";
import { createFsRulesetEvents } from "../src/ruleset-events.js";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function waitForEvents(
  count: number,
  ms = 4000,
): Promise<{
  events: RulesetPublishedEvent[];
  onEvent: (e: RulesetPublishedEvent) => void;
  done: Promise<void>;
}> {
  const events: RulesetPublishedEvent[] = [];
  const d = deferred<void>();
  const timeout = setTimeout(() => {
    d.resolve();
  }, ms);
  const onEvent = (e: RulesetPublishedEvent) => {
    events.push(e);
    if (events.length >= count) {
      clearTimeout(timeout);
      d.resolve();
    }
  };
  return { events, onEvent, done: d.promise };
}

describe("fsRulesetEvents (integration)", () => {
  let dataDir: string;
  let events: RulesetEvents;
  let unsubscribe: Unsubscribe | null = null;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "shield-ruleset-events-"));
    events = createFsRulesetEvents({ dataDir });
  });

  afterEach(async () => {
    if (unsubscribe) {
      await unsubscribe();
      unsubscribe = null;
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  it("delivers a published event to a subscriber", async () => {
    const waiter = await waitForEvents(1);
    unsubscribe = await events.subscribe(waiter.onEvent);

    await events.publish({ type: "ruleset.published", tenantId: "acme", version: 1, ts: 100 });

    await waiter.done;
    expect(waiter.events).toEqual([
      { type: "ruleset.published", tenantId: "acme", version: 1, ts: 100 },
    ]);
  });

  it("delivers multiple events in publish order", async () => {
    const waiter = await waitForEvents(3);
    unsubscribe = await events.subscribe(waiter.onEvent);

    await events.publish({ type: "ruleset.published", tenantId: "acme", version: 1, ts: 1 });
    await events.publish({ type: "ruleset.published", tenantId: "acme", version: 2, ts: 2 });
    await events.publish({ type: "ruleset.published", tenantId: "globex", version: 7, ts: 3 });

    await waiter.done;
    expect(waiter.events.map((e) => `${e.tenantId}:${e.version}`)).toEqual([
      "acme:1",
      "acme:2",
      "globex:7",
    ]);
  });

  it("does NOT replay events published before subscribe was called", async () => {
    await events.publish({ type: "ruleset.published", tenantId: "acme", version: 1, ts: 1 });

    const waiter = await waitForEvents(1, 500);
    unsubscribe = await events.subscribe(waiter.onEvent);

    await waiter.done;
    expect(waiter.events).toEqual([]);
  });

  it("closes cleanly via the returned Unsubscribe", async () => {
    const seen: RulesetPublishedEvent[] = [];
    unsubscribe = await events.subscribe((e) => seen.push(e));
    await unsubscribe();
    unsubscribe = null;

    await events.publish({ type: "ruleset.published", tenantId: "acme", version: 5, ts: 1 });
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toEqual([]);
  });
});
