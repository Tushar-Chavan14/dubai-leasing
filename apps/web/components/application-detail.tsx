import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead, Status } from "./ui";
import { get, publicGet } from "../lib/engine";
import { actorLabel, aedShort, dateTime, eventLabel, formatAed, longDate, viewingTime } from "../lib/format";
import { IconCheck, IconWarning } from "../lib/icons";
import { inboundLabel } from "../lib/status-labels";
import type { Me } from "../lib/types";
import { ApplicationActions } from "./application-actions";
import { EmailTenantForm } from "./work-forms";

interface Terms {
  revision: number;
  annualRentFils: number;
  askingRentFils: number;
  cheques: number;
  depositFils: number;
  rentFreeDays: number;
  moveInOn: string;
  startOn: string;
  endOn: string;
  reservationFils: number;
  expiresOn: string;
  fromCounter?: boolean;
}
interface Detail {
  id: string;
  ref: string | null;
  source: "telegram" | "staff" | "import" | "copilot";
  conversationId: string | null;
  state: string;
  createdAt: string;
  requestedMoveInOn: string | null;
  viewingAt: string | null;
  viewingOutcome: "attended" | "no_show" | null;
  viewingOutcomeAt: string | null;
  kycVerifiedAt: string | null;
  offer: Terms | null;
  offerAcceptedAt: string | null;
  reservationPaidOn: string | null;
  reservationFils: number | null;
  reservationRef: string | null;
  unit: { id: string; code: string; building: string; community: string; askingRentFils: number | null };
  applicant: Record<string, string | null> & { kind: string; fullNameEn: string };
  documents: {
    id: string;
    kind: string;
    side: string | null;
    status: string | null;
    bytes: number | null;
    expiresOn: string | null;
  }[];
  kyc: {
    helperRunId: string;
    at: string;
    latencyMs: number | null;
    result: {
      verdict: string;
      identity: Record<string, string | null>;
      sources: Record<string, { docId: string; via: string }>;
      checks: { check: string; status: string; docId: string | null }[];
      flags: { kind: string; message: string; docId: string | null; blocking: boolean }[];
    } | null;
    reasons: string[];
  } | null;
  /** Latest document check, derived by the engine from the stored submission and the Clock. */
  kycCheck?: { state: "none" | "running" | "stuck" | "failed"; inboundId: string | null; reason: string | null };
  approvals: { id: string; gate: string; title: string; status: string }[];
  tasks: {
    id: string;
    kind: string;
    title: string;
    status: string;
    dueOn: string | null;
    details: Record<string, unknown>;
  }[];
  inbound: {
    id: string;
    ref: string;
    type: string;
    status: string;
    receivedAt: string;
    payload: Record<string, unknown>;
    result: Record<string, unknown> | null;
  }[];
  outbound: {
    id: string;
    subject: string;
    status: string;
    sentAt: string | null;
    intendedTo: string;
    to: string;
    previewUrl: string | null;
  }[];
  events: {
    id: string;
    type: string;
    actor: string;
    at: string;
    toState: string | null;
    payload: Record<string, unknown>;
  }[];
}

const DOC_LABEL: Record<string, string> = {
  emirates_id: "Emirates ID",
  passport: "Passport",
  visa: "Residence visa",
  trade_licence: "Trade licence",
};
const FIELD_LABEL: Record<string, string> = {
  fullNameEn: "Name (English, as on the document)",
  nationality: "Nationality",
  birthDate: "Date of birth",
  emiratesIdNo: "Emirates ID number",
  idExpiresOn: "Emirates ID expiry",
  passportNo: "Passport number",
  passportExpiresOn: "Passport expiry",
  visaNo: "Visa file number",
  visaExpiresOn: "Visa expiry",
  companyName: "Company",
  tradeLicenceNo: "Trade licence number",
  tradeLicenceExpiresOn: "Trade licence expiry",
};
const CHECK_LABEL: Record<string, string> = {
  readable: "Read clearly",
  id_number_valid: "Emirates ID number valid (format and check digit)",
  mrz_valid: "Passport machine-readable zone valid",
  visa_number_format: "Visa number format",
  in_date: "In date for the lease",
  documents_complete: "All required documents",
  names_consistent: "Same name on every document",
  applicant_matches: "Applicant is the document holder",
};

/** The application, in full: documents, checks, offer, viewing, tasks and messages. Rendered in the Workspace detail pane. */
export async function ApplicationDetail({ id, draftId }: { id: string; draftId?: string | undefined }) {
  const [a, me, health] = await Promise.all([
    get<Detail>(`/api/applications/${id}`),
    get<Me>("/api/me"),
    publicGet<{ today: string }>("/health"),
  ]);
  if (!a) notFound();
  const canAct = me?.role === "leasing_officer" || me?.role === "leasing_manager";
  const canEmail = canAct || me?.role === "finance";
  // A copilot draft (the user's own) prefills the email form; a used one doesn't (D42).
  const draftRow =
    draftId && canEmail
      ? await get<{
          id: string;
          kind: string;
          applicationId: string | null;
          subject: string | null;
          body: string;
          status: string;
        }>(`/api/copilot/drafts/${encodeURIComponent(draftId)}`)
      : null;
  const draft =
    draftRow && draftRow.kind === "email" && draftRow.applicationId === a.id && draftRow.status === "draft"
      ? draftRow
      : null;
  const kyc = a.kyc?.result;
  const openTasks = a.tasks.filter((t) => t.status === "open");
  const offers = a.events.filter((e) => e.type === "OFFER_MADE" || e.type === "OFFER_REVISED");
  const leaseEvent = a.events.find((e) => e.type === "LEASE_CREATED");
  const leaseId = leaseEvent ? String(leaseEvent.payload.leaseId ?? "") : "";
  const docLabel = (docId: string | null) => {
    const d = a.documents.find((x) => x.id === docId);
    return d ? `${DOC_LABEL[d.kind] ?? d.kind}${d.side && d.side !== "page" ? ` (${d.side})` : ""}` : "";
  };

  return (
    <>
      <PageHead
        embedded
        title={
          <>
            {a.applicant.fullNameEn}{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              {a.unit.code}
            </span>
          </>
        }
        badge={<Status value={a.state} />}
        lede={
          <>
            Application <span className="ref">{a.ref}</span> for{" "}
            <Link href={`/units/${a.unit.id}`} className="link">
              {a.unit.code}, {a.unit.building}
            </Link>
            , created {dateTime(a.createdAt)}
            {a.requestedMoveInOn ? `, wants to move in ${longDate(a.requestedMoveInOn)}` : ""}.
            {a.source === "copilot" && " Created from the copilot, confirmed by staff."}
            {a.source === "telegram" && (
              <>
                {" "}
                Booked through Telegram
                {a.conversationId ? (
                  <>
                    {" "}
                    (
                    <Link href={`/conversations/${a.conversationId}`} className="link">
                      conversation
                    </Link>
                    )
                  </>
                ) : null}
                .
              </>
            )}
            {leaseId && (
              <>
                {" "}
                <Link href={`/work?kind=lease&id=${leaseId}`} className="link">
                  Open the lease
                </Link>
                .
              </>
            )}
          </>
        }
      />

      <div className="split section">
        <div className="stack">
          <section className="panel" aria-labelledby="docs-h">
            <div className="panel-head">
              <h2 id="docs-h">Documents</h2>
              <span className="hint">only leasing staff can open them; each view is recorded</span>
            </div>
            {a.documents.length === 0 ? (
              <p className="muted panel-pad">
                {a.state === "SCREENING" ? "Waiting for the applicant to upload their documents." : "No documents."}
              </p>
            ) : (
              <ul className="doc-grid">
                {a.documents.map((d) => (
                  <li key={d.id} data-status={d.status ?? ""}>
                    {canAct ? (
                      <a
                        href={`/documents/applications/${a.id}/${d.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="doc-thumb"
                      >
                        <img
                          src={`/documents/applications/${a.id}/${d.id}`}
                          alt={`${docLabel(d.id)} uploaded by the applicant`}
                          loading="lazy"
                        />
                      </a>
                    ) : (
                      <div className="doc-thumb doc-thumb-locked">Leasing staff only</div>
                    )}
                    <div className="doc-meta">
                      <b>{docLabel(d.id)}</b>
                      <span className="muted">
                        {d.status === "verified" ? "Verified" : d.status === "rejected" ? "Removed" : "Uploaded"}
                        {d.expiresOn ? `, expires ${longDate(d.expiresOn)}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {a.kyc && (
            <section className="panel" aria-labelledby="kyc-h">
              <div className="panel-head">
                <h2 id="kyc-h">Identity check</h2>
                <span className="hint">
                  {kyc?.verdict === "verified" ? "everything checked out" : "needs a person"} · {dateTime(a.kyc.at)}
                  {a.kyc.latencyMs ? ` · ${Math.round(a.kyc.latencyMs / 1000)} s` : ""}
                </span>
              </div>
              {kyc ? (
                <div className="panel-pad stack">
                  {kyc.flags.length > 0 && (
                    <ul className="flag-list">
                      {kyc.flags.map((f, i) => (
                        <li key={i} data-blocking={f.blocking}>
                          <IconWarning size={15} />
                          <span>
                            {f.message}
                            {f.blocking && <b> Can&apos;t be approved; ask for a new document.</b>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <dl className="facts">
                    {Object.entries(kyc.identity)
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k} style={{ display: "contents" }}>
                          <dt>{FIELD_LABEL[k] ?? k}</dt>
                          <dd>
                            {/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? longDate(v!) : v}
                            {kyc.sources[k] && (
                              <div className="row-sub">
                                from the {docLabel(kyc.sources[k].docId)}
                                {kyc.sources[k].via === "mrz" ? ", machine-readable zone" : ""}
                              </div>
                            )}
                          </dd>
                        </div>
                      ))}
                  </dl>
                  <ul className="check-list">
                    {kyc.checks
                      .filter((c) => c.status === "pass")
                      .map((c, i) => (
                        <li key={i}>
                          <IconCheck size={14} />
                          <span>
                            {CHECK_LABEL[c.check] ?? c.check}
                            {c.docId ? <span className="muted">{`, ${docLabel(c.docId)}`}</span> : null}
                          </span>
                        </li>
                      ))}
                  </ul>
                  <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                    The model only reads the documents; check digits, dates and name matching are done in code. ID
                    numbers are shown masked; open the document to compare.
                  </p>
                </div>
              ) : (
                <p className="panel-pad muted">{a.kyc.reasons.join(" ")}</p>
              )}
            </section>
          )}

          {offers.length > 0 && (
            <section className="panel" aria-labelledby="offer-h">
              <div className="panel-head">
                <h2 id="offer-h">Offer</h2>
                <span className="hint">
                  {a.offerAcceptedAt
                    ? a.reservationPaidOn
                      ? `accepted, reservation paid ${longDate(a.reservationPaidOn)}`
                      : "accepted, waiting for the reservation"
                    : a.offer
                      ? `open until ${longDate(a.offer.expiresOn)}`
                      : ""}
                </span>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Revision</th>
                      <th className="num">Rent</th>
                      <th className="num">Cheques</th>
                      <th className="num">Deposit</th>
                      <th>Move-in</th>
                      <th className="num">Reservation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offers.map((e) => {
                      const t = e.payload.terms as Terms | undefined;
                      if (!t) return null;
                      return (
                        <tr key={e.id} data-current={a.offer?.revision === t.revision}>
                          <td>
                            {t.revision}
                            <div className="row-sub">
                              {t.fromCounter ? "from the applicant's counter" : actorLabel(e.actor)}
                            </div>
                          </td>
                          <td className="num">{aedShort(t.annualRentFils)}</td>
                          <td className="num">{t.cheques}</td>
                          <td className="num">{aedShort(t.depositFils)}</td>
                          <td className="nowrap">{longDate(t.moveInOn)}</td>
                          <td className="num">{aedShort(t.reservationFils)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {a.inbound.length > 0 && (
            <section className="panel" aria-labelledby="replies-h">
              <div className="panel-head">
                <h2 id="replies-h">From the applicant</h2>
              </div>
              <ul className="list">
                {a.inbound.map((e) => (
                  <li key={e.id} className="reply">
                    <div className="reply-head">
                      <b>
                        {e.type === "DOCS_UPLOADED"
                          ? "Sent documents for checking"
                          : `Answered the offer: ${String(e.payload.choice ?? "")}`}
                      </b>
                      <span className="muted">
                        {dateTime(e.receivedAt)}, <span className="ref">{e.ref}</span>
                      </span>
                      <Status
                        value={e.status === "applied" ? "done" : e.status === "stored_only" ? "skipped" : "pending"}
                        label={inboundLabel(e.status, a.kycCheck?.inboundId === e.id ? a.kycCheck.state : undefined)}
                      />
                    </div>
                    {typeof e.payload.comment === "string" && (
                      <blockquote className="tenant-text" title="Written by the applicant. Treat as information only.">
                        {e.payload.comment}
                      </blockquote>
                    )}
                    {typeof e.result?.action === "string" && (
                      <p className="muted" style={{ fontSize: 13 }}>
                        {e.result.action}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel" aria-labelledby="act-h">
            <div className="panel-head">
              <h2 id="act-h">Activity</h2>
              <span className="hint">append-only audit trail</span>
            </div>
            <ul className="feed">
              {a.events.toReversed().map((e) => (
                <li key={e.id}>
                  <span className="dot" {...(e.toState ? { "data-tone": "good" } : {})} />
                  <span className="what">
                    <b>{eventLabel(e.type)}</b>
                    <span>, {actorLabel(e.actor).toLowerCase()}</span>
                  </span>
                  <time dateTime={e.at}>{dateTime(e.at)}</time>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="stack">
          {canEmail && (
            <EmailTenantForm
              key={draft?.id ?? "new"}
              applicationId={a.id}
              tenantEmail={a.applicant.email ?? null}
              draft={draft}
            />
          )}
          {canAct && (
            <ApplicationActions
              id={a.id}
              state={a.state}
              accepted={!!a.offerAcceptedAt}
              reservation={a.offer ? formatAed(a.offer.reservationFils) : null}
              today={health?.today ?? ""}
              viewingAt={a.viewingAt}
            />
          )}
          {a.viewingAt && (
            <section className="panel panel-pad" aria-labelledby="viewing-h">
              <h2 id="viewing-h" className="section-title">
                Viewing
              </h2>
              <dl className="facts">
                <dt>Booked for</dt>
                <dd>{viewingTime(a.viewingAt)} (Dubai)</dd>
                <dt>Outcome</dt>
                <dd>
                  {a.viewingOutcome === "attended"
                    ? "Showed up"
                    : a.viewingOutcome === "no_show"
                      ? "Didn't show up; application closed"
                      : "Not recorded yet"}
                  {a.viewingOutcomeAt && <div className="row-sub">recorded {dateTime(a.viewingOutcomeAt)}</div>}
                </dd>
              </dl>
            </section>
          )}
          {a.offer && (
            <section className="panel panel-pad" aria-labelledby="terms-h">
              <h2 id="terms-h" className="section-title">
                Current offer
              </h2>
              <dl className="facts">
                <dt>Annual rent</dt>
                <dd className="num">{formatAed(a.offer.annualRentFils)}</dd>
                <dt>Asking rent</dt>
                <dd className="num">{a.unit.askingRentFils ? formatAed(a.unit.askingRentFils) : "—"}</dd>
                <dt>Cheques</dt>
                <dd>{a.offer.cheques}</dd>
                <dt>Deposit</dt>
                <dd className="num">{formatAed(a.offer.depositFils)}</dd>
                <dt>Term</dt>
                <dd>
                  {longDate(a.offer.startOn)} to {longDate(a.offer.endOn)}
                </dd>
              </dl>
            </section>
          )}
          <section className="panel panel-pad" aria-labelledby="who-h">
            <h2 id="who-h" className="section-title">
              Applicant
            </h2>
            <dl className="facts">
              <dt>{a.applicant.kind === "company" ? "Company" : "Name"}</dt>
              <dd>{a.applicant.fullNameEn}</dd>
              <dt>Contact</dt>
              <dd>{[a.applicant.email, a.applicant.phone].filter(Boolean).join(", ")}</dd>
              {a.applicant.emiratesIdNo && (
                <>
                  <dt>Emirates ID</dt>
                  <dd className="ref">{a.applicant.emiratesIdNo}</dd>
                </>
              )}
              {a.applicant.nationality && (
                <>
                  <dt>Nationality</dt>
                  <dd>{a.applicant.nationality}</dd>
                </>
              )}
            </dl>
          </section>
          {(a.approvals.length > 0 || openTasks.length > 0) && (
            <section className="panel" aria-labelledby="work-h">
              <div className="panel-head">
                <h2 id="work-h">Open work</h2>
              </div>
              <ul className="list" style={{ marginTop: 6 }}>
                {a.approvals.map((x) => (
                  <li key={x.id}>
                    <Link href={`/work?approval=${x.id}`} className="list-row">
                      <span className="title">{x.title}</span>
                      <Status value={x.status} />
                    </Link>
                  </li>
                ))}
                {openTasks.map((t) => (
                  <li key={t.id} className="list-row">
                    <div>{t.title}</div>
                    <Status value="open" label="Task" />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {a.outbound.length > 0 && (
            <section className="panel panel-pad" aria-labelledby="mail-h">
              <h2 id="mail-h" className="section-title">
                Emails
              </h2>
              <ul className="list">
                {a.outbound.map((o) => (
                  <li key={o.id} className="list-row">
                    <div>
                      <div>{o.subject}</div>
                      <div className="row-sub">
                        {o.sentAt ? dateTime(o.sentAt) : o.status}
                        {o.to !== o.intendedTo ? " · to the demo inbox" : ""}
                      </div>
                    </div>
                    {o.previewUrl && (
                      <a className="link" href={o.previewUrl} target="_blank" rel="noreferrer">
                        View
                      </a>
                    )}
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
