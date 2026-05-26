import { describe, expect, it } from "vitest";
import { durationMs, velocityKey } from "@shield/domain";
import type { AuthRequest } from "@shield/ports";
import { createMemoryVelocityStore } from "../src/index.js";

const WIN_10M = durationMs({ value: 10, unit: "min" });
const CARD_REQ = [{ field: "card", windowMs: WIN_10M }];

function req(tenantId: string, cardId: string, now: number): AuthRequest {
  return { tenantId, fields: {}, cardId, now };
}

describe("memoryVelocityStore", () => {
  it("returns 0 for a card it has never seen", async () => {
    const store = createMemoryVelocityStore({ now: () => 0 });
    const counts = await store.fetchFor(req("acme", "c1", 0), CARD_REQ);
    expect(counts[velocityKey("card", WIN_10M)]).toBe(0);
  });

  it("counts events inside the window", async () => {
    let clock = 0;
    const store = createMemoryVelocityStore({ now: () => clock });
    for (let i = 0; i < 3; i += 1) {
      await store.recordAttempt(req("acme", "c1", clock));
      clock += 1000;
    }
    const counts = await store.fetchFor(req("acme", "c1", clock), CARD_REQ);
    expect(counts[velocityKey("card", WIN_10M)]).toBe(3);
  });

  it("prunes events older than the window", async () => {
    let clock = 0;
    const store = createMemoryVelocityStore({ now: () => clock });
    await store.recordAttempt(req("acme", "c1", clock));
    clock += WIN_10M + 1;
    await store.recordAttempt(req("acme", "c1", clock));
    const counts = await store.fetchFor(req("acme", "c1", clock), CARD_REQ);
    expect(counts[velocityKey("card", WIN_10M)]).toBe(1);
  });

  it("isolates counts between tenants and between cards", async () => {
    const clock = 1000;
    const store = createMemoryVelocityStore({ now: () => clock });
    for (let i = 0; i < 5; i += 1) {
      await store.recordAttempt(req("acme", "loud", clock));
    }
    const otherCard = await store.fetchFor(req("acme", "quiet", clock), CARD_REQ);
    const otherTenant = await store.fetchFor(req("globex", "loud", clock), CARD_REQ);
    expect(otherCard[velocityKey("card", WIN_10M)]).toBe(0);
    expect(otherTenant[velocityKey("card", WIN_10M)]).toBe(0);
  });
});
