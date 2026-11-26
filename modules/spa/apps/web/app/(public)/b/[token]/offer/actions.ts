"use server";

import { redirect } from "next/navigation";
import { publicEngine } from "../../../../../lib/engine";

/** A seller answers an offer through the emailed link (S18, S39). */
export async function answerOffer(token: string, formData: FormData) {
  const answer = formData.get("answer") === "accept" ? "accept" : "reject";
  const res = await publicEngine()
    .public["offer-links"][":token"].answer.$post(
      { param: { token } },
      { init: { body: JSON.stringify({ answer }), headers: { "content-type": "application/json" } } },
    )
    .catch(() => null);
  if (res?.ok) redirect(`/b/${token}/offer?done=${answer}`);
  // A refusal is shown as its own page: an offer that expired while the link was open, one withdrawn, a link used twice.
  const code = ((await res?.json().catch(() => null)) as { code?: string } | null)?.code;
  const known = ["offer_expired", "offer_closed", "link_used"];
  redirect(code && known.includes(code) ? `/b/${token}/offer?problem=${code}` : `/b/${token}/offer`);
}
