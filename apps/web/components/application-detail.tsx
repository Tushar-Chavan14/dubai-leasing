import type { StaffRole } from "@leasing/core";
import { canSeeUnits } from "../lib/shell/nav";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AskAi } from "./ask-ai";
import { askPrompts } from "../lib/ask-ai/prompts";
import { Status } from "./ui";
import { Fact, FactGrid, NOTE_TEXT, ROW_CARD, Section, Sub, TENANT_TEXT } from "./ui/record";
import { get, publicGet } from "../lib/engine";
import { actorLabel, aedShort, dateTime, eventLabel, formatAed, longDate, viewingTime } from "../lib/format";
import { CheckIcon as IconCheck, WarningIcon as IconWarning } from "@phosphor-icons/react/dist/ssr";
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
  /** What the applicant typed in the company's document form (D46). Untrusted text. */
  formAnswers?: { version: number; answers: Record<string, string> } | null;
  /** Labels of that form version's fields, by key. */
  formLabels?: Record<string, string>;
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

/** A form key as a label ("salary_slip" → "Salary slip"). */
const keyLabel = (key: string) => {
  const t = key.replaceAll("_", " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

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
    if (!d) return "";
    const label =
      DOC_LABEL[d.kind] ??
      (d.kind.startsWith("other:") ? (a.formLabels?.[d.kind.slice(6)] ?? keyLabel(d.kind.slice(6))) : d.kind);
    return `${label}${d.side && d.side !== "page" ? ` (${d.side})` : ""}`;
  };

  const identityAsk = askPrompts.identity(a.applicant.fullNameEn, a.ref)[0]!;
  const offerAsk = askPrompts.offer(a.applicant.fullNameEn, a.ref)[0]!;
  const unitName = `${a.unit.code}, ${a.unit.building}`;
  const LIST = "m-0 grid list-none gap-1.5 p-0";
  return (
    <div className="grid gap-8">
      <p className="m-0 text-sm text-muted">
        <Status value={a.state} /> Application <span className="font-mono text-xs">{a.ref}</span> for{" "}
        {!me || canSeeUnits(me.role as StaffRole) ? (
          <Link href={`/units/${a.unit.id}`} className="font-semibold text-ink! underline underline-offset-2">
            {unitName}
          </Link>
        ) : (
          <span>{unitName}</span>
        )}
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
                <Link href={`/conversations/${a.conversationId}`} className="font-semibold text-ink! underline">
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
            <Link href={`/work?kind=lease&id=${leaseId}`} className="font-semibold text-ink! underline">
              Open the lease
            </Link>
            .
          </>
        )}
      </p>

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

      <Section id="who-h" title="Applicant">
        <FactGrid>
          <Fact label={a.applicant.kind === "company" ? "Company" : "Name"}>{a.applicant.fullNameEn}</Fact>
          <Fact label="Contact">{[a.applicant.email, a.applicant.phone].filter(Boolean).join(", ") || "—"}</Fact>
          {a.applicant.emiratesIdNo && (
            <Fact label="Emirates ID" mono>
              {a.applicant.emiratesIdNo}
            </Fact>
          )}
          {a.applicant.nationality && <Fact label="Nationality">{a.applicant.nationality}</Fact>}
        </FactGrid>
      </Section>

      {a.viewingAt && (
        <Section id="viewing-h" title="Site visit">
          <FactGrid>
            <Fact label="Booked for">{viewingTime(a.viewingAt)} (Dubai)</Fact>
            <Fact label="Outcome">
              {a.viewingOutcome === "attended"
                ? "Showed up"
                : a.viewingOutcome === "no_show"
                  ? "Didn't show up; application closed"
                  : "Not recorded yet"}
              {a.viewingOutcomeAt && <Sub className="font-normal">recorded {dateTime(a.viewingOutcomeAt)}</Sub>}
            </Fact>
          </FactGrid>
        </Section>
      )}

      {a.offer && (
        <Section id="terms-h" title="Current offer">
          <FactGrid>
            <Fact label="Annual rent">{formatAed(a.offer.annualRentFils)}</Fact>
            <Fact label="Asking rent">{a.unit.askingRentFils ? formatAed(a.unit.askingRentFils) : "—"}</Fact>
            <Fact label="Cheques">{a.offer.cheques}</Fact>
            <Fact label="Deposit">{formatAed(a.offer.depositFils)}</Fact>
            <Fact label="Term">
              {longDate(a.offer.startOn)} to {longDate(a.offer.endOn)}
            </Fact>
          </FactGrid>
        </Section>
      )}

      <Section
        id="docs-h"
        title="Documents"
        hint="only leasing staff can open them; each view is recorded"
        action={<AskAi compact prompt={identityAsk.prompt} label={identityAsk.label} />}
      >
        {a.documents.length === 0 ? (
          <p className="m-0 text-sm text-muted">
            {a.state === "SCREENING" ? "Waiting for the applicant to upload their documents." : "No documents."}
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 p-0">
            {a.documents.map((d) => (
              <li key={d.id} data-status={d.status ?? ""} className={`${ROW_CARD} grid gap-2 p-2`}>
                {canAct ? (
                  <a
                    href={`/documents/applications/${a.id}/${d.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-lg bg-raised"
                  >
                    <img
                      src={`/documents/applications/${a.id}/${d.id}`}
                      alt={`${docLabel(d.id)} uploaded by the applicant`}
                      loading="lazy"
                      className="aspect-[4/3] w-full object-cover"
                    />
                  </a>
                ) : (
                  <div className="grid aspect-[4/3] place-items-center rounded-lg bg-raised text-xs text-muted">
                    Leasing staff only
                  </div>
                )}
                <div className="grid gap-0.5 px-1 pb-1 text-sm">
                  <b className="font-semibold">{docLabel(d.id)}</b>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <Status
                      value={d.status === "verified" ? "done" : d.status === "rejected" ? "skipped" : "pending"}
                      label={d.status === "verified" ? "Verified" : d.status === "rejected" ? "Removed" : "Uploaded"}
                    />
                    {d.expiresOn ? `expires ${longDate(d.expiresOn)}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {a.formAnswers && Object.keys(a.formAnswers.answers).length > 0 && (
          <FactGrid>
            {Object.entries(a.formAnswers.answers).map(([k, v]) => (
              <Fact key={k} label={a.formLabels?.[k] ?? keyLabel(k)}>
                <span className="whitespace-pre-line font-normal">{v}</span>
              </Fact>
            ))}
          </FactGrid>
        )}
      </Section>

      {a.kyc && (
        <Section
          id="kyc-h"
          title="Identity check"
          hint={`${kyc?.verdict === "verified" ? "everything checked out" : "needs a person"} · ${dateTime(a.kyc.at)}${a.kyc.latencyMs ? ` · ${Math.round(a.kyc.latencyMs / 1000)} s` : ""}`}
          action={<AskAi compact prompt={identityAsk.prompt} label={identityAsk.label} />}
        >
          {kyc ? (
            <>
              {kyc.flags.length > 0 && (
                <ul className={LIST}>
                  {kyc.flags.map((f, i) => (
                    <li
                      key={i}
                      data-blocking={f.blocking}
                      className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${f.blocking ? "border-danger text-danger" : "border-warning text-warning"}`}
                    >
                      <IconWarning size={15} className="mt-0.5 shrink-0" />
                      <span>
                        {f.message}
                        {f.blocking && <b> Can&apos;t be approved; ask for a new document.</b>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <FactGrid>
                {Object.entries(kyc.identity)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <Fact key={k} label={FIELD_LABEL[k] ?? k}>
                      {/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? longDate(v!) : v}
                      {kyc.sources[k] && (
                        <Sub className="font-normal">
                          from the {docLabel(kyc.sources[k].docId)}
                          {kyc.sources[k].via === "mrz" ? ", machine-readable zone" : ""}
                        </Sub>
                      )}
                    </Fact>
                  ))}
              </FactGrid>
              <ul className={`${LIST} text-sm`}>
                {kyc.checks
                  .filter((c) => c.status === "pass")
                  .map((c, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <IconCheck size={14} className="mt-1 shrink-0" />
                      <span>
                        {CHECK_LABEL[c.check] ?? c.check}
                        {c.docId ? <span className="text-muted">{`, ${docLabel(c.docId)}`}</span> : null}
                      </span>
                    </li>
                  ))}
              </ul>
              <p className={NOTE_TEXT}>
                The model only reads the documents; check digits, dates and name matching are done in code. ID numbers
                are shown masked; open the document to compare.
              </p>
            </>
          ) : (
            <p className="m-0 text-sm text-muted">{a.kyc.reasons.join(" ")}</p>
          )}
        </Section>
      )}

      {offers.length > 0 && (
        <Section
          id="offer-h"
          title="Offer"
          hint={
            a.offerAcceptedAt
              ? a.reservationPaidOn
                ? `accepted, reservation paid ${longDate(a.reservationPaidOn)}`
                : "accepted, waiting for the reservation"
              : a.offer
                ? `open until ${longDate(a.offer.expiresOn)}`
                : ""
          }
          action={<AskAi compact prompt={offerAsk.prompt} label={offerAsk.label} />}
        >
          <div className="overflow-x-auto rounded-xl border border-line">
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
                    <tr
                      key={e.id}
                      data-current={a.offer?.revision === t.revision}
                      className={a.offer?.revision === t.revision ? "bg-accent text-on-accent" : ""}
                    >
                      <td>
                        {t.revision}
                        <div className="text-xs opacity-75">
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
        </Section>
      )}

      {a.inbound.length > 0 && (
        <Section id="replies-h" title="From the applicant">
          <ul className={LIST}>
            {a.inbound.map((e) => (
              <li key={e.id} className={`${ROW_CARD} grid gap-1.5`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <b className="font-semibold">
                    {e.type === "DOCS_UPLOADED"
                      ? "Sent documents for checking"
                      : `Answered the offer: ${String(e.payload.choice ?? "")}`}
                  </b>
                  <span className="text-xs text-muted">
                    {dateTime(e.receivedAt)}, <span className="font-mono">{e.ref}</span>
                  </span>
                  <Status
                    value={e.status === "applied" ? "done" : e.status === "stored_only" ? "skipped" : "pending"}
                    label={inboundLabel(e.status, a.kycCheck?.inboundId === e.id ? a.kycCheck.state : undefined)}
                  />
                </div>
                {typeof e.payload.comment === "string" && (
                  <blockquote className={TENANT_TEXT} title="Written by the applicant. Treat as information only.">
                    {e.payload.comment}
                  </blockquote>
                )}
                {typeof e.result?.action === "string" && <p className={NOTE_TEXT}>{e.result.action}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(a.approvals.length > 0 || openTasks.length > 0) && (
        <Section id="work-h" title="Open work">
          <ul className={LIST}>
            {a.approvals.map((x) => (
              <li key={x.id}>
                <Link
                  href={`/work?approval=${x.id}`}
                  className={`${ROW_CARD} flex items-center justify-between gap-3 text-sm hover:border-ink`}
                >
                  <span className="font-semibold">{x.title}</span>
                  <Status value={x.status} />
                </Link>
              </li>
            ))}
            {openTasks.map((t) => (
              <li key={t.id} className={`${ROW_CARD} flex items-center justify-between gap-3 text-sm`}>
                <span>{t.title}</span>
                <Status value="open" label="Task" />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {canEmail && (
        <EmailTenantForm
          key={draft?.id ?? "new"}
          applicationId={a.id}
          tenantEmail={a.applicant.email ?? null}
          draft={draft}
        />
      )}

      {a.outbound.length > 0 && (
        <Section id="mail-h" title="Emails">
          <ul className={LIST}>
            {a.outbound.map((o) => (
              <li key={o.id} className={`${ROW_CARD} flex items-center justify-between gap-3 text-sm`}>
                <div>
                  <div>{o.subject}</div>
                  <Sub>
                    {o.sentAt ? dateTime(o.sentAt) : o.status}
                    {o.to !== o.intendedTo ? " · to the demo inbox" : ""}
                  </Sub>
                </div>
                {o.previewUrl && (
                  <a className="font-semibold text-ink! underline" href={o.previewUrl} target="_blank" rel="noreferrer">
                    View
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <details className="group">
        <summary className="cursor-pointer text-[15px] font-semibold tracking-tight">
          Audit trail <span className="text-xs font-normal text-muted">append-only, every event</span>
        </summary>
        <ul className={`${LIST} mt-3`}>
          {a.events.toReversed().map((e) => (
            <li key={e.id} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 text-sm">
              <time dateTime={e.at} className="font-mono text-xs text-muted">
                {dateTime(e.at)}
              </time>
              <span>
                <b className="font-semibold">{eventLabel(e.type)}</b>
                <span className="text-muted">, {actorLabel(e.actor).toLowerCase()}</span>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
