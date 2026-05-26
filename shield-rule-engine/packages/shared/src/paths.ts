import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Operation: walk upward from this file's location until we find the
 * pnpm-workspace.yaml that anchors the repo. Used by app config defaults
 * so both `shield-eval` and `shield-admin` resolve the same `DATA_DIR`
 * no matter which directory the user starts them from.
 */
export function findProjectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("Could not locate project root (no pnpm-workspace.yaml found upwards)");
}

export function defaultDataDir(): string {
  return join(findProjectRoot(), "data");
}
