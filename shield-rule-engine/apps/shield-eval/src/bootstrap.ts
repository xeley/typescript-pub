import type { FastifyInstance } from "fastify";
import type { RulesetPublishedEvent, Unsubscribe } from "@shield/ports";
import type { EvalDeps } from "./composition.js";
import { buildServer, type AppServer } from "./server.js";

/**
 * Stratum 3/4 Integration: take wired deps → build server → subscribe to
 * rulesetEvents → invalidate-all-on-subscriber-start → start listening.
 *
 * Returns a handle with a `shutdown()` Operation that unsubscribes and
 * closes the HTTP listener in the correct order.
 */
export async function bootstrap(
  deps: EvalDeps,
  listen: { host: string; port: number },
): Promise<AppServer> {
  const fastify = buildServer(deps);
  const unsubscribe = await subscribeAndInvalidateAll(deps);
  await fastify.listen({ host: listen.host, port: listen.port });
  return assembleServerHandle(fastify, deps, unsubscribe);
}

async function subscribeAndInvalidateAll(deps: EvalDeps): Promise<Unsubscribe> {
  const unsubscribe = await deps.rulesetEvents.subscribe((event) =>
    handleRulesetPublished(event, deps),
  );
  await deps.rulesetCache.invalidateAll();
  return unsubscribe;
}

async function handleRulesetPublished(event: RulesetPublishedEvent, deps: EvalDeps): Promise<void> {
  await deps.rulesetCache.invalidate(event.tenantId);
}

function assembleServerHandle(
  fastify: FastifyInstance,
  deps: EvalDeps,
  unsubscribe: Unsubscribe,
): AppServer {
  return {
    fastify,
    deps,
    shutdown: async () => {
      await unsubscribe();
      await fastify.close();
    },
  };
}
