import { join, normalize, sep } from "node:path";
import { TenantIdInvalidError } from "@shield/ports";

/**
 * Operation: build a path under a tenant's directory, rejecting any
 * `..`-style escapes or absolute segments before they reach the
 * filesystem.
 */
export function tenantPath(dataDir: string, tenantId: string, ...rest: string[]): string {
  assertSafeTenantId(tenantId);
  for (const segment of rest) assertSafeSegment(segment);
  return join(dataDir, "tenants", tenantId, ...rest);
}

export function eventsLogPath(dataDir: string): string {
  return join(dataDir, "events", "ruleset.jsonl");
}

export function eventsDir(dataDir: string): string {
  return join(dataDir, "events");
}

function assertSafeTenantId(tenantId: string): void {
  if (!tenantId) throw new TenantIdInvalidError(tenantId);
  if (!/^[A-Za-z0-9_-]+$/.test(tenantId)) throw new TenantIdInvalidError(tenantId);
}

function assertSafeSegment(segment: string): void {
  if (segment.length === 0) throw new Error("Empty path segment");
  if (segment.includes("\0")) throw new Error("Null byte in path segment");
  const normalized = normalize(segment);
  if (normalized.includes("..")) throw new Error(`Path traversal attempt: ${segment}`);
  if (normalized.startsWith(sep) || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Absolute path segment not allowed: ${segment}`);
  }
}
