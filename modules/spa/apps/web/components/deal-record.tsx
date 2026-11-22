import { PageTitle } from "@platform/ui/page";
import { Pill } from "@platform/ui/pill";
import { EmptyState } from "@platform/ui/empty-state";
import { Fact, FactGrid, ROW_CARD, Section, Sub } from "@platform/ui/record";
import { TABLE, TD, TH } from "@platform/ui/settings";
import { TableFrame } from "@platform/ui/page";
import { isComplianceGate, SPA_ROLE_LABELS, type SpaRole } from "@spa/core";
import type { ApprovalItem, EventItem, RecordSections, RecordView } from "../lib/contracts";
import { ageLabel, formatMoneyFils, shortDate } from "../lib/format";
import { ActivityLog } from "./activity-log";
import { AgreementReview } from "./agreement-review";
import { Chasing } from "./chasing";
import {
  Agreement,
  Banks,
  ComplianceReview,
  Documents,
  Noc,
  Registration,
  Settlement,
  Signing,
} from "./record-sections";
import { Amount } from "./amount";
import { DealStepper } from "./deal-stepper";
import { PartyCard } from "./party-card";
import { StateBadge } from "./state-badge";
import { WaitingBanner } from "./waiting-banner";

type Record = Omit<RecordView, "sections"> & { sections: RecordSections };

const DECIDED: { [status: string]: string } = {
  approved: "Approved",
  rejected: "Rejected",
  edited: "Approved with changes",
};

/** One gate as a sales role may read it: a pending one names only the role that decides; a compliance one is neutral. */
function ApprovalRow({ a }: { a: ApprovalItem }) {
  const neutral = a.gate === "compliance_review" || isComplianceGate(a.gate);
  if (neutral)
    return (
      <li className={`${ROW_CARD} m-0`}>
        <b className="block font-semibold">Compliance review</b>
        <Sub>{a.status === "pending" || a.status === "open" ? "Open" : "Closed"}</Sub>
      </li>
    );
  const pending = a.status === "pending";
  return (
    <li className={`${ROW_CARD} m-0 grid gap-0.5`}>
      <span className="flex flex-wrap items-center gap-2">
        <b className="font-semibold">{a.gateLabel ?? a.title}</b>
        {pending ? (
          <Pill tone="waiting">Waiting</Pill>
        ) : (
          <Pill tone={a.status === "rejected" ? "danger" : "accent"}>{DECIDED[a.status] ?? "Closed"}</Pill>
        )}
      </span>
      <Sub>
        {a.title}
        {pending
          ? ` · Waiting for ${a.approverRole ? SPA_ROLE_LABELS[a.approverRole] : "a decision"}${a.createdAt ? ` since ${shortDate(a.createdAt)}` : ""}`
          : ` · ${a.decidedBy ?? "Staff"}${a.decidedAt ? `, ${shortDate(a.decidedAt)}` : ""}`}
      </Sub>
      {!pending && a.decisionNote && <Sub>{a.decisionNote}</Sub>}
      {pending && a.reasons?.map((r) => <Sub key={r}>{r}</Sub>)}
    </li>
  );
}

/**
 * The deal record (design §4.3, S58). Sections render in design order and only when the engine sent them: nothing is
 * shown empty, and there is no control that decides or changes anything (the decision cards are C31).
 */
export function DealRecord({
  record,
  events,
  nextEvents,
  viewer,
  back = { href: "/work", label: "Work" },
}: {
  record: Record;
  events: EventItem[];
  nextEvents: { href: string } | null;
  viewer: SpaRole;
  /** Where the back link goes: Work by default, the compliance screen for a compliance role (C39). */
  back?: { href: string; label: string };
}) {
  const { deal, sections: s } = record;
  const property = [
    deal.property.label,
    deal.unitNo && deal.unitNo !== deal.property.label ? `unit ${deal.unitNo}` : null,
    deal.projectCode,
  ]
    .filter(Boolean)
    .join(" · ");
  const mortgage = [deal.sellerMortgage && "Seller", deal.buyerMortgage && "Buyer"].filter(Boolean).join(" and ");
  const sellers = s.parties.filter((p) => p.role === "seller");
  const buyers = s.parties.filter((p) => p.role === "buyer");
  const total = s.paymentPlan?.reduce((sum, r) => sum + r.amountFils, 0) ?? 0;
  return (
    <div className="grid gap-6">
      <PageTitle
        back={back}
        title={`${deal.ref} · ${deal.property.label}`}
        lede={`${deal.typeLabel} · ${deal.sellers.join(", ")} → ${deal.buyers.join(", ")} · ${formatMoneyFils(deal.priceFils)}`}
      />
      <div className="flex flex-wrap gap-1.5" aria-label="State">
        <StateBadge stage={deal.stage} label={deal.stageLabel} />
        {deal.inDefault && <Pill tone="danger">In default</Pill>}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-10 max-lg:grid-cols-1">
        <div className="grid min-w-0 gap-8">
          <DealStepper steps={s.steps} />
          <WaitingBanner waiting={record.waitingFor} viewer={viewer} />
          <Section id="overview" title="Overview">
            <FactGrid>
              <Fact label="Type">{deal.typeLabel}</Fact>
              <Fact label="Price">
                <Amount fils={deal.priceFils} />
              </Fact>
              <Fact label={deal.property.kind === "unit" ? "Unit" : "Listing"}>{property}</Fact>
              <Fact label="Owner">{deal.owner?.label ?? "Not set"}</Fact>
              <Fact label="Open for">{ageLabel(deal.ageDays)}</Fact>
              {deal.targetTransferOn && <Fact label="Target transfer date">{shortDate(deal.targetTransferOn)}</Fact>}
              {mortgage && <Fact label="Mortgage">{mortgage}</Fact>}
              {deal.planTakenOver && <Fact label="Payment plan">Taken over by the buyer</Fact>}
              {s.compliance && (
                <Fact label={s.compliance.label}>
                  <Pill tone={s.compliance.status === "open" ? "warning" : "neutral"}>
                    {s.compliance.status === "open" ? "Review open" : "None"}
                  </Pill>
                </Fact>
              )}
              {deal.inDefault && (
                <Fact label="In default">
                  {deal.inDefaultSince ? `Since ${shortDate(deal.inDefaultSince)}` : "Yes"}
                  {deal.inDefaultReason ? ` · ${deal.inDefaultReason.replaceAll("_", " ")}` : ""}
                </Fact>
              )}
              <Fact label="Rulebook" mono>
                {deal.rulesVersion}
              </Fact>
            </FactGrid>
          </Section>
          {s.parties.length > 0 && (
            <Section id="parties" title="Parties" hint="Names as on the passport or licence; numbers are never shown">
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2 p-0">
                {[...sellers, ...buyers].map((p) => (
                  <PartyCard key={`${p.role}-${p.partyId}-${p.order}`} party={p} />
                ))}
              </ul>
            </Section>
          )}
          {s.documents && <Documents items={s.documents} />}
          {s.aml && <ComplianceReview section={s.aml} />}
          {s.chasing && <Chasing section={s.chasing} />}
          {s.paymentPlan && (
            <Section id="payments" title="Payment plan" hint="Amounts add up to the price to the fil">
              {s.paymentPlan.length ? (
                <TableFrame>
                  <table className={TABLE}>
                    <caption className="sr-only">Payment plan</caption>
                    <thead>
                      <tr>
                        <th scope="col" className={TH}>
                          #
                        </th>
                        <th scope="col" className={TH}>
                          Instalment
                        </th>
                        <th scope="col" className={TH}>
                          Due
                        </th>
                        <th scope="col" className={`${TH} text-right`}>
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.paymentPlan.map((r) => (
                        <tr key={r.seq} className="group">
                          <td className={`${TD} tabular-nums`}>{r.seq}</td>
                          <td className={TD}>{r.label}</td>
                          <td className={TD}>{r.dueOn ? shortDate(r.dueOn) : (r.milestone ?? "")}</td>
                          <td className={`${TD} text-right`}>
                            <Amount fils={r.amountFils} confirmed={r.confirmed ?? true} />
                          </td>
                        </tr>
                      ))}
                      <tr className="group">
                        <th scope="row" colSpan={3} className={`${TD} text-left font-semibold`}>
                          Total
                        </th>
                        <td className={`${TD} text-right font-semibold`}>
                          <Amount fils={total} />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </TableFrame>
              ) : (
                <EmptyState title="No payment plan yet." body="Sales sets the plan before the agreement is prepared." />
              )}
            </Section>
          )}
          {s.agreement && <Agreement section={s.agreement} />}
          {s.agreementReview && <AgreementReview section={s.agreementReview} />}
          {s.signing && <Signing section={s.signing} />}
          {s.noc && <Noc section={s.noc} />}
          {s.finance && <Banks section={s.finance} />}
          {s.settlement && <Settlement section={s.settlement} />}
          {s.registration && <Registration section={s.registration} />}
          {s.approvals.length > 0 && (
            <Section
              id="approvals"
              title="Approvals"
              hint="Who decides each one is shown; decisions are made in the inbox"
            >
              <ul className="m-0 grid list-none gap-2 p-0">
                {s.approvals.map((a) => (
                  <ApprovalRow key={a.id} a={a} />
                ))}
              </ul>
            </Section>
          )}
          {s.tasks.length > 0 && (
            <Section id="tasks" title="Tasks">
              <ul className="m-0 grid list-none gap-2 p-0">
                {s.tasks.map((t) => (
                  <li key={t.id} className={`${ROW_CARD} m-0`}>
                    <b className="block font-semibold">{t.title}</b>
                    <Sub>
                      For {SPA_ROLE_LABELS[t.role]} ·{" "}
                      {t.status === "open"
                        ? `opened ${shortDate(t.createdAt)}`
                        : t.status === "done"
                          ? `done ${t.doneAt ? shortDate(t.doneAt) : ""}`
                          : "cancelled"}
                    </Sub>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
        <ActivityLog events={events} next={nextEvents} runs={s.helperRuns} />
      </div>
    </div>
  );
}
