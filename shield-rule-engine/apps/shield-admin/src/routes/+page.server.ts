import { getDeps } from "$lib/server/composition.js";
import { draftToText, readState } from "$lib/server/admin.js";
import type { PageServerLoad } from "./$types.js";

const STARTER_TEXT = [
  "// Each non-empty, non-comment line is one rule.",
  "// Try editing, hitting Validate, then Publish.",
  "IF MCC in {5999, 4829} AND country != US THEN DECLINE",
  "IF CVV failed AND card_not_present THEN LOCK",
  "IF count(card, 10 min) > 5 THEN WARM",
].join("\n");

export const load: PageServerLoad = async () => {
  const deps = getDeps();
  const state = await readState(deps);
  const text = state.shownDraft.length === 0 ? STARTER_TEXT : draftToText(state.shownDraft);
  return { ...state, shownText: text };
};
