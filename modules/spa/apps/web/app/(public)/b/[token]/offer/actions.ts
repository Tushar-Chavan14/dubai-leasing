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
  redirect(res?.ok ? `/b/${token}/offer?done=${answer}` : `/b/${token}/offer`);
}
