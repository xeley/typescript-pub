import { access, constants } from "node:fs/promises";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { EvalDeps } from "../composition.js";

export type ReadyResponse = Readonly<{
  ok: boolean;
  checks: {
    dataDirReadable: boolean;
  };
}>;

export async function handleReady(
  _request: FastifyRequest,
  reply: FastifyReply,
  deps: EvalDeps,
): Promise<ReadyResponse> {
  const dataDirReadable = await canRead(deps.config.dataDir);
  const body: ReadyResponse = { ok: dataDirReadable, checks: { dataDirReadable } };
  reply.code(body.ok ? 200 : 503);
  return body;
}

async function canRead(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
