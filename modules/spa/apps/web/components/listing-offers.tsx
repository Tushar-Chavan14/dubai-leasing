"use client";

import { Button } from "@platform/ui/button";
import { FIELD, HINT, INPUT, LABEL } from "@platform/ui/form";
import { Pill } from "@platform/ui/pill";
import { Fact, FactGrid, ROW_CARD, Section, Sub } from "@platform/ui/record";
import Link from "next/link";
import { useState, useTransition } from "react";
import { type ListingStepResult, recordDepositAction, withdrawOfferAction } from "../app/(staff)/listings/[id]/actions";
import type { OfferRow, OffersView } from "../lib/contracts";
import { formatMoneyFils, shareLabel, shortDate } from "../lib/format";

const TONE = {
  SENT: "waiting",
  ACCEPTED: "success",
  REJECTED: "neutral",
  EXPIRED: "neutral",
  WITHDRAWN: "neutral",
} as const;
const ANSWER_TONE = { Waiting: "waiting", Accepted: "success", Rejected: "danger" } as const;
const MIN_REASON = 3;

/** Withdraw: the button only opens the reason box; the second click, on Confirm, sends it (UI rule for negative actions). */
function WithdrawOffer({ listingId, offerId }: { listingId: string; offerId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ListingStepResult>({});
  const [busy, start] = useTransition();
  if (!open)
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Withdraw offer
      </Button>
    );
  return (
    <div className="grid w-full max-w-md gap-2 rounded-xl border border-line bg-page p-3.5">
      <label className={FIELD}>
        <span className={LABEL}>Why is the offer being withdrawn?</span>
        <textarea
          className={INPUT}
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={result.error ? true : undefined}
        />
        <span className={HINT}>Kept in the activity with your name. The sellers' links stop working.</span>
      </label>
      {result.error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {result.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={busy || reason.trim().length < MIN_REASON}
          onClick={() =>
            start(async () => {
              const r = await withdrawOfferAction(listingId, offerId, reason);
              setResult(r);
              if (r.ok) window.location.reload();
            })
          }
        >
          {busy ? "Withdrawing…" : "Withdraw the offer"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => (setOpen(false), setReason(""), setResult({}))}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The deposit cheque, recorded once the sellers accepted. Its amount is the policy's: the engine works it out and shows it. */
function DepositForm({ listingId, dealId }: { listingId: string; dealId: string }) {
  const [v, setV] = useState({ chequeNo: "", bank: "", chequeOn: "", holder: "" });
  const [result, setResult] = useState<ListingStepResult>({});
  const [busy, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const ready = v.chequeNo.trim() && v.bank.trim() && v.chequeOn && v.holder.trim();
  return (
    <form
      className="grid gap-3 rounded-xl border border-line bg-page p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await recordDepositAction(listingId, dealId, v);
          setResult(r);
          if (r.ok) window.location.reload();
        });
      }}
    >
      <b className="text-sm font-semibold text-ink">Record the deposit cheque</b>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={FIELD}>
          <span className={LABEL}>Cheque number</span>
          <input className={INPUT} value={v.chequeNo} onChange={set("chequeNo")} inputMode="numeric" />
        </label>
        <label className={FIELD}>
          <span className={LABEL}>Bank</span>
          <input className={INPUT} value={v.bank} onChange={set("bank")} maxLength={120} />
        </label>
        <label className={FIELD}>
          <span className={LABEL}>Cheque date</span>
          <input className={INPUT} type="date" value={v.chequeOn} onChange={set("chequeOn")} />
        </label>
        <label className={FIELD}>
          <span className={LABEL}>In the name of</span>
          <input className={INPUT} value={v.holder} onChange={set("holder")} maxLength={200} />
        </label>
      </div>
      <span className={HINT}>The amount is the policy's share of the price; it is worked out when you save.</span>
      {result.error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {result.error}
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={busy || !ready}>
          {busy ? "Saving…" : "Record the deposit"}
        </Button>
      </div>
    </form>
  );
}

function OfferCard({ o, listingId, current }: { o: OfferRow; listingId: string; current: boolean }) {
  return (
    <li className={`${ROW_CARD} grid gap-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <b className="font-semibold tabular-nums">{formatMoneyFils(o.priceFils)}</b>
          <Pill tone={TONE[o.status]}>{o.statusLabel}</Pill>
        </span>
        <span className="text-xs text-muted">Sent {shortDate(o.createdAt)}</span>
      </div>
      <FactGrid>
        <Fact label="Sellers answer until">{shortDate(o.validUntil)}</Fact>
        <Fact label="Buyer needs a mortgage">{o.buyerMortgage ? "Yes" : "No"}</Fact>
        {o.targetTransferOn && <Fact label="Target transfer date">{shortDate(o.targetTransferOn)}</Fact>}
      </FactGrid>
      {o.conditions && <p className="m-0 whitespace-pre-line text-sm text-ink">{o.conditions}</p>}
      <ul className="m-0 grid list-none gap-1.5 p-0" aria-label="Each seller's answer">
        {o.sellers.map((s, i) => (
          <li key={i} className="flex items-center justify-between gap-3 text-sm">
            <span>{s.name}</span>
            <Pill tone={ANSWER_TONE[s.answerLabel as keyof typeof ANSWER_TONE] ?? "neutral"}>{s.answerLabel}</Pill>
          </li>
        ))}
      </ul>
      {o.buyers && (
        <Sub>
          Buyers:{" "}
          {o.buyers
            .map((b) => `${b.name}${shareLabel(b.shareBps) ? ` (${shareLabel(b.shareBps)})` : ""}, ${b.email}`)
            .join("; ")}
        </Sub>
      )}
      {o.deal && (
        <p className="m-0 text-sm">
          Deal{" "}
          <Link href={`/work/deals/${o.deal.id}`} className="font-mono font-semibold text-ink! underline tabular-nums">
            {o.deal.ref}
          </Link>
        </p>
      )}
      {o.deposit && (
        <p className="m-0 text-sm text-ink">
          Deposit of {formatMoneyFils(o.deposit.amountFils)} recorded: cheque from {o.deposit.bank}, dated{" "}
          {shortDate(o.deposit.chequeOn)}.
        </p>
      )}
      {current && o.canRecordDeposit && o.deal && <DepositForm listingId={listingId} dealId={o.deal.id} />}
      {current && o.canWithdraw && (
        <div>
          <WithdrawOffer listingId={listingId} offerId={o.id} />
        </div>
      )}
    </li>
  );
}

/**
 * The listing's Offers and deals section (M6, S81): the current offer with each seller's answer and Withdraw (behind a
 * reason box), the history of past offers, the deal once accepted and the deposit cheque. "Make an offer" shows only to
 * a sales role while the listing can take one. A role that only reads sees the offers without buyer contact details.
 */
export function ListingOffers({
  listingId,
  state,
  offers,
  canWrite,
}: {
  listingId: string;
  state: string;
  offers: OffersView | null;
  canWrite: boolean;
}) {
  const [current, ...past] = offers?.offers ?? [];
  const canOffer = canWrite && (state === "ACTIVE" || state === "PUBLISHED");
  return (
    <Section id="offers-h" title="Offers and deals">
      {current ? (
        <ul className="m-0 grid list-none gap-3 p-0">
          <OfferCard o={current} listingId={listingId} current />
        </ul>
      ) : (
        <p className="m-0 text-sm text-muted">No offer yet.</p>
      )}
      {canOffer && (
        <div>
          <Link
            href={`/listings/${listingId}/offer`}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary no-underline"
          >
            Make an offer
          </Link>
        </div>
      )}
      {past.length > 0 && (
        <div className="grid gap-2">
          <h3 className="m-0 text-[13px] font-semibold uppercase tracking-wide text-muted">Past offers</h3>
          <ul className="m-0 grid list-none gap-3 p-0">
            {past.map((o) => (
              <OfferCard key={o.id} o={o} listingId={listingId} current={false} />
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
