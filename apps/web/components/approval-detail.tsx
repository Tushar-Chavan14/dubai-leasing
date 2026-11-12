import Link from "next/link";
import { TemplateRewrites, type TemplateRewrite } from "./template-rewrites";
import { notFound } from "next/navigation";
import { ContractFieldsTable, EjariAttemptsList } from "./contract-panel";
import type { ReactNode } from "react";
import { SealCheckIcon } from "@phosphor-icons/react/dist/ssr";
import { Due, Status } from "./ui";
import { buttonClass } from "./ui/button";
import {
  Fact,
  FactGrid,
  FactKey,
  FactList,
  FactVal,
  NOTE_TEXT,
  ROW_CARD,
  Section,
  Sub,
  TENANT_TEXT,
} from "./ui/record";
import { get, publicGet } from "../lib/engine";
import {
  actorLabel,
  canDecideApproval,
  dateTime,
  eventLabel,
  formatAed,
  humanise,
  proposalValue,
  roleLabel,
  stateLabel,
} from "../lib/format";
import { CONTRACT_CLAUSES, type ContractClauseId } from "@leasing/core";
import type { Me } from "../lib/types";
import { ApprovalNoteForm } from "./work-forms";
import { DecisionForm } from "./decision-form";
import { LegalTag, needsLegalCheck } from "./legal-tag";

/** Gates whose only editable field is the note (mirrors `editable` in the engine's gate rules). */
const NOTE_EDIT_GATES = new Set<string>(["refund", "kyc_review", "safety_complaint", "ejari_rejected_twice"]);

interface NoteRow {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

type Source =
  | { kind: "rule"; rulesVersion: string; rule: string; value: string }
  | { kind: "event"; eventId: string; label: string }
  | { kind: "document"; documentId: string; label: string }
  | { kind: "helper_run"; helperRunId: string; label: string }
  | { kind: "field"; label: string; value: string };

interface ApprovalDetail {
  id: string;
  title: string;
  gate: string;
  status: string;
  proposal: Record<string, unknown>;
  editedProposal: Record<string, unknown> | null;
  reasons: string[];
  sources: Source[];
  rulesVersion: string | null;
  approverRole: string;
  proposedBy: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  decidedByUser: { name: string; role: string } | null;
  gateDef: { label: string; when: string; approver: string };
  entity: { kind: string; id: string; ref?: string; code?: string; state: string; unitCode?: string } | null;
  events: { id: string; type: string; actor: string; at: string; toState: string | null }[];
}

/** Fields shown first (and the headline figure) per gate; internal ids are hidden. */
const FIELD_ORDER: Record<string, string[]> = {
  renewal_notice: [
    "proposedRentFils",
    "currentRentFils",
    "maxRentFils",
    "maxIncreasePercent",
    "sriAverageFils",
    "sriLabel",
    "leaseEndOn",
    "sendOn",
    "legalDeadline",
    "newTermStartOn",
    "newTermEndOn",
    "leaseRef",
    "rulesVersion",
    "note",
  ],
  price_out_of_range: ["askingRentFils", "rangeMinFils", "rangeMaxFils", "unitCode", "bedrooms", "policyVersion"],
  vacate_notice: ["ground", "servedOn", "deliveryMethod", "leaseEndOn", "propertyKind", "rulesVersion", "note"],
  formal_reminder: [
    "seq",
    "of",
    "amountFils",
    "dueOn",
    "paymentStatus",
    "friendlyReminders",
    "lateRentDays",
    "rulesVersion",
  ],
  safety_complaint: ["category", "urgency", "atRisk", "safety", "legalThreat"],
  refund: [
    "refundFils",
    "depositFils",
    "deductionsFils",
    "owedFils",
    "thresholdFils",
    "revision",
    "disputed",
    "policyVersion",
    "note",
  ],
  kyc_review: [
    "fullNameEn",
    "nationality",
    "birthDate",
    "emiratesIdNo",
    "idExpiresOn",
    "passportNo",
    "passportExpiresOn",
    "visaNo",
    "visaExpiresOn",
    "companyName",
    "tradeLicenceNo",
    "tradeLicenceExpiresOn",
    "note",
  ],
  offer_out_of_limits: [
    "annualRentFils",
    "askingRentFils",
    "cheques",
    "depositFils",
    "rentFreeDays",
    "moveInOn",
    "startOn",
    "endOn",
    "reservationFils",
    "expiresOn",
    "revision",
    "note",
  ],
};
const HIDDEN = new Set([
  "leaseId",
  "unitId",
  "helperRunId",
  "sriSource",
  "sameRentFallback",
  "applicationId",
  "documentIds",
  "flags",
  "problems",
  "fromRevision",
  "fromCounter",
  "statementId",
  "items",
  "disputeReason",
]);

/** Nested proposals (a KYC identity, offer terms) are shown as plain rows; flags and problems are the reasons. */
function displayed(gate: string, p: Record<string, unknown>): Record<string, unknown> {
  if (gate === "kyc_review") {
    const identity = (p.identity ?? {}) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries({ ...identity, note: p.note }).filter(([, v]) => v !== null && v !== undefined),
    );
  }
  if (gate === "offer_out_of_limits") return { ...(p.terms as Record<string, unknown>), note: p.note };
  // Contract and Ejari proposals have their own tables below; the grid shows only the headline.
  if (gate === "final_contract")
    return { leaseRef: p.leaseRef, version: p.version, reference: p.reference, note: p.note };
  if (gate === "ejari_submission" || gate === "ejari_rejected_twice") return { leaseRef: p.leaseRef, note: p.note };
  return p;
}

/** The manager's counter-terms form (D51): rent, cheques and move-in, prefilled from the proposed terms. */
function offerEdit(p: Record<string, unknown>, today: string) {
  const t = (p.terms ?? {}) as { annualRentFils?: number; cheques?: number; moveInOn?: string };
  return {
    rentAed: typeof t.annualRentFils === "number" ? formatAed(t.annualRentFils).replace("AED ", "") : "",
    cheques: t.cheques ?? 1,
    moveInOn: t.moveInOn ?? "",
    today,
  };
}

const LIST = "m-0 grid list-none gap-1.5 p-0 text-sm";

/** Links to the PDFs attached to a lease proposal (opening a contract is recorded on the lease). */
function DocLinks({ leaseId, sources }: { leaseId: string; sources: Source[] }) {
  const docs = sources.filter((s): s is Extract<Source, { kind: "document" }> => s.kind === "document");
  if (!leaseId || !docs.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {docs.map((d) => (
        <a
          key={d.documentId}
          className={buttonClass("ghost", "sm")}
          href={`/documents/leases/${leaseId}/${d.documentId}`}
          target="_blank"
          rel="noreferrer"
        >
          Open: {d.label}
        </a>
      ))}
    </div>
  );
}

function ContractProposal({ p, leaseId, sources }: { p: Record<string, unknown>; leaseId: string; sources: Source[] }) {
  const flags = (p.flags ?? []) as { kind: string; quote: string; reason: string }[];
  const rewrites = (p.rewrites ?? []) as TemplateRewrite[];
  const addendum = (p.addendum ?? { clauses: [], freeText: null }) as {
    clauses: string[];
    freeText: string | null;
    companyClauses?: { id: string; title: string; text: string; category?: string }[];
  };
  return (
    <>
      <Section id="fields-h" title="Every field and where it was copied from">
        <ContractFieldsTable
          fields={(p.fields ?? {}) as Record<string, unknown>}
          sources={(p.sources ?? {}) as Record<string, { entity: string; id: string; column: string }>}
        />
        <p className={NOTE_TEXT}>
          ID numbers are masked here; compare them on the PDF. No value was typed or changed by a model.
        </p>
        <DocLinks leaseId={leaseId} sources={sources} />
      </Section>
      {rewrites.length > 0 && (
        <Section id="rewrites-h" title="Template wording changed to match the records">
          <TemplateRewrites rewrites={rewrites} />
          <p className={NOTE_TEXT}>
            Only wording about the unit is changed, and only to what the unit record says; code checked every number.
          </p>
        </Section>
      )}
      <Section id="addendum-h" title="Addendum">
        {addendum.clauses.length === 0 && !addendum.freeText && (
          <p className="m-0 text-sm text-muted">No addendum clauses.</p>
        )}
        <ul className={LIST}>
          {addendum.clauses
            .filter((c) => Object.hasOwn(CONTRACT_CLAUSES, c))
            .map((c) => (
              <li key={c}>
                <b>{CONTRACT_CLAUSES[c as ContractClauseId].title}.</b> {CONTRACT_CLAUSES[c as ContractClauseId].text}
              </li>
            ))}
        </ul>
        {(addendum.companyClauses?.length ?? 0) > 0 && (
          <>
            <p className="m-0 text-sm text-muted">Additional terms (company)</p>
            <ul className={LIST}>
              {addendum.companyClauses?.map((c) => (
                <li key={c.id}>
                  <b>{c.title}.</b> {c.text}
                  {needsLegalCheck(c.category) && <LegalTag />}
                </li>
              ))}
            </ul>
          </>
        )}
        {addendum.freeText && <blockquote className={TENANT_TEXT}>{addendum.freeText}</blockquote>}
        {p.reviewed ? (
          <p className={NOTE_TEXT}>
            {flags.length
              ? "The review model flagged the extra terms (see why this is here). It never edits the text."
              : "The review model found no conflicts in the extra terms."}
          </p>
        ) : null}
      </Section>
    </>
  );
}

/**
 * One approval in full: the gate panel (what is proposed, and the decision), then why it is here, its sources and the
 * notes for the approver. `compact` is the pinned gate at the top of a record: only the headline facts in the panel.
 */
export async function ApprovalDetail({
  id,
  draftId,
  ask,
  compact = false,
  after,
}: {
  id: string;
  draftId?: string | undefined;
  /** An Ask AI button for the panel's header. */
  ask?: ReactNode;
  compact?: boolean;
  /** Shown right under the gate panel (the record's activity), before the rest of the approval. */
  after?: ReactNode;
}) {
  const [a, me, health, notes, draftRow] = await Promise.all([
    get<ApprovalDetail>(`/api/approvals/${id}`),
    get<Me>("/api/me"),
    publicGet<{ today: string }>("/health"),
    get<NoteRow[]>(`/api/approvals/${id}/notes`),
    draftId
      ? get<{ id: string; kind: string; approvalId: string | null; body: string; status: string }>(
          `/api/copilot/drafts/${encodeURIComponent(draftId)}`,
        )
      : Promise.resolve(null),
  ]);
  if (!a) notFound();
  // The user's own copilot draft for this approval prefills the note form.
  const draft =
    draftRow && draftRow.kind === "approval_note" && draftRow.approvalId === a.id && draftRow.status === "draft"
      ? draftRow
      : null;
  const today = health?.today ?? "";
  const ownProposal = !!me && (a.proposedBy === `user:${me.id}` || a.proposedBy === `copilot:${me.id}`);
  const waiting = a.status === "pending";
  const canDecide = waiting && canDecideApproval(a, me);
  // Who decides, in words: managers also decide leasing-officer gates (canDecideGate).
  const decider =
    a.approverRole === "leasing_officer"
      ? "a leasing officer or manager"
      : `a ${roleLabel(a.approverRole).toLowerCase()}`;
  // Filled only when the decision is the signed-in user's to make.
  const mine = canDecide;
  const shown = displayed(a.gate, a.editedProposal ?? a.proposal);
  const kycDocs = a.gate === "kyc_review" ? a.sources.filter((s) => s.kind === "document") : [];
  const order = FIELD_ORDER[a.gate] ?? [];
  const keys = [...order.filter((k) => k in shown), ...Object.keys(shown).filter((k) => !order.includes(k))].filter(
    (k) => !HIDDEN.has(k),
  );
  const headline = compact ? keys.slice(0, 4) : keys;
  const more = compact ? keys.slice(4) : [];
  const deadline = typeof shown.legalDeadline === "string" ? shown.legalDeadline : null;
  const rent =
    typeof a.proposal.proposedRentFils === "number" ? formatAed(a.proposal.proposedRentFils).replace("AED ", "") : null;
  const entityHref =
    a.entity?.kind === "lease"
      ? `/work?kind=lease&id=${a.entity.id}`
      : a.entity?.kind === "unit"
        ? `/units/${a.entity.id}`
        : a.entity?.kind === "application"
          ? `/work?kind=application&id=${a.entity.id}`
          : null;
  const fact = (k: string) => (
    <Fact key={k} label={humanise(k)} tone={mine ? "tinted" : "raised"} mono={k.endsWith("No") || k === "rulesVersion"}>
      {proposalValue(k, shown[k])}
    </Fact>
  );
  return (
    <div className="grid gap-7">
      <section
        aria-labelledby="gate-h"
        className={`grid gap-3.5 rounded-2xl p-5 ${mine ? "bg-accent text-on-accent" : "border border-line bg-page text-ink"}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs ${mine ? "text-on-accent/75" : "text-muted"}`}>
            <SealCheckIcon size={15} aria-hidden />
            {mine ? "Waiting for you" : waiting ? `Waiting for ${decider}` : "Decision"}
          </span>
          {!waiting && <Status value={a.status} />}
          {ask && <span className="ml-auto">{ask}</span>}
        </div>
        <div className="grid gap-1">
          <h2 id="gate-h" className="m-0 font-sans text-[17px] font-semibold tracking-tight">
            {a.title}
          </h2>
          <p className={`m-0 text-[13px] ${mine ? "text-on-accent/75" : "text-muted"}`}>
            {a.gate.startsWith("ejari_") && typeof a.proposal.systemName === "string"
              ? a.gateDef.label.replace(/\bEjari\b/g, a.proposal.systemName)
              : a.gateDef.label}
            . {a.gateDef.when === "always" ? "Always needs a person" : "Needed because a limit was crossed"}; decided by{" "}
            {decider}. Proposed by {actorLabel(a.proposedBy).toLowerCase()} on {dateTime(a.createdAt)}
            {a.rulesVersion ? (
              <>
                , rules <span className="font-mono text-xs">{a.rulesVersion}</span>
              </>
            ) : null}
            .
          </p>
          {deadline && today && waiting && (
            <p className="m-0 text-[13px] font-semibold">
              Notice must be sent by {proposalValue("legalDeadline", deadline)},{" "}
              <Due today={today} on={deadline} warnWithin={30} />.
            </p>
          )}
        </div>
        {a.gate === "ejari_submission" && a.proposal.mode === "manual" && typeof a.proposal.leaseId === "string" && (
          // Registered by hand: the one-file pack the officer takes to the office, right where the decision is made.
          <div className="flex flex-wrap items-center gap-2">
            <a
              className={buttonClass("primary", "sm")}
              href={`/api/leases/${a.proposal.leaseId}/registration/pack`}
              target="_blank"
              rel="noreferrer"
            >
              Download registration pack
            </a>
            <span className="text-[13px]">
              One PDF: what to register and where, the signed contract and the ID files.
            </span>
          </div>
        )}
        {headline.length > 0 && (
          <div className="grid gap-1.5">
            <h3 className="sr-only">{a.editedProposal ? "Proposal, as edited" : "Proposal"}</h3>
            <FactGrid>{headline.map(fact)}</FactGrid>
          </div>
        )}
        {canDecide ? (
          <DecisionForm
            id={a.id}
            canEditRent={a.gate === "renewal_notice"}
            canEditNote={NOTE_EDIT_GATES.has(a.gate)}
            currentRentAed={rent}
            editOffer={a.gate === "offer_out_of_limits" ? offerEdit(a.proposal, today) : undefined}
          />
        ) : waiting ? (
          <p className="m-0 text-sm text-muted">
            {ownProposal
              ? `You prepared this, so ${decider} other than you decides it.`
              : me?.role === "admin"
                ? `Admins configure the system but don't approve gates; ${decider} decides it.`
                : `Decided by ${decider}; your role can't decide it.`}
          </p>
        ) : (
          <FactList>
            <FactKey>Outcome</FactKey>
            <FactVal>
              <Status value={a.status} />
            </FactVal>
            <FactKey>By</FactKey>
            <FactVal>
              {a.decidedByUser ? `${a.decidedByUser.name}, ${roleLabel(a.decidedByUser.role).toLowerCase()}` : "Engine"}
            </FactVal>
            <FactKey>When</FactKey>
            <FactVal>{a.decidedAt ? dateTime(a.decidedAt) : "—"}</FactVal>
            <FactKey>Note</FactKey>
            <FactVal>{a.decisionNote ?? "—"}</FactVal>
          </FactList>
        )}
      </section>
      {after}

      {more.length > 0 && (
        <Section id="proposal-h" title="The rest of the proposal">
          <FactGrid>
            {more.map((k) => (
              <Fact key={k} label={humanise(k)} mono={k.endsWith("No") || k === "rulesVersion"}>
                {proposalValue(k, shown[k])}
              </Fact>
            ))}
          </FactGrid>
        </Section>
      )}
      {a.gate === "final_contract" && (
        <ContractProposal p={a.proposal} leaseId={a.entity?.id ?? ""} sources={a.sources} />
      )}
      {a.gate === "ejari_submission" && (
        <Section
          id="payload-h"
          title={
            a.proposal.mode === "manual"
              ? `What to enter on ${(a.proposal.portalName as string | undefined) ?? "the portal"}`
              : `What will be sent to ${(a.proposal.systemName as string | undefined) ?? "Ejari"} (simulated)`
          }
        >
          {typeof a.proposal.feeFils === "number" && (
            <p className={NOTE_TEXT}>
              Registration fee ({(a.proposal.systemName as string | undefined) ?? "Ejari"}):{" "}
              {formatAed(a.proposal.feeFils)}, paid by{" "}
              {a.proposal.feePaidBy === "landlord" ? "the landlord" : "the tenant"}.
            </p>
          )}
          <FactGrid>
            {Object.entries((a.proposal.payload ?? {}) as Record<string, unknown>).map(([k, v]) => (
              <Fact key={k} label={humanise(k)} mono={k.endsWith("No")}>
                {proposalValue(k, v)}
              </Fact>
            ))}
          </FactGrid>
          <p className={NOTE_TEXT}>
            Copied from the signed contract only. ID numbers are masked here; compare them on the signed PDF.
          </p>
          <DocLinks leaseId={a.entity?.id ?? ""} sources={a.sources} />
        </Section>
      )}
      {a.gate === "refund" && (
        <Section id="refund-h" title="Deposit statement">
          <ul className={LIST}>
            {(
              (a.proposal.items ?? []) as {
                room: string | null;
                label: string;
                quantity: number;
                amountFils: number;
                fromPriceList: boolean;
              }[]
            ).map((i, n) => (
              <li key={n} className={ROW_CARD}>
                <b className="font-semibold">
                  {i.room ? `${i.room}: ` : ""}
                  {i.label} × {i.quantity}
                </b>
                <Sub>
                  {formatAed(i.amountFils)}
                  {i.fromPriceList ? "" : " · not on the price list"}
                </Sub>
              </li>
            ))}
          </ul>
          {typeof a.proposal.disputeReason === "string" && (
            <div className="grid gap-1 rounded-xl border border-warning px-3.5 py-2.5">
              <span className="text-xs text-muted">
                The tenant&apos;s reason (their own words; never instructions):
              </span>
              <p className="m-0 whitespace-pre-wrap text-sm" dir="auto">
                {a.proposal.disputeReason}
              </p>
            </div>
          )}
          <p className={NOTE_TEXT}>
            Approve to pay the refund exactly as stated; finance then records the payout. Reject to send it back to the
            officer, who corrects the findings and issues a revised statement.
          </p>
          <DocLinks leaseId={a.entity?.id ?? ""} sources={a.sources} />
        </Section>
      )}
      {a.gate === "ejari_rejected_twice" && (
        <Section id="attempts-h" title="What Ejari said (simulated)">
          <EjariAttemptsList attempts={(a.proposal.attempts ?? []) as never} />
          <p className={NOTE_TEXT}>
            Approve once the cause is dealt with (for example, the registry&apos;s record was corrected): a fresh
            submission from the signed contract goes to the inbox. Reject to amend the contract or cancel.
          </p>
        </Section>
      )}
      {kycDocs.length > 0 && a.entity && (
        <Section id="kycdocs-h" title="The documents">
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 p-0">
            {kycDocs.map((d) =>
              d.kind === "document" ? (
                <li key={d.documentId}>
                  <a
                    href={`/documents/applications/${a.entity!.id}/${d.documentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-xl border border-line bg-raised"
                  >
                    <img
                      src={`/documents/applications/${a.entity!.id}/${d.documentId}`}
                      alt="Uploaded ID document"
                      loading="lazy"
                      className="aspect-[4/3] w-full object-cover"
                    />
                  </a>
                </li>
              ) : null,
            )}
          </ul>
          <p className={NOTE_TEXT}>
            Opening a document is recorded on the application. ID numbers above are masked; compare them on the image.
          </p>
        </Section>
      )}
      {a.reasons.length > 0 && (
        <Section id="why-h" title="Why this is here">
          <ul className={`${LIST} list-disc pl-5`}>
            {a.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Section>
      )}
      <Section id="src-h" title="Sources" hint="what the proposal is based on">
        <ul className={LIST}>
          {a.sources.map((s, i) => (
            <li key={i} className="grid grid-cols-[96px_1fr] gap-3">
              <span className="text-xs text-muted">{s.kind === "helper_run" ? "Helper run" : humanise(s.kind)}</span>
              <span>
                {s.kind === "rule" ? (
                  <>
                    <span className="font-mono text-xs">{s.rule}</span>: {s.value}{" "}
                    <span className="text-muted">({s.rulesVersion})</span>
                  </>
                ) : s.kind === "field" ? (
                  <>
                    {s.label}: <b className="font-semibold tabular-nums">{s.value}</b>
                  </>
                ) : (
                  s.label
                )}
              </span>
            </li>
          ))}
          {a.sources.length === 0 && (
            <li className="grid grid-cols-[96px_1fr] gap-3">
              <span className="text-xs text-muted">None</span>
              <span className="text-muted">No sources were attached to this proposal.</span>
            </li>
          )}
        </ul>
      </Section>
      <section id="notes" aria-labelledby="notes-h" className="grid gap-3">
        <h2 id="notes-h" className="m-0 font-sans text-[15px] font-semibold tracking-tight">
          Notes for the approver
        </h2>
        {(notes ?? []).length > 0 && (
          <ul className={LIST}>
            {(notes ?? []).map((n) => (
              <li key={n.id} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 whitespace-pre-wrap">
                <time dateTime={n.createdAt} className="font-mono text-xs text-muted">
                  {dateTime(n.createdAt)}
                </time>
                <span>
                  <b className="font-semibold">{actorLabel(n.author)}</b> {n.body}
                </span>
              </li>
            ))}
          </ul>
        )}
        <ApprovalNoteForm key={draft?.id ?? "new"} approvalId={a.id} draft={draft} />
      </section>
      {a.entity && !compact && (
        <Section
          id="entity-h"
          title={
            entityHref ? (
              <Link href={entityHref} className="underline underline-offset-2">
                {a.entity.ref ?? a.entity.code}
              </Link>
            ) : (
              stateLabel(a.entity.kind)
            )
          }
          action={<Status value={a.entity.state} />}
        >
          <ul className={LIST}>
            {a.events.slice(-6).map((e) => (
              <li key={e.id} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
                <time dateTime={e.at} className="font-mono text-xs text-muted">
                  {dateTime(e.at)}
                </time>
                <span>
                  <b className="font-semibold">{eventLabel(e.type)}</b>{" "}
                  <span className="text-muted">{actorLabel(e.actor)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
