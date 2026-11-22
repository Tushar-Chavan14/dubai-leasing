import { buttonClass } from "@platform/ui/button";
import { EmptyState } from "@platform/ui/empty-state";
import { Pill } from "@platform/ui/pill";
import { ROW_CARD, Sub } from "@platform/ui/record";
import { ALERT, SET_TEXTAREA } from "@platform/ui/settings";
import { isComplianceGate, isComplianceRole, SPA_ROLE_LABELS, type SpaRole } from "@spa/core";
import Link from "next/link";
import type { InboxItem } from "../lib/contracts";
import { formatMoneyFils, shareLabel, shortDate } from "../lib/format";
import { decisionOptions } from "../lib/inbox";
import { ReviewBody } from "./agreement-review";

export type InboxFrom = "work" | "compliance";

const DECIDED: Record<string, string> = { approved: "Approved", rejected: "Rejected", edited: "Approved with changes" };
const ERRORS: Record<string, string> = {
  note: "Say why: a rejection, a return or any outcome but Clear needs a note.",
  decision: "That decision was not understood. Choose one of the buttons.",
  refused: "The decision could not be recorded. It may already be decided, or it is not yours to decide.",
};

/** The few proposal values a card shows, each with a fixed label (never a raw key, id or hash). */
const FACTS: { key: string; label: string; show: (v: unknown) => string | null }[] = [
  { key: "service", label: "Service", show: (v) => text(v) },
  { key: "unitNo", label: "Unit", show: (v) => text(v) },
  { key: "releaseTo", label: "Release to", show: (v) => text(v)?.replaceAll("_", " ") ?? null },
  { key: "amountFils", label: "Amount", show: (v) => (Number.isInteger(v) ? formatMoneyFils(v as number) : null) },
  { key: "side", label: "Side", show: (v) => text(v) },
  { key: "commissionBps", label: "Commission", show: (v) => (Number.isInteger(v) ? shareLabel(v as number) : null) },
  { key: "policyBps", label: "Policy rate", show: (v) => (Number.isInteger(v) ? shareLabel(v as number) : null) },
  { key: "version", label: "Version", show: (v) => (Number.isInteger(v) ? `v${String(v)}` : null) },
];
function text(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, 80) : null;
}

/** The compliance gates reach only the two compliance roles; anyone else, whatever the item says, gets the neutral card. */
const isNeutral = (item: InboxItem, viewer: SpaRole) =>
  item.gate === "compliance_review" || (isComplianceGate(item.gate) && !isComplianceRole(viewer));

function NeutralCard({ item }: { item: InboxItem }) {
  const open = item.status === "pending" || item.status === "open";
  return (
    <li className={`${ROW_CARD} m-0`}>
      <b className="block font-semibold">Compliance review</b>
      <Sub>{open ? "Open" : "Closed"}</Sub>
    </li>
  );
}

/** A note the copilot drafted for this deal's approval (C36): it only fills the box; the person decides. */
export interface NoteDraft {
  dealId: string | null;
  body: string;
}

function Controls({
  item,
  from,
  backTo,
  note,
}: {
  item: InboxItem;
  from: InboxFrom;
  backTo?: string | undefined;
  note?: string | undefined;
}) {
  const options = decisionOptions(item.gate);
  const aml = options.some((o) => o.decision === "aml");
  const noteId = `note-${item.id}`;
  return (
    <>
      <label htmlFor={noteId} className="grid gap-1 text-xs text-muted">
        Note
        <textarea
          id={noteId}
          name="note"
          maxLength={2000}
          rows={2}
          className={SET_TEXTAREA}
          aria-describedby={`${noteId}-hint`}
          {...(note ? { defaultValue: note } : {})}
        />
      </label>
      {note && (
        <p className="m-0 text-xs text-muted">Draft from the copilot: read it and change it before you decide.</p>
      )}
      <p id={`${noteId}-hint`} className="m-0 text-xs text-muted">
        {aml ? "Needed for every outcome but Clear." : "Needed to return or reject."} It is kept with the decision.
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={`${o.decision}-${o.outcome ?? ""}`}
            type="submit"
            name={o.decision === "aml" ? "outcome" : "decision"}
            value={o.decision === "aml" ? o.outcome : o.decision}
            className={buttonClass(o.tone, "sm")}
          >
            {o.label}
          </button>
        ))}
      </div>
      {aml && <input type="hidden" name="decision" value="aml" />}
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="from" value={from} />
      {backTo && <input type="hidden" name="back" value={backTo} />}
    </>
  );
}

function Card({
  item,
  viewer,
  decideAction,
  from,
  backTo,
  note,
}: {
  item: InboxItem;
  viewer: SpaRole;
  decideAction: (formData: FormData) => void | Promise<void>;
  from: InboxFrom;
  backTo?: string | undefined;
  note?: string | undefined;
}) {
  const pending = item.status === "pending";
  // The engine says who may decide (role, not admin, not the proposer); admin is also never shown a button here.
  const decides = pending && item.mayDecide?.ok === true && viewer !== "admin";
  const own = pending && item.mayDecide?.ok === false && item.mayDecide.reason.includes("own proposal");
  const complianceView = isComplianceGate(item.gate);
  const facts = complianceView
    ? []
    : FACTS.flatMap((f) => {
        const shown = f.show(item.proposal?.[f.key]);
        return shown ? [{ label: f.label, value: shown }] : [];
      });
  const headingId = `gate-${item.id}`;
  return (
    <li className={`${ROW_CARD} m-0`}>
      <article aria-labelledby={headingId} className="grid gap-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 id={headingId} className="m-0 text-[15px] font-semibold">
            {item.gateLabel ?? item.title}
          </h3>
          {item.entityRef && <span className="font-mono text-xs text-muted">{item.entityRef}</span>}
          {pending ? (
            <Pill tone="waiting">Waiting</Pill>
          ) : (
            <Pill tone={item.status === "rejected" ? "danger" : "accent"}>{DECIDED[item.status] ?? "Closed"}</Pill>
          )}
          {from === "work" && item.entity.kind === "deal" && (
            <Link
              href={`/work/deals/${item.entity.id}`}
              className="ml-auto text-[13px] text-ink underline underline-offset-2"
            >
              Open deal<span className="sr-only">: {item.entityRef ?? item.title}</span>
            </Link>
          )}
        </div>
        <Sub>
          {[
            item.title !== item.gateLabel ? item.title : null,
            item.approverRole ? `Decided by ${SPA_ROLE_LABELS[item.approverRole]}` : null,
            item.proposedBy ? `Proposed by ${item.proposedBy.label}` : null,
            item.createdAt ? `since ${shortDate(item.createdAt)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Sub>
        {item.reasons?.length ? (
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {item.reasons.map((r) => (
              <li key={r} className="m-0 text-sm [overflow-wrap:anywhere]">
                {r}
              </li>
            ))}
          </ul>
        ) : null}
        {facts.length > 0 && (
          <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-sm">
            {facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-muted">{f.label}</dt>
                <dd className="m-0">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {item.gate === "helper_review" && (
          <div className="grid gap-1 border-l-2 border-line pl-3">
            <b className="text-sm font-semibold">Held result{item.heldResult ? `: ${item.heldResult.label}` : ""}</b>
            {item.heldResult ? (
              item.heldResult.reasons.length ? (
                <ul className="m-0 grid list-none gap-0.5 p-0">
                  {item.heldResult.reasons.map((r) => (
                    <li key={r} className="m-0 text-sm [overflow-wrap:anywhere]">
                      {r}
                    </li>
                  ))}
                </ul>
              ) : (
                <Sub>The helper gave no reasons.</Sub>
              )
            ) : (
              <Sub>The held result is not available here. Open the deal to see what the helper read.</Sub>
            )}
            <Sub>Nothing moves on until you decide.</Sub>
          </div>
        )}
        {item.gate === "agreement_approval" && item.agreementReview && <ReviewBody review={item.agreementReview} />}
        {!pending && (
          <Sub>
            {[item.decidedBy, item.decidedAt ? shortDate(item.decidedAt) : null].filter(Boolean).join(", ")}
            {item.decisionNote ? ` · ${item.decisionNote}` : ""}
          </Sub>
        )}
        {own && (
          <Sub>
            You proposed this.
            {item.approverRole ? ` Someone else with the ${SPA_ROLE_LABELS[item.approverRole]} role decides.` : ""}
          </Sub>
        )}
        {decides && (
          <form action={decideAction} className="grid gap-2">
            <Controls item={item} from={from} backTo={backTo} note={note} />
          </form>
        )}
      </article>
    </li>
  );
}

/**
 * The inbox (C31, S63): the gates the signed-in role decides, oldest first, each as a decision card (design §4.4).
 * A button is drawn only when the engine's own `mayDecide` says yes; the web never works out who may approve. The
 * form carries the decision, a note and an outcome (and which screen to return to); the server action sends only those.
 */
export function InboxList({
  items,
  viewer,
  decideAction,
  from,
  error,
  next,
  backTo,
  draft,
}: {
  items: InboxItem[];
  viewer: SpaRole;
  decideAction: (formData: FormData) => void | Promise<void>;
  from: InboxFrom;
  error?: string | undefined;
  next?: { href: string } | null | undefined;
  /** A page to come back to after deciding (the case page); the action accepts only a case address. */
  backTo?: string | undefined;
  /** A note the copilot drafted (`?draft=<id>`): it fills the note box of the first open approval on that deal. */
  draft?: NoteDraft | null | undefined;
}) {
  const noteFor = draft?.dealId
    ? items.find(
        (i) =>
          i.entity.id === draft.dealId && i.status === "pending" && i.mayDecide?.ok === true && !isNeutral(i, viewer),
      )?.id
    : undefined;
  return (
    <div className="grid gap-3">
      {error && (
        <p role="alert" className={ALERT.bad}>
          {ERRORS[error] ?? ERRORS.refused}
        </p>
      )}
      {items.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {items.map((item) =>
            isNeutral(item, viewer) ? (
              <NeutralCard key={item.id} item={item} />
            ) : (
              <Card
                key={item.id}
                item={item}
                viewer={viewer}
                decideAction={decideAction}
                from={from}
                backTo={backTo}
                note={item.id === noteFor ? draft?.body : undefined}
              />
            ),
          )}
        </ul>
      ) : (
        <EmptyState
          title="Nothing is waiting for you."
          body="Approvals your role decides will appear here, oldest first."
        />
      )}
      {next && (
        <Link href={next.href} className={buttonClass("ghost", "sm")}>
          Next page
        </Link>
      )}
    </div>
  );
}
