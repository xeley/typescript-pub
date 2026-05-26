import { error, json } from "@sveltejs/kit";
import { getDeps } from "$lib/server/composition.js";
import { saveCompileAndPublish } from "$lib/server/admin.js";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.text !== "string") {
    return error(400, "Body must be { text: string }");
  }
  const deps = getDeps();
  const outcome = await saveCompileAndPublish(deps, body.text);
  return json(outcome);
};
