import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Operation: write JSON to `path` atomically (temp + rename).
 *
 * `fs.rename` is atomic on POSIX and same-volume on Windows. Always create
 * parent directories first.
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const body = JSON.stringify(value, null, 2);
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
}

export async function readJson<T>(path: string): Promise<T> {
  const body = await readFile(path, "utf8");
  return JSON.parse(body) as T;
}

export async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path);
  } catch (err) {
    if (isFileNotFound(err)) return null;
    throw err;
  }
}

/**
 * Operation: append one JSON object as a single line to `path` (JSONL).
 *
 * Parent directories are created if missing. Single `appendFile` call —
 * atomic enough for line-sized records on the platforms we target; a crash
 * mid-write would corrupt at most the trailing line, which the reader
 * discards.
 */
export async function appendJsonl(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const line = JSON.stringify(value) + "\n";
  await appendFile(path, line, "utf8");
}

export function isFileNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}
