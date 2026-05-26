import type { FastifyReply, FastifyRequest } from "fastify";
import type { Primitive } from "@shield/domain";
import type { AuthRequest } from "@shield/ports";
import { evaluateAuthWithSla, type SlaOutcome } from "@shield/use-cases";
import type { EvalDeps } from "../composition.js";
import { BadRequestError, TenantHeaderMissingError } from "../errors.js";

type EvaluateRequestBody = Readonly<{
  fields: Record<string, Primitive>;
  cardId: string | undefined;
}>;

type EvaluateResponseBody = Readonly<{
  action: string;
  triggeredRule: string | null;
  slaTimeout: boolean;
  elapsedMs: number;
}>;

/**
 * Stratum 4 Integration: parse → invoke use case → format response.
 * Error mapping (400 / 503 / 500) lives in the Fastify errorHandler.
 */
export async function handleEvaluate(
  request: FastifyRequest,
  _reply: FastifyReply,
  deps: EvalDeps,
): Promise<EvaluateResponseBody> {
  const authRequest = parseEvaluateRequest(request, deps.now);
  const outcome = await evaluateAuthWithSla(authRequest, {
    rulesetCache: deps.rulesetCache,
    velocityStore: deps.velocityStore,
    audit: deps.audit,
    failSafe: deps.config.failSafe,
    slaMs: deps.config.slaMs,
  });
  return toResponseBody(outcome);
}

function parseEvaluateRequest(request: FastifyRequest, now: () => number): AuthRequest {
  const tenantId = readTenantHeader(request);
  const body = readBody(request);
  return {
    tenantId,
    fields: body.fields,
    cardId: body.cardId,
    now: now(),
  };
}

function readTenantHeader(request: FastifyRequest): string {
  const raw = request.headers["x-tenant-id"];
  if (typeof raw !== "string" || raw.length === 0) throw new TenantHeaderMissingError();
  return raw;
}

function readBody(request: FastifyRequest): EvaluateRequestBody {
  const body = request.body;
  if (!isPlainObject(body)) throw new BadRequestError("Body must be a JSON object");
  const fields = body["fields"];
  if (!isPlainObject(fields)) {
    throw new BadRequestError("Body.fields must be an object of primitives");
  }
  for (const value of Object.values(fields)) {
    if (!isPrimitive(value)) {
      throw new BadRequestError(`Body.fields values must be string, number, or boolean`);
    }
  }
  const cardId = body["cardId"];
  if (cardId !== undefined && typeof cardId !== "string") {
    throw new BadRequestError("Body.cardId must be a string when provided");
  }
  return { fields: fields as Record<string, Primitive>, cardId };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is Primitive {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function toResponseBody(outcome: SlaOutcome): EvaluateResponseBody {
  return {
    action: outcome.decision.action,
    triggeredRule: outcome.decision.triggeredRule,
    slaTimeout: outcome.slaTimeout,
    elapsedMs: outcome.elapsedMs,
  };
}
