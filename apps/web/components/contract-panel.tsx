import { CONTRACT_CLAUSES, type ContractClauseId } from "@leasing/core";
import Link from "next/link";
import { dateTime, humanise, proposalValue } from "../lib/format";
import { CheckIcon as IconCheck, WarningIcon as IconWarning } from "@phosphor-icons/react/dist/ssr";
import {
  PrepareContractForm,
  ProposeEjariButton,
  ReprepareContractButton,
  ResendSignLinkButton,
} from "./contract-forms";
import { Status } from "./ui";
import { buttonClass } from "./ui/button";
import { NOTE_TEXT, ROW_CARD, Section, TENANT_TEXT } from "./ui/record";

const LIST = "m-0 grid list-none gap-1.5 p-0 text-sm";
const TABLE = "overflow-x-auto rounded-xl border border-line";
const EVIDENCE = "grid gap-2 rounded-xl border border-line p-3.5";

export interface ContractRow {
  id: string;
  version: number;
  status: string;
  fields: Record<string, unknown>;
  sources: Record<string, { entity: string; id: string; column: string }>;
  addendum: {
    clauses: string[];
    freeText: string | null;
    companyClauses?: { id: string; title: string; text: string }[];
  };
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

/** What the prepare form offers: the rule's preselected clauses and the company's approved clauses. */
export interface ClauseOptions {
  suggested: string[];
  companyClauses: { ref: string; title: string; text: string; hasValues: boolean }[];
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
    <div className={TABLE}>
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
                <td className={k.endsWith("No") ? "font-mono text-xs" : undefined}>{proposalValue(k, fields[k])}</td>
                <td className="text-muted">
                  {src ? `${SOURCE_ENTITY[src.entity] ?? src.entity}: ${src.column}` : "—"}
                </td>
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
    <div className="grid gap-2">
      {attempts.map((a) => (
        <div key={a.submissionId} className={EVIDENCE}>
          <div className="flex flex-wrap items-center gap-2">
            <b className="font-semibold">Attempt {a.attempt}</b>
            <Status value="rejected" />
          </div>
          {a.autofix?.map((f) => (
            <p key={f.field} className={NOTE_TEXT}>
              Sent with {humanise(f.field).toLowerCase()} corrected from &ldquo;{f.from}&rdquo; to &ldquo;{f.to}&rdquo;
              ({f.source}).
            </p>
          ))}
          <ul className={`${LIST} list-disc pl-5`}>
            {a.reasons.map((r) => (
              <li key={r.code + r.message}>
                <span className="font-mono text-xs">{r.code}</span> {r.message}
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
  options,
  prepareNeeded = null,
}: {
  leaseId: string;
  state: string;
  contracts: ContractRow[];
  canAct: boolean;
  options?: ClauseOptions | undefined;
  /** Set by the engine only when the automatic preparation failed or the contract config changed since. */
  prepareNeeded?: "failed" | "rejected" | "not_prepared" | "rules_changed" | null;
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
    <Section id="contract-h" title="Contract" hint={hint}>
      {!current && (
        <div className="grid gap-3">
          <p className="m-0 text-sm text-muted">
            The engine prepares the contract from the verified records when the reservation is recorded. You can also
            prepare it here.
          </p>
          {canAct && (
            <PrepareContractForm
              leaseId={leaseId}
              clauses={options?.suggested ?? []}
              freeText={null}
              label="Prepare the contract"
              companyClauses={options?.companyClauses ?? []}
            />
          )}
        </div>
      )}

      {current && (
        <div className="grid gap-4">
          <div className={`${ROW_CARD} flex items-center justify-between gap-3`}>
            <div className="grid gap-0.5 text-sm">
              <div className="font-semibold">
                Version {current.version}{" "}
                <span className="font-normal text-muted">prepared {dateTime(current.createdAt)}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 font-mono text-[11.5px] text-muted">
                <span>SHA-256 {current.sha256.slice(0, 16)}…</span>
                {current.signedSha256 && <span>signed {current.signedSha256.slice(0, 16)}…</span>}
              </div>
            </div>
            <Status value={current.status} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {current.documentId && (
              <a
                className={buttonClass("ghost", "sm")}
                href={doc(leaseId, current.documentId)}
                target="_blank"
                rel="noreferrer"
              >
                Open the contract PDF
              </a>
            )}
            {current.signedDocumentId && (
              <a
                className={buttonClass("ghost", "sm")}
                href={doc(leaseId, current.signedDocumentId)}
                target="_blank"
                rel="noreferrer"
              >
                Open the signed copy
              </a>
            )}
            {current.approvalId && current.status === "pending_approval" && (
              <Link className={buttonClass("ghost", "sm")} href={`/work?approval=${current.approvalId}`}>
                Open the approval
              </Link>
            )}
          </div>

          {current.flags.length > 0 && (
            <ul className={LIST}>
              {current.flags.map((f) => (
                <li
                  key={f.quote}
                  data-blocking={f.kind === "illegal_term"}
                  className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 ${f.kind === "illegal_term" ? "border-danger text-danger" : "border-warning text-warning"}`}
                >
                  <IconWarning size={15} className="mt-0.5 shrink-0" />
                  <span>
                    <b>{humanise(f.kind)}:</b> &ldquo;{f.quote}&rdquo; {f.reason}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {current.signers.length > 0 && (
            <div className={TABLE}>
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
                        <div className="text-[12.5px] text-muted">{s.email ?? "no email on record"}</div>
                      </td>
                      <td>
                        {s.signedAt ? (
                          <span className="inline-flex flex-wrap items-center gap-1">
                            <IconCheck size={14} /> Signed {dateTime(s.signedAt)}
                            {s.typedName && <span className="text-muted"> as &ldquo;{s.typedName}&rdquo;</span>}
                          </span>
                        ) : (
                          <span className="text-muted">
                            {s.linkSent ? "Link sent, not signed yet" : "Link being sent"}
                          </span>
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
            <summary className="cursor-pointer text-sm font-semibold">Fields and where each was copied from</summary>
            <div className="mt-2">
              <ContractFieldsTable fields={current.fields} sources={current.sources} />
            </div>
          </details>

          {(current.addendum.clauses.length > 0 || current.addendum.freeText) && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold">Addendum</summary>
              <ul className={`${LIST} mt-2 list-disc pl-5`}>
                {current.addendum.clauses
                  .filter((c) => Object.hasOwn(CONTRACT_CLAUSES, c))
                  .map((c) => (
                    <li key={c}>
                      <b>{CONTRACT_CLAUSES[c as ContractClauseId].title}.</b>{" "}
                      {CONTRACT_CLAUSES[c as ContractClauseId].text}
                    </li>
                  ))}
              </ul>
              {(current.addendum.companyClauses?.length ?? 0) > 0 && (
                <>
                  <p className="m-0 mt-2 text-sm text-muted">Additional terms (company)</p>
                  <ul className={`${LIST} list-disc pl-5`}>
                    {current.addendum.companyClauses?.map((c) => (
                      <li key={c.id}>
                        <b>{c.title}.</b> {c.text}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {current.addendum.freeText && (
                <blockquote className={TENANT_TEXT}>{current.addendum.freeText}</blockquote>
              )}
            </details>
          )}

          {canAct && state === "CONTRACT" && prepareNeeded && (
            <ReprepareContractButton leaseId={leaseId} reason={prepareNeeded} clauses={options?.suggested ?? []} />
          )}

          {canAct && state === "CONTRACT" && current.status !== "signed" && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold">Prepare a new version</summary>
              <div className="mt-2.5 grid gap-2">
                <PrepareContractForm
                  leaseId={leaseId}
                  clauses={current.addendum.clauses}
                  freeText={current.addendum.freeText}
                  label="Prepare a new version"
                  companyClauses={options?.companyClauses ?? []}
                />
                <p className={NOTE_TEXT}>
                  The new version replaces this one: its approval is cancelled and its signing links stop working.
                </p>
              </div>
            </details>
          )}

          {older.length > 0 && (
            <p className={NOTE_TEXT}>
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
    </Section>
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
    <Section
      id="ejari-h"
      title={`Ejari${demo ? " (simulated)" : ""}`}
      hint={
        issued
          ? `Registered, ${issued.ejariNo}`
          : inFlight
            ? "On its way to the registry"
            : pendingApprovalId
              ? "Waiting for approval"
              : attempts.length
                ? "Needs a person"
                : "Not submitted yet"
      }
    >
      <div className="grid gap-3">
        {attempts.length === 0 && (
          <p className="m-0 text-sm text-muted">
            The submission is built from the signed contract and waits for an officer&apos;s approval.
          </p>
        )}
        {attempts.map((a) => (
          <div key={a.id} className={EVIDENCE}>
            <div className="flex flex-wrap items-center gap-2">
              <b className="font-semibold">Attempt {a.attempt}</b>
              <Status value={a.status} />
              {a.completedAt && <span className="text-xs text-muted">{dateTime(a.completedAt)}</span>}
            </div>
            {a.autofix?.map((f) => (
              <p
                key={f.field}
                className="m-0 flex items-start gap-2 rounded-xl border border-warning px-3.5 py-2.5 text-sm text-warning"
              >
                <IconWarning size={15} className="mt-0.5 shrink-0" />
                <span>
                  Corrected {humanise(f.field).toLowerCase()} from <b>&ldquo;{f.from}&rdquo;</b> to{" "}
                  <b>&ldquo;{f.to}&rdquo;</b> (case or spacing only), from {f.source}. The signed contract keeps its
                  text.
                </span>
              </p>
            ))}
            {a.reasons.length > 0 && (
              <ul className={`${LIST} list-disc pl-5`}>
                {a.reasons.map((r) => (
                  <li key={r.code + r.message}>
                    <span className="font-mono text-xs">{r.code}</span> {r.message}
                  </li>
                ))}
              </ul>
            )}
            {a.error && <p className="m-0 text-sm font-semibold text-danger">{a.error}</p>}
            {a.ejariNo && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{a.ejariNo}</span>
                {a.certificateDocumentId && (
                  <a
                    className={buttonClass("ghost", "sm")}
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
        <div className="flex flex-wrap items-center gap-2">
          {pendingApprovalId && (
            <Link className={buttonClass("ghost", "sm")} href={`/work?approval=${pendingApprovalId}`}>
              Open the approval
            </Link>
          )}
          {canAct && state === "REGISTRATION" && !pendingApprovalId && !inFlight && !issued && (
            <ProposeEjariButton leaseId={leaseId} />
          )}
          {mockUrl && (
            <a className={buttonClass("ghost", "sm")} href={mockUrl} target="_blank" rel="noreferrer">
              Open the simulated registry
            </a>
          )}
        </div>
      </div>
    </Section>
  );
}
