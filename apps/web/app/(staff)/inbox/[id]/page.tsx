import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContractFieldsTable, EjariAttemptsList } from "../../../../components/contract-panel";
import { Due, PageHead, Status } from "../../../../components/ui";
import { get, publicGet } from "../../../../lib/engine";
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
} from "../../../../lib/format";
import { CONTRACT_CLAUSES, type ContractClauseId } from "@leasing/core";
import type { Me } from "../../../../lib/types";
import { DecisionForm } from "./decision-form";

export const metadata: Metadata = { title: "Approval" };

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

/** Links to the PDFs attached to a lease proposal (opening a contract is recorded on the lease). */
function DocLinks({ leaseId, sources }: { leaseId: string; sources: Source[] }) {
  const docs = sources.filter((s): s is Extract<Source, { kind: "document" }> => s.kind === "document");
  if (!leaseId || !docs.length) return null;
  return (
    <div className="btn-row">
      {docs.map((d) => (
        <a
          key={d.documentId}
          className="btn small"
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
  const addendum = (p.addendum ?? { clauses: [], freeText: null }) as { clauses: string[]; freeText: string | null };
  return (
    <>
      <section aria-labelledby="fields-h">
        <h2 id="fields-h" className="section-title">
          Every field and where it was copied from
        </h2>
        <ContractFieldsTable
          fields={(p.fields ?? {}) as Record<string, unknown>}
          sources={(p.sources ?? {}) as Record<string, { entity: string; id: string; column: string }>}
        />
        <p className="muted" style={{ fontSize: 12.5 }}>
          ID numbers are masked here; compare them on the PDF. No value was typed or changed by a model.
        </p>
        <DocLinks leaseId={leaseId} sources={sources} />
      </section>
      <section aria-labelledby="addendum-h">
        <h2 id="addendum-h" className="section-title">
          Addendum
        </h2>
        {addendum.clauses.length === 0 && !addendum.freeText && <p className="muted">No addendum clauses.</p>}
        <ul className="reasons">
          {addendum.clauses.map((c) => (
            <li key={c}>
              <b>{CONTRACT_CLAUSES[c as ContractClauseId]?.title ?? c}.</b>{" "}
              {CONTRACT_CLAUSES[c as ContractClauseId]?.text}
            </li>
          ))}
        </ul>
        {addendum.freeText && <blockquote className="tenant-text">{addendum.freeText}</blockquote>}
        {p.reviewed ? (
          flags.length ? (
            <p className="muted" style={{ fontSize: 12.5 }}>
              The review model flagged the extra terms (see why this is here). It never edits the text.
            </p>
          ) : (
            <p className="muted" style={{ fontSize: 12.5 }}>
              The review model found no conflicts in the extra terms.
            </p>
          )
        ) : null}
      </section>
    </>
  );
}

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [a, me, health] = await Promise.all([
    get<ApprovalDetail>(`/api/approvals/${id}`),
    get<Me>("/api/me"),
    publicGet<{ today: string }>("/health"),
  ]);
  if (!a) notFound();
  const today = health?.today ?? "";
  const ownProposal = !!me && (a.proposedBy === `user:${me.id}` || a.proposedBy === `copilot:${me.id}`);
  const canDecide = a.status === "pending" && canDecideApproval(a, me);
  const shown = displayed(a.gate, a.editedProposal ?? a.proposal);
  const kycDocs = a.gate === "kyc_review" ? a.sources.filter((s) => s.kind === "document") : [];
  const order = FIELD_ORDER[a.gate] ?? [];
  const keys = [...order.filter((k) => k in shown), ...Object.keys(shown).filter((k) => !order.includes(k))].filter(
    (k) => !HIDDEN.has(k),
  );
  const keyField = order[0];
  const deadline = typeof shown.legalDeadline === "string" ? shown.legalDeadline : null;
  const rent =
    typeof a.proposal.proposedRentFils === "number" ? formatAed(a.proposal.proposedRentFils).replace("AED ", "") : null;
  const entityHref =
    a.entity?.kind === "lease"
      ? `/leases/${a.entity.id}`
      : a.entity?.kind === "unit"
        ? `/units/${a.entity.id}`
        : a.entity?.kind === "application"
          ? `/applications/${a.entity.id}`
          : null;

  return (
    <>
      <PageHead
        back={{ href: "/inbox", label: "Approvals" }}
        title={a.title}
        badge={<Status value={a.status} />}
        lede={
          <>
            {a.gateDef.label}.{" "}
            {a.gateDef.when === "always" ? "Always needs a person" : "Needed because a limit was crossed"}; decided by a{" "}
            {roleLabel(a.approverRole).toLowerCase()}. Proposed by {actorLabel(a.proposedBy).toLowerCase()} on{" "}
            {dateTime(a.createdAt)}
            {a.rulesVersion ? (
              <>
                , rules <span className="ref">{a.rulesVersion}</span>
              </>
            ) : null}
            .
          </>
        }
      />

      <div className="split">
        <div className="stack">
          <section aria-labelledby="proposal-h">
            <h2 id="proposal-h" className="section-title">
              {a.editedProposal ? "Proposal, as edited" : "Proposal"}
            </h2>
            <dl className="proposal-grid">
              {keys.map((k) => (
                <div key={k} className={k === keyField ? "key" : undefined}>
                  <dt>{humanise(k)}</dt>
                  <dd>
                    {k === "rulesVersion" ? (
                      <span className="ref">{String(shown[k])}</span>
                    ) : (
                      proposalValue(k, shown[k])
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {a.gate === "final_contract" && (
            <ContractProposal p={a.proposal} leaseId={a.entity?.id ?? ""} sources={a.sources} />
          )}
          {a.gate === "ejari_submission" && (
            <section aria-labelledby="payload-h">
              <h2 id="payload-h" className="section-title">
                What will be sent to Ejari
              </h2>
              <dl className="proposal-grid">
                {Object.entries((a.proposal.payload ?? {}) as Record<string, unknown>).map(([k, v]) => (
                  <div key={k}>
                    <dt>{humanise(k)}</dt>
                    <dd className={k.endsWith("No") ? "ref" : undefined}>{proposalValue(k, v)}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted" style={{ fontSize: 12.5 }}>
                Copied from the signed contract only. ID numbers are masked here; compare them on the signed PDF.
              </p>
              <DocLinks leaseId={a.entity?.id ?? ""} sources={a.sources} />
            </section>
          )}
          {a.gate === "ejari_rejected_twice" && (
            <section aria-labelledby="attempts-h">
              <h2 id="attempts-h" className="section-title">
                What Ejari said
              </h2>
              <EjariAttemptsList attempts={(a.proposal.attempts ?? []) as never} />
              <p className="muted" style={{ fontSize: 12.5 }}>
                Approve once the cause is dealt with (for example, the registry&apos;s record was corrected): a fresh
                submission from the signed contract goes to the inbox. Reject to amend the contract or cancel.
              </p>
            </section>
          )}

          {kycDocs.length > 0 && a.entity && (
            <section aria-labelledby="kycdocs-h">
              <h2 id="kycdocs-h" className="section-title">
                The documents
              </h2>
              <ul className="doc-grid" style={{ padding: 0 }}>
                {kycDocs.map((d) =>
                  d.kind === "document" ? (
                    <li key={d.documentId}>
                      <a
                        href={`/documents/applications/${a.entity!.id}/${d.documentId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="doc-thumb"
                      >
                        <img
                          src={`/documents/applications/${a.entity!.id}/${d.documentId}`}
                          alt="Uploaded ID document"
                          loading="lazy"
                        />
                      </a>
                    </li>
                  ) : null,
                )}
              </ul>
              <p className="muted" style={{ fontSize: 12.5 }}>
                Opening a document is recorded on the application. ID numbers above are masked; compare them on the
                image.
              </p>
            </section>
          )}

          {a.reasons.length > 0 && (
            <section className="panel panel-pad" aria-labelledby="why-h">
              <h2 id="why-h" className="section-title">
                Why this is here
              </h2>
              <ul className="reasons">
                {a.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel" aria-labelledby="src-h">
            <div className="panel-head">
              <h2 id="src-h">Sources</h2>
              <span className="hint">what the proposal is based on</span>
            </div>
            <ul className="sources" style={{ marginTop: 8 }}>
              {a.sources.map((s, i) => (
                <li key={i}>
                  <span className="kind">{s.kind === "helper_run" ? "Helper run" : humanise(s.kind)}</span>
                  <span>
                    {s.kind === "rule" ? (
                      <>
                        <span className="ref">{s.rule}</span>: {s.value}{" "}
                        <span className="muted">({s.rulesVersion})</span>
                      </>
                    ) : s.kind === "field" ? (
                      <>
                        {s.label}: <b className="num">{s.value}</b>
                      </>
                    ) : (
                      s.label
                    )}
                  </span>
                </li>
              ))}
              {a.sources.length === 0 && (
                <li>
                  <span className="kind">None</span>
                  <span className="muted">No sources were attached to this proposal.</span>
                </li>
              )}
            </ul>
          </section>
        </div>

        <aside className="stack sticky">
          <section className="panel panel-pad" aria-labelledby="decide-h">
            <h2 id="decide-h" className="section-title">
              {a.status === "pending" ? "Your decision" : "Decision"}
            </h2>
            {deadline && today && a.status === "pending" && (
              <p className="muted" style={{ marginBottom: 14, fontSize: 14 }}>
                Notice must be sent by <b style={{ color: "var(--ink)" }}>{proposalValue("legalDeadline", deadline)}</b>
                , <Due today={today} on={deadline} warnWithin={30} />.
              </p>
            )}
            {canDecide ? (
              <DecisionForm id={a.id} canEditRent={a.gate === "renewal_notice"} currentRentAed={rent} />
            ) : a.status === "pending" ? (
              <p className="muted">
                Waiting for a {roleLabel(a.approverRole).toLowerCase()}.{" "}
                {ownProposal
                  ? "You proposed this, so another leasing manager has to decide it."
                  : me?.role === "admin"
                    ? "Admins configure the system but don't approve gates."
                    : "Your role can't decide this gate."}
              </p>
            ) : (
              <dl className="facts">
                <dt>Outcome</dt>
                <dd>
                  <Status value={a.status} />
                </dd>
                <dt>By</dt>
                <dd>
                  {a.decidedByUser
                    ? `${a.decidedByUser.name}, ${roleLabel(a.decidedByUser.role).toLowerCase()}`
                    : "Engine"}
                </dd>
                <dt>When</dt>
                <dd>{a.decidedAt ? dateTime(a.decidedAt) : "—"}</dd>
                <dt>Note</dt>
                <dd>{a.decisionNote ?? "—"}</dd>
              </dl>
            )}
          </section>

          {a.entity && (
            <section className="panel" aria-labelledby="entity-h">
              <div className="panel-head">
                <h2 id="entity-h">
                  {entityHref ? (
                    <Link href={entityHref} className="link">
                      {a.entity.ref ?? a.entity.code}
                    </Link>
                  ) : (
                    stateLabel(a.entity.kind)
                  )}
                </h2>
                <Status value={a.entity.state} />
              </div>
              <ul className="feed">
                {a.events.slice(-6).map((e) => (
                  <li key={e.id}>
                    <span className="dot" {...(e.toState ? { "data-tone": "good" } : {})} />
                    <span className="what">
                      <b>{eventLabel(e.type)}</b> <span>{actorLabel(e.actor)}</span>
                    </span>
                    <time dateTime={e.at}>{dateTime(e.at)}</time>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
