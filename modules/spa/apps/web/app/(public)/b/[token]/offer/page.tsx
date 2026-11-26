import { buttonClass } from "@platform/ui/button";
import type { Metadata } from "next";
import { linkProblem } from "../../../../../lib/buyer-link";
import { publicEngine } from "../../../../../lib/engine";
import { answerOffer } from "./actions";

export const metadata: Metadata = { title: "Answer the offer", robots: { index: false } };

const aed = (fils: number) => {
  const whole = Math.floor(fils / 100).toLocaleString("en-US");
  return fils % 100 ? `AED ${whole}.${String(fils % 100).padStart(2, "0")}` : `AED ${whole}`;
};

/** A seller's page for the emailed offer link: the terms, never a name, and two buttons. */
export default async function OfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; problem?: string }>;
}) {
  const { token } = await params;
  const { done, problem } = await searchParams;
  if (done)
    return (
      <section className="grid gap-2" aria-live="polite">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">
          {done === "accept" ? "Offer accepted" : "Offer declined"}
        </h1>
        <p className="m-0 text-sm text-ink">Thank you. Your agent will be in touch about the next step.</p>
      </section>
    );
  if (problem === "offer_expired" || problem === "offer_closed" || problem === "link_used") {
    const p = linkProblem(410, problem);
    return (
      <section className="grid gap-2">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">{p.title}</h1>
        <p className="m-0 text-sm text-muted">{p.body}</p>
      </section>
    );
  }
  const res = await publicEngine()
    .public["offer-links"][":token"].$get({ param: { token } })
    .catch(() => null);
  if (!res?.ok) {
    const p = linkProblem(res?.status ?? 502, undefined);
    return (
      <section className="grid gap-2">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">{p.title}</h1>
        <p className="m-0 text-sm text-muted">{p.body}</p>
      </section>
    );
  }
  const o = await res.json();
  if (o.status !== "SENT") {
    const p = linkProblem(
      410,
      o.status === "EXPIRED" ? "offer_expired" : o.status === "WITHDRAWN" ? "offer_withdrawn" : "offer_closed",
    );
    return (
      <section className="grid gap-2">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">{p.title}</h1>
        <p className="m-0 text-sm text-muted">{p.body}</p>
      </section>
    );
  }
  return (
    <article className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">Answer the offer · {o.listingTitle}</h1>
        <p className="m-0 text-sm text-muted">You can answer until {o.validUntil}.</p>
      </header>
      <dl className="m-0 grid gap-2 rounded-card border border-line bg-raised p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Offer price</dt>
          <dd className="m-0 font-semibold tabular-nums text-ink">{aed(o.priceFils)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Buyer needs a mortgage</dt>
          <dd className="m-0 text-ink">{o.buyerMortgage ? "Yes" : "No"}</dd>
        </div>
        {o.targetTransferOn && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Target transfer date</dt>
            <dd className="m-0 text-ink">{o.targetTransferOn}</dd>
          </div>
        )}
        {o.conditions && (
          <div className="grid gap-1">
            <dt className="text-muted">Conditions written by the buyer's side</dt>
            <dd className="m-0 whitespace-pre-line text-ink">{o.conditions}</dd>
          </div>
        )}
      </dl>
      <form action={answerOffer.bind(null, token)} className="flex gap-3">
        <button type="submit" name="answer" value="accept" className={buttonClass("primary")}>
          Accept the offer
        </button>
        <button type="submit" name="answer" value="reject" className={buttonClass("ghost")}>
          Decline the offer
        </button>
      </form>
    </article>
  );
}
