import { CONTRACT_CLAUSES, type ContractClauseId } from "@leasing/core";
import Link from "next/link";
import { dateTime, humanise, proposalValue } from "../lib/format";
import { IconCheck, IconWarning } from "../lib/icons";
import { PrepareContractForm, ProposeEjariButton, ResendSignLinkButton } from "./contract-forms";
import { Status } from "./ui";

export interface ContractRow {
  id: string;
  version: number;
  status: string;
  fields: Record<string, unknown>;
  sources: Record<string, { entity: string; id: string; column: string }>;
  addendum: { clauses: string[]; freeText: string | null };
  flags: { kind: string; quote: string; reason: string }[];
  sha256: string;
  signedSha256: string | null;
  approvalId: string | null;
  documentId: string | null;
  signedDocumentId: string | null;
  createdBy: string;
  createdAt: string;
  sentAt: string | null;
  signedAt: string | null;
  signers: {
    id: string;
    role: string;
    nameEn: string;
    email: string | null;
    linkSent: boolean;
    signedAt: string | null;
    typedName: string | null;
  }[];
}

export interface EjariAttempt {
  id: string;
  approvalId: string;
  attempt: number;
  status: string;
  payload: Record<string, unknown>;
  reasons: { code: string; field: string | null; message: string }[];
  autofix: { field: string; from: string; to: string; source: string }[] | null;
  ejariNo: string | null;
  tries: number;
  error: string | null;
  certificateDocumentId: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** Contract fields in reading order, with plain labels. */
const FIELDS: [string, string][] = [
  ["tenantNameEn", "Tenant name"],
  ["tenantEmiratesIdNo", "Tenant Emirates ID"],
  ["tenantPassportNo", "Tenant passport"],
  ["tenantNationality", "Tenant nationality"],
  ["tenantTradeLicenceNo", "Tenant trade licence"],
  ["tenantIdExpiresOn", "Tenant ID expiry"],
  ["landlordNameEn", "Landlord name"],
  ["landlordIdNo", "Landlord ID / licence"],
  ["dldPropertyNo", "DLD property no."],
  ["unitNo", "Unit no."],
  ["makaniNo", "Makani no."],
  ["plotNo", "Plot no."],
  ["startOn", "Term starts"],
  ["endOn", "Term ends"],
  ["moveInOn", "Move-in"],
  ["annualRentFils", "Annual rent"],
  ["cheques", "Cheques"],
  ["depositFils", "Security deposit"],
  ["rentFreeDays", "Rent-free days"],
];
const SOURCE_ENTITY: Record<string, string> = {
  party: "Party record",
  unit: "Unit record",
  lease: "Lease terms",
  application: "Accepted offer",
};

/** Each contract field, its value as stored, and the record column it was copied from. */
export function ContractFieldsTable({
  fields,
  sources,
}: {
  fields: Record<string, unknown>;
  sources: Record<string, { entity: string; id: string; column: string }>;
}) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Field</th>
            <th>Value</th>
            <th>Copied from</th>
          </tr>
        </thead>
        <tbody>
          {FIELDS.filter(([k]) => fields[k] !== null && fields[k] !== undefined).map(([k, label]) => {
            const src = sources[k];
            return (
              <tr key={k}>
                <td>{label}</td>
                <td className={k.endsWith("No") ? "ref" : undefined}>{proposalValue(k, fields[k])}</td>
                <td className="muted">{src ? `${SOURCE_ENTITY[src.entity] ?? src.entity}: ${src.column}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The Ejari attempts behind an `ejari_rejected_twice` approval. */
export function EjariAttemptsList({
  attempts,
}: {
  attempts: {
    submissionId: string;
    attempt: number;
    reasons: { code: string; message: string }[];
    autofix: { field: string; from: string; to: string; source: string }[] | null;
  }[];
}) {
  return (
    <div className="stack">
      {attempts.map((a) => (
        <div key={a.submissionId} className="evidence">
          <div className="evidence-head">
            <b>Attempt {a.attempt}</b>
            <Status value="rejected" />
          </div>
          {a.autofix?.map((f) => (
            <p key={f.field} className="muted" style={{ margin: "6px 0" }}>
              Sent with {humanise(f.field).toLowerCase()} corrected from &ldquo;{f.from}&rdquo; to &ldquo;{f.to}&rdquo;
              ({f.source}).
            </p>
          ))}
          <ul className="reasons">
            {a.reasons.map((r) => (
              <li key={r.code + r.message}>
                <span className="ref">{r.code}</span> {r.message}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const doc = (leaseId: string, id: string) => `/documents/leases/${leaseId}/${id}`;

/** Step 5: the contract versions, what each field was copied from, the signers, and the PDFs. */
export function ContractPanel({
  leaseId,
  state,
  contracts,
  canAct,
}: {
  leaseId: string;
  state: string;
  contracts: ContractRow[];
  canAct: boolean;
}) {
  const current = contracts[0];
  const older = contracts.slice(1);
  if (!current && state !== "CONTRACT") return null;
  const hint = !current
    ? "Not prepared yet"
    : current.status === "pending_approval"
      ? "Waiting for approval"
      : current.status === "sent"
        ? `Signed by ${current.signers.filter((s) => s.signedAt).length} of ${current.signers.length}`
        : current.status === "signed"
          ? "Signed by both parties"
          : current.status === "rejected"
            ? "Not approved; prepare a new version"
            : "";

  return (
    <section className="panel" aria-labelledby="contract-h">
      <div className="panel-head">
        <h2 id="contract-h">Contract</h2>
        <span className="hint">{hint}</span>
      </div>

      {!current && (
        <div className="panel-pad stack">
          <p className="muted" style={{ margin: 0 }}>
            The engine prepares the contract from the verified records when the reservation is recorded. You can also
            prepare it here.
          </p>
          {canAct && (
            <PrepareContractForm leaseId={leaseId} clauses={[]} freeText={null} label="Prepare the contract" />
          )}
        </div>
      )}

      {current && (
        <div className="panel-pad stack">
          <div className="list-row" style={{ padding: 0 }}>
            <div>
              <div className="title">
                Version {current.version}{" "}
                <span className="muted" style={{ fontWeight: 400 }}>
                  prepared {dateTime(current.createdAt)}
                </span>
              </div>
              <div className="meta">
                <span className="ref">SHA-256 {current.sha256.slice(0, 16)}…</span>
                {current.signedSha256 && <span className="ref">signed {current.signedSha256.slice(0, 16)}…</span>}
              </div>
            </div>
            <Status value={current.status} />
          </div>

          <div className="btn-row">
            {current.documentId && (
              <a className="btn small" href={doc(leaseId, current.documentId)} target="_blank" rel="noreferrer">
                Open the contract PDF
              </a>
            )}
            {current.signedDocumentId && (
              <a className="btn small" href={doc(leaseId, current.signedDocumentId)} target="_blank" rel="noreferrer">
                Open the signed copy
              </a>
            )}
            {current.approvalId && current.status === "pending_approval" && (
              <Link className="btn small" href={`/inbox/${current.approvalId}`}>
                Open the approval
              </Link>
            )}
          </div>

          {current.flags.length > 0 && (
            <ul className="flag-list">
              {current.flags.map((f) => (
                <li key={f.quote} data-blocking={f.kind === "illegal_term"}>
                  <IconWarning size={15} />
                  <span>
                    <b>{humanise(f.kind)}:</b> &ldquo;{f.quote}&rdquo; {f.reason}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {current.signers.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Signer</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {current.signers.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <b>{s.role === "tenant" ? "Tenant" : "Landlord"}</b> {s.nameEn}
                        <div className="row-sub">{s.email ?? "no email on record"}</div>
                      </td>
                      <td>
                        {s.signedAt ? (
                          <span className="row-done">
                            <IconCheck size={14} /> Signed {dateTime(s.signedAt)}
                            {s.typedName && <span className="muted"> as &ldquo;{s.typedName}&rdquo;</span>}
                          </span>
                        ) : (
                          <span className="muted">{s.linkSent ? "Link sent, not signed yet" : "Link being sent"}</span>
                        )}
                      </td>
                      <td>
                        {canAct && !s.signedAt && current.status === "sent" && (
                          <ResendSignLinkButton leaseId={leaseId} signerId={s.id} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <details>
            <summary>Fields and where each was copied from</summary>
            <div style={{ marginTop: 8 }}>
              <ContractFieldsTable fields={current.fields} sources={current.sources} />
            </div>
          </details>

          {(current.addendum.clauses.length > 0 || current.addendum.freeText) && (
            <details>
              <summary>Addendum</summary>
              <ul className="reasons" style={{ marginTop: 8 }}>
                {current.addendum.clauses.map((c) => (
                  <li key={c}>
                    <b>{CONTRACT_CLAUSES[c as ContractClauseId]?.title ?? c}.</b>{" "}
                    {CONTRACT_CLAUSES[c as ContractClauseId]?.text}
                  </li>
                ))}
              </ul>
              {current.addendum.freeText && (
                <blockquote className="tenant-text">{current.addendum.freeText}</blockquote>
              )}
            </details>
          )}

          {canAct && state === "CONTRACT" && current.status !== "signed" && (
            <details>
              <summary>Prepare a new version</summary>
              <div style={{ marginTop: 10 }}>
                <PrepareContractForm
                  leaseId={leaseId}
                  clauses={current.addendum.clauses}
                  freeText={current.addendum.freeText}
                  label="Prepare a new version"
                />
                <p className="muted" style={{ fontSize: 12.5 }}>
                  The new version replaces this one: its approval is cancelled and its signing links stop working.
                </p>
              </div>
            </details>
          )}

          {older.length > 0 && (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Earlier versions:{" "}
              {older.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ", "}v{o.version} ({humanise(o.status).toLowerCase()})
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Step 6: every attempt to register the lease, the one auto-fix if any, and the certificate. */
export function EjariPanel({
  leaseId,
  state,
  attempts,
  canAct,
  pendingApprovalId,
  mockUrl,
  demo,
}: {
  leaseId: string;
  state: string;
  attempts: EjariAttempt[];
  canAct: boolean;
  pendingApprovalId: string | null;
  mockUrl: string | null;
  demo: boolean;
}) {
  if (!attempts.length && state !== "REGISTRATION") return null;
  const issued = attempts.find((a) => a.status === "issued");
  const inFlight = attempts.some((a) => a.status === "queued" || a.status === "sending");
  return (
    <section className="panel" aria-labelledby="ejari-h">
      <div className="panel-head">
        <h2 id="ejari-h">Ejari{demo ? " (simulated)" : ""}</h2>
        <span className="hint">
          {issued
            ? `Registered, ${issued.ejariNo}`
            : inFlight
              ? "On its way to the registry"
              : pendingApprovalId
                ? "Waiting for approval"
                : attempts.length
                  ? "Needs a person"
                  : "Not submitted yet"}
        </span>
      </div>
      <div className="panel-pad stack">
        {attempts.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            The submission is built from the signed contract and waits for an officer&apos;s approval.
          </p>
        )}
        {attempts.map((a) => (
          <div key={a.id} className="evidence">
            <div className="evidence-head">
              <b>Attempt {a.attempt}</b>
              <Status value={a.status} />
              {a.completedAt && <span className="muted">{dateTime(a.completedAt)}</span>}
            </div>
            {a.autofix?.map((f) => (
              <p key={f.field} className="alert" data-tone="warn" style={{ margin: "8px 0" }}>
                <IconWarning size={15} />
                <span>
                  Corrected {humanise(f.field).toLowerCase()} from <b>&ldquo;{f.from}&rdquo;</b> to{" "}
                  <b>&ldquo;{f.to}&rdquo;</b> (case or spacing only), from {f.source}. The signed contract keeps its
                  text.
                </span>
              </p>
            ))}
            {a.reasons.length > 0 && (
              <ul className="reasons">
                {a.reasons.map((r) => (
                  <li key={r.code + r.message}>
                    <span className="ref">{r.code}</span> {r.message}
                  </li>
                ))}
              </ul>
            )}
            {a.error && <p style={{ color: "var(--bad)", margin: "6px 0 0" }}>{a.error}</p>}
            {a.ejariNo && (
              <div className="btn-row" style={{ marginTop: 8 }}>
                <span className="ref">{a.ejariNo}</span>
                {a.certificateDocumentId && (
                  <a
                    className="btn small"
                    href={doc(leaseId, a.certificateDocumentId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the certificate
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
        <div className="btn-row">
          {pendingApprovalId && (
            <Link className="btn small" href={`/inbox/${pendingApprovalId}`}>
              Open the approval
            </Link>
          )}
          {canAct && state === "REGISTRATION" && !pendingApprovalId && !inFlight && !issued && (
            <ProposeEjariButton leaseId={leaseId} />
          )}
          {mockUrl && (
            <a className="btn small" href={mockUrl} target="_blank" rel="noreferrer">
              Open the simulated registry
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
