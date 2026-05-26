import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { NoActiveRulesetError } from "@shield/adapters-memory";
import { CompiledNotFoundError, RulesetNotFoundError } from "@shield/ports";
import type { EvalDeps } from "./composition.js";
import { BadRequestError } from "./errors.js";
import { handleEvaluate } from "./routes/evaluate.js";
import { handleHealth } from "./routes/health.js";
import { handleReady } from "./routes/ready.js";

export type AppServer = Readonly<{
  fastify: FastifyInstance;
  deps: EvalDeps;
  shutdown: () => Promise<void>;
}>;

/**
 * Build a Fastify instance. Does not bind a port — callers (production
 * `main.ts` or integration tests) choose when and where to listen.
 */
export function buildServer(deps: EvalDeps): FastifyInstance {
  const app = Fastify({ logger: { level: deps.config.logLevel } });
  registerErrorHandler(app);
  registerRoutes(app, deps);
  return app;
}

function registerRoutes(app: FastifyInstance, deps: EvalDeps): void {
  app.post("/v1/evaluate", (req, reply) => handleEvaluate(req, reply, deps));
  app.get("/v1/health", handleHealth);
  app.get("/v1/ready", (req, reply) => handleReady(req, reply, deps));
}

function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const mapped = mapErrorToResponse(err);
    reply.code(mapped.status).send(mapped.body);
  });
}

type MappedError = Readonly<{
  status: number;
  body: { error: string; message: string };
}>;

function mapErrorToResponse(err: Error): MappedError {
  if (err instanceof BadRequestError) {
    return { status: 400, body: { error: "BadRequest", message: err.message } };
  }
  if (err instanceof NoActiveRulesetError) {
    return { status: 503, body: { error: "NoActiveRuleset", message: err.message } };
  }
  if (err instanceof RulesetNotFoundError || err instanceof CompiledNotFoundError) {
    return { status: 503, body: { error: "RulesetUnavailable", message: err.message } };
  }
  return { status: 500, body: { error: "InternalServerError", message: err.message } };
}
