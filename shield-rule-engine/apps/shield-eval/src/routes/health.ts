import type { FastifyReply, FastifyRequest } from "fastify";

export async function handleHealth(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<{ ok: true }> {
  return { ok: true };
}
