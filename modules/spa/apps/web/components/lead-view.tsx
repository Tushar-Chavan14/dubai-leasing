import { PageTitle } from "@platform/ui/page";
import { Pill } from "@platform/ui/pill";
import { Fact, FactGrid, ROW_CARD, Section, Sub } from "@platform/ui/record";
import Link from "next/link";
import type { ReactNode } from "react";
import type { LeadRecord } from "../lib/contracts";
import { dealFormReady } from "../lib/features";
import { dubaiDay, viewingTimeLabel } from "../lib/viewing-slots";
import { shortDate } from "../lib/format";
import { BookViewingAction, CloseLeadAction, LeadStatusButton, ViewingActions } from "./lead-actions";

const TONE: Record<string, "accent" | "success" | "warning" | "neutral" | "waiting"> = {
  new: "waiting",
  contacted: "neutral",
  viewing_booked: "accent",
  interested: "success",
  not_interested: "neutral",
  converted: "success",
  closed: "neutral",
};
const VIEWING_TONE = { booked: "accent", attended: "success", no_show: "warning", cancelled: "neutral" } as const;

function NextStep({ lead: l }: { lead: LeadRecord }) {
  const booked = l.viewings.find((v) => v.status === "booked");
  let title: string;
  let body: ReactNode = null;
  let actions: ReactNode = null;
  switch (l.status) {
    case "new":
      title = `Contact ${l.name}`;
      body = "Reply to their message by email, then mark the lead contacted, or book a viewing for them.";
      actions = (
        <>
          <LeadStatusButton leadId={l.id} status="contacted" label="Mark contacted" variant="primary" />
          <BookViewingAction leadId={l.id} />
        </>
      );
      break;
    case "contacted":
      title = "Book a viewing, or record their interest";
      actions = (
        <>
          <BookViewingAction leadId={l.id} />
          <LeadStatusButton leadId={l.id} status="interested" label="Interested" />
          <LeadStatusButton leadId={l.id} status="not_interested" label="Not interested" />
        </>
      );
      break;
    case "viewing_booked":
      if (booked) {
        title = booked.needsOutcome ? "Record how the viewing went" : `Viewing on ${viewingTimeLabel(booked.startsAt)}`;
        body = booked.needsOutcome
          ? `${viewingTimeLabel(booked.startsAt)}. It has started and has no outcome yet.`
          : null;
        actions = <ViewingActions viewingId={booked.id} leadId={l.id} needsOutcome={booked.needsOutcome} canChange />;
      } else {
        title = `Was ${l.name} interested?`;
        actions = (
          <>
            <LeadStatusButton leadId={l.id} status="interested" label="Interested" variant="primary" />
            <LeadStatusButton leadId={l.id} status="not_interested" label="Not interested" />
          </>
        );
      }
      break;
    case "interested":
      title = "Start a deal";
      body = dealFormReady ? (
        l.property?.kind === "listing" ? (
          "Make an offer on the home with their details filled in. The sellers answer by email."
        ) : (
          "Open the deal form with their details and the home filled in."
        )
      ) : (
        <>Deal creation comes next. This lead is marked Interested.</>
      );
      actions = dealFormReady ? (
        <Link
          href={
            l.property?.kind === "listing" ? `/listings/${l.property.id}/offer?lead=${l.id}` : `/deals/new?lead=${l.id}`
          }
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary no-underline"
        >
          {l.property?.kind === "listing" ? "Make an offer" : "Start deal"}
        </Link>
      ) : null;
      break;
    default:
      return null;
  }
  return (
    <Section id="next-step" title="Next step" highlight>
      <div className="grid gap-3 rounded-2xl border border-line bg-page p-4">
        <p className="m-0 text-[15px] font-semibold text-ink">{title}</p>
        {body && <p className="m-0 text-sm text-muted">{body}</p>}
        <div className="flex flex-wrap items-start gap-2">
          {actions}
          <CloseLeadAction leadId={l.id} />
        </div>
      </div>
    </Section>
  );
}

/** A lead's record page (S79). Visitor-written text is shown as plain text and is never an instruction. */
export function LeadView({ lead: l }: { lead: LeadRecord }) {
  return (
    <div className="grid gap-6">
      <PageTitle
        back={[
          { href: "/work", label: "Work" },
          { href: "/work?tab=leads", label: "Leads" },
        ]}
        title={`${l.ref}, ${l.name}`}
        lede={l.property ? `${l.property.title} (${l.property.ref})` : undefined}
        actions={<Pill tone={TONE[l.status] ?? "neutral"}>{l.statusLabel}</Pill>}
      />
      <div className="record-cards grid max-w-[980px] gap-6">
        <NextStep lead={l} />
        <Section id="overview" title="Overview">
          <FactGrid>
            <Fact label="Name">{l.name}</Fact>
            <Fact label="Email">{l.email}</Fact>
            <Fact label="Phone">{l.phone ?? "Not given"}</Fact>
            <Fact label="Home">
              {l.property ? (
                <Link
                  href={
                    l.property.kind === "listing" ? `/listings/${l.property.id}` : `/inventory/units/${l.property.id}`
                  }
                  className="font-mono tabular-nums"
                >
                  {l.property.ref}
                </Link>
              ) : (
                "Not available"
              )}
              {l.property && <Sub>{l.property.title}</Sub>}
            </Fact>
            <Fact label="Agent">{l.agent?.name ?? "Unassigned (sales manager's queue)"}</Fact>
            <Fact label="Source">{l.sourceLabel}</Fact>
            <Fact label="Created">{shortDate(dubaiDay(l.createdAt))}</Fact>
            <Fact label="Agreed to be contacted">{shortDate(dubaiDay(l.consentAt))}</Fact>
          </FactGrid>
        </Section>
        <Section id="messages" title="Messages" hint="What the visitor wrote, in their own words.">
          <ol className="m-0 grid list-none gap-2 p-0">
            {l.messages.map((m) => (
              <li key={m.seq} className={ROW_CARD}>
                <p className="m-0 text-sm whitespace-pre-line" dir="auto">
                  {m.body}
                </p>
                <Sub>{shortDate(dubaiDay(m.createdAt))}</Sub>
              </li>
            ))}
          </ol>
        </Section>
        <Section id="viewings" title="Viewings" hint={`${l.viewings.length}`}>
          {l.viewings.length ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {l.viewings.map((v) => (
                <li key={v.id} className={`${ROW_CARD} flex flex-wrap items-center gap-x-3 gap-y-1`}>
                  <span className="font-medium tabular-nums">{viewingTimeLabel(v.startsAt)}</span>
                  <Pill tone={v.needsOutcome ? "waiting" : VIEWING_TONE[v.status]}>
                    {v.needsOutcome ? "Needs an outcome" : v.statusLabel}
                  </Pill>
                  {v.outcomeNote && <Sub>{v.outcomeNote}</Sub>}
                  {v.cancelReason && <Sub>{v.cancelReason}</Sub>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-muted">No viewing yet.</p>
          )}
        </Section>
        <Section id="activity" title="Activity">
          <ol className="m-0 grid list-none gap-1.5 p-0 text-sm">
            {l.activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-2">
                <b className="font-semibold">{a.label}</b>
                <span className="text-muted">
                  {a.actor}, {shortDate(dubaiDay(a.at))}
                </span>
                {a.note && <span className="text-muted">: {a.note}</span>}
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  );
}
