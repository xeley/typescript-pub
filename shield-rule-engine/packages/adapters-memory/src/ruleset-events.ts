import type { RulesetEvents, RulesetPublishedEvent, Unsubscribe } from "@shield/ports";

type Listener = (event: RulesetPublishedEvent) => void | Promise<void>;

/**
 * In-memory implementation of `RulesetEvents`. Useful for tests and for
 * single-process composition (where admin + eval share a runtime). Delivery
 * is synchronous-then-awaited: `publish` returns only once every subscriber
 * has finished its callback.
 */
export function createMemoryRulesetEvents(): RulesetEvents {
  const listeners = new Set<Listener>();
  return {
    async publish(event) {
      const tasks: Array<Promise<void> | void> = [];
      for (const listener of listeners) tasks.push(listener(event));
      await Promise.all(tasks);
    },
    async subscribe(onEvent): Promise<Unsubscribe> {
      listeners.add(onEvent);
      return async () => {
        listeners.delete(onEvent);
      };
    },
  };
}
