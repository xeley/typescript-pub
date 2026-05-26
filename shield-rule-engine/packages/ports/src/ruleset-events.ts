import type { RulesetPublishedEvent, Unsubscribe } from "./types.js";

export interface RulesetEvents {
  publish(event: RulesetPublishedEvent): Promise<void>;
  subscribe(onEvent: (event: RulesetPublishedEvent) => void | Promise<void>): Promise<Unsubscribe>;
}
