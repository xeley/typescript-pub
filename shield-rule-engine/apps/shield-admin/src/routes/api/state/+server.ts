import { json } from "@sveltejs/kit";
import { getDeps } from "$lib/server/composition.js";
import { readState, draftToText } from "$lib/server/admin.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = async () => {
  const deps = getDeps();
  const state = await readState(deps);
  return json({ ...state, shownText: draftToText(state.shownDraft) });
};
