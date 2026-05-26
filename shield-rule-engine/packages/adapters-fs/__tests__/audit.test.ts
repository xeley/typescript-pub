import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Audit } from "@shield/ports";
import { createFsAudit } from "../src/audit.js";

describe("fsAudit (integration)", () => {
  let dataDir: string;
  let audit: Audit;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "shield-audit-"));
    audit = createFsAudit({ dataDir });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("appends one JSON line per publish record", async () => {
    await audit.recordPublish("acme", null, 1, "alice");
    await audit.recordPublish("acme", 1, 2, "bob");
    const body = await readFile(
      join(dataDir, "tenants", "acme", "audit", "publishes.jsonl"),
      "utf8",
    );
    const lines = body.trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] as string);
    expect(first.type).toBe("publish");
    expect(first.tenantId).toBe("acme");
    expect(first.from).toBeNull();
    expect(first.to).toBe(1);
    expect(first.actor).toBe("alice");
  });

  it("appends one JSON line per evaluation record", async () => {
    await audit.recordEvaluation(
      "acme",
      { action: "DECLINE", triggeredRule: "r1" },
      { fields: { MCC: 5999 }, velocityCounts: {}, now: 0 },
    );
    const body = await readFile(
      join(dataDir, "tenants", "acme", "audit", "evaluations.jsonl"),
      "utf8",
    );
    const line = JSON.parse(body.trim());
    expect(line.type).toBe("evaluation");
    expect(line.decision.action).toBe("DECLINE");
    expect(line.ctxFields.MCC).toBe(5999);
  });

  it("keeps audit logs separated per tenant", async () => {
    await audit.recordPublish("acme", null, 1, null);
    await audit.recordPublish("globex", null, 1, null);
    const acme = await readFile(
      join(dataDir, "tenants", "acme", "audit", "publishes.jsonl"),
      "utf8",
    );
    const globex = await readFile(
      join(dataDir, "tenants", "globex", "audit", "publishes.jsonl"),
      "utf8",
    );
    expect(acme.trim().split("\n")).toHaveLength(1);
    expect(globex.trim().split("\n")).toHaveLength(1);
  });
});
