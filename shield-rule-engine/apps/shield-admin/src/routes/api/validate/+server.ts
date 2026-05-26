import { error, json } from "@sveltejs/kit";
import { validateText } from "$lib/server/admin.js";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.text !== "string") {
    return error(400, "Body must be { text: string }");
  }
  const lines = validateText(body.text);
  return json({ lines });
};
