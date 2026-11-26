"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Button } from "@platform/ui/button";
import { FIELD, HINT, INPUT, LABEL } from "@platform/ui/form";
import { Section } from "@platform/ui/record";
import { type ReactNode, useState, useTransition } from "react";
import { type ListingStepResult, stepListingAction } from "../app/(staff)/listings/[id]/actions";
import type { ListingRecord } from "../lib/contracts";
import { shortDate } from "../lib/format";

/** Where on the record each refusal is fixed: a link from the sentence to its section. */
function fixLink(reason: string): { href: string; label: string } | null {
  const r = reason.toLowerCase();
  if (r.includes("agreement")) return { href: "#listing-agreement", label: "Sellers signatures" };
  if (r.includes("ownership")) return { href: "#ownership", label: "Documents, Ownership" };
  if (r.includes("permit")) return { href: "#permit", label: "Permit" };
  return null;
}

const MIN_REASON = 3;

/**
 * A step that takes something away (unpublish, withdraw). The button only opens the reason box; the second click, on
 * Confirm, sends it (UI rule for negative actions).
 */
function ReasonAction({
  label,
  confirm,
  prompt,
  run,
}: {
  label: string;
  confirm: string;
  prompt: string;
  run: (reason: string) => Promise<ListingStepResult>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ListingStepResult>({});
  const [busy, start] = useTransition();
  if (!open)
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  const short = reason.trim().length < MIN_REASON;
  return (
    <div className="grid w-full max-w-md gap-2 rounded-xl border border-line bg-page p-3.5">
      <label className={FIELD}>
        <span className={LABEL}>{prompt}</span>
        <textarea
          className={INPUT}
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={result.error ? true : undefined}
        />
        <span className={HINT}>Kept in the activity with your name.</span>
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
          disabled={busy || short}
          onClick={() =>
            start(async () => {
              const r = await run(reason);
              setResult(r);
              if (r.ok) window.location.reload();
            })
          }
        >
          {busy ? "Saving…" : confirm}
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

/**
 * The Next step card of a listing (S77, AGENTS UI rule: what waits on you comes first). The engine says which step is next
 * and why it can't be taken yet; this card only shows it. A published listing shows its public link and Unpublish;
 * Withdraw is on every listing that isn't closed.
 */
export function ListingNextStep({
  listing: l,
  handoff = null,
}: {
  /** Demo mode only (S80): the "Waiting for the manager · Switch to Karim" line, drawn on the server. */
  handoff?: ReactNode;
  listing: Pick<ListingRecord, "id" | "ref" | "state" | "next" | "actions" | "lastUnpublish" | "page">;
}) {
  const [busy, start] = useTransition();
  const [result, setResult] = useState<ListingStepResult>({});
  const blocked = (l.next?.reasons.length ?? 0) > 0;
  const refusals = result.reasons?.length ? result.reasons : (l.next?.reasons ?? []);
  const closed = l.state === "SOLD" || l.state === "WITHDRAWN" || l.state === "UNDER_OFFER";
  const step = (event: string, reason?: string) => stepListingAction(l.id, event, reason);
  const done = (r: ListingStepResult) => {
    setResult(r);
    if (r.ok) window.location.reload();
    return r;
  };
  return (
    <Section id="next-step" title="Next step" highlight={!!l.next} hint={closed ? undefined : "What waits on you"}>
      <div className="grid gap-3">
        {l.state === "PUBLISHED" && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <b className="font-semibold">The page is live</b>
            <a
              href={`/properties/${l.ref}`}
              className="inline-flex items-center gap-1 font-semibold text-ink! underline"
              target="_blank"
              rel="noreferrer"
            >
              Open the public page
              <ArrowSquareOutIcon size={14} aria-hidden />
            </a>
          </div>
        )}
        {l.state === "UNDER_OFFER" && (
          <p className="m-0 text-sm text-muted">An offer or a deal is open. This listing moves with it.</p>
        )}
        {l.state === "SOLD" && <p className="m-0 text-sm text-muted">Sold. Nothing more to do on the listing.</p>}
        {l.state === "WITHDRAWN" && (
          <p className="m-0 text-sm text-muted">Withdrawn. The seller took it off the market.</p>
        )}
        {l.state === "ACTIVE" && l.lastUnpublish && (
          <p className="m-0 text-sm text-ink">
            <b className="font-semibold">Unpublished: {l.lastUnpublish.reason}</b>{" "}
            <span className="text-muted">on {shortDate(l.lastUnpublish.on)}</span>
          </p>
        )}
        {handoff}
        {l.next && (
          <div className="grid gap-2">
            <div>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || blocked}
                aria-describedby={blocked ? "next-step-reasons" : undefined}
                onClick={() => start(async () => void done(await step(l.next!.event)))}
              >
                {busy ? "Saving…" : l.next.label}
              </Button>
            </div>
            {refusals.length > 0 && (
              <ul id="next-step-reasons" className="m-0 grid list-none gap-1 p-0 text-sm text-muted">
                {refusals.map((r) => {
                  const fix = fixLink(r);
                  return (
                    <li key={r}>
                      {r}
                      {fix && (
                        <>
                          {" "}
                          <a href={fix.href} className="font-semibold text-ink! underline">
                            {fix.label}
                          </a>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {result.error && !result.reasons?.length && (
              <p role="alert" className="m-0 text-sm text-danger">
                {result.error}
              </p>
            )}
          </div>
        )}
        {l.actions.length > 0 && (
          <div className="flex flex-wrap items-start gap-2">
            {l.actions.includes("UNPUBLISH") && (
              <ReasonAction
                label="Unpublish"
                confirm="Confirm unpublish"
                prompt="Why is the page coming down?"
                run={async (reason) => done(await step("UNPUBLISH", reason))}
              />
            )}
            {l.actions.includes("WITHDRAW") && (
              <ReasonAction
                label="Withdraw listing"
                confirm="Confirm withdrawal"
                prompt="Why is the listing being withdrawn?"
                run={async (reason) => done(await step("WITHDRAW", reason))}
              />
            )}
          </div>
        )}
        {!l.next && l.actions.length === 0 && !closed && l.state !== "PUBLISHED" && (
          <p className="m-0 text-sm text-muted">Sales roles move this listing. You can look at it.</p>
        )}
      </div>
    </Section>
  );
}
