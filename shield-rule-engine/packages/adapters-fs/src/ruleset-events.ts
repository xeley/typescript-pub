import { once } from "node:events";
import { open, mkdir, stat } from "node:fs/promises";
import { basename } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { RulesetEvents, RulesetPublishedEvent, Unsubscribe } from "@shield/ports";
import { appendJsonl, isFileNotFound } from "./io.js";
import { eventsDir, eventsLogPath } from "./paths.js";

export type FsRulesetEventsConfig = Readonly<{
  dataDir: string;
}>;

const EVENTS_FILE_NAME = "ruleset.jsonl";

/**
 * Cross-process events backed by an append-only JSONL file watched with
 * chokidar. The publisher appends one JSON line per event; each subscriber
 * keeps a byte-offset cursor and advances it as new lines arrive.
 *
 * v1 simplification: cursors are in-memory only. Each new `subscribe`
 * starts at the file's current end-of-file. The eval service guarantees
 * correctness after a restart by invalidating all cached tenants once
 * before consuming events (see PLAN.md § 10).
 */
export function createFsRulesetEvents(config: FsRulesetEventsConfig): RulesetEvents {
  const logPath = eventsLogPath(config.dataDir);
  const dirPath = eventsDir(config.dataDir);

  return {
    async publish(event: RulesetPublishedEvent): Promise<void> {
      await appendJsonl(logPath, event);
    },

    async subscribe(onEvent): Promise<Unsubscribe> {
      await mkdir(dirPath, { recursive: true });
      const cursor = { offset: await fileSize(logPath) };
      const work = { queue: Promise.resolve() };

      const watcher = chokidar.watch(dirPath, {
        ignoreInitial: true,
        depth: 0,
        awaitWriteFinish: {
          stabilityThreshold: 50,
          pollInterval: 20,
        },
      });

      const enqueueOnChange = (changedPath: string) => {
        if (basename(changedPath) !== EVENTS_FILE_NAME) return;
        scheduleRead(work, () => readAndDispatch(logPath, cursor, onEvent));
      };
      watcher.on("add", enqueueOnChange);
      watcher.on("change", enqueueOnChange);

      await waitReady(watcher);

      return async (): Promise<void> => {
        await watcher.close();
        await work.queue.catch(() => undefined);
      };
    },
  };
}

function scheduleRead(work: { queue: Promise<void> }, run: () => Promise<void>): void {
  work.queue = work.queue.then(run).catch((err) => {
    console.error("fsRulesetEvents read error:", err);
  });
}

async function readAndDispatch(
  path: string,
  cursor: { offset: number },
  onEvent: (e: RulesetPublishedEvent) => void | Promise<void>,
): Promise<void> {
  const size = await fileSize(path);
  if (size <= cursor.offset) return;
  const slice = await readSlice(path, cursor.offset, size);
  cursor.offset = size;
  const events = parseEventLines(slice);
  for (const event of events) await onEvent(event);
}

async function fileSize(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.size;
  } catch (err) {
    if (isFileNotFound(err)) return 0;
    throw err;
  }
}

async function readSlice(path: string, start: number, end: number): Promise<string> {
  const fh = await open(path, "r");
  try {
    const length = end - start;
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, start);
    return buf.toString("utf8");
  } finally {
    await fh.close();
  }
}

function parseEventLines(text: string): RulesetPublishedEvent[] {
  const out: RulesetPublishedEvent[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length === 0) continue;
    const parsed = tryParseEvent(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

function tryParseEvent(line: string): RulesetPublishedEvent | null {
  try {
    return JSON.parse(line) as RulesetPublishedEvent;
  } catch {
    return null;
  }
}

async function waitReady(watcher: FSWatcher): Promise<void> {
  await once(watcher, "ready");
}
