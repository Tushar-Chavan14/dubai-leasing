import { CONTRACT_CLAUSES, type ContractClauseId, formatAed } from "@leasing/core";
import type { Metadata } from "next";
import { publicGet } from "../../../../lib/engine";
import { dateTime, longDate } from "../../../../lib/format";
import { IconCheck } from "../../../../lib/icons";
import type { SignPortalView } from "../../../../lib/portal";
import { LinkGone } from "../link-gone";
import { SignForm } from "./sign-form";

export const metadata: Metadata = { title: "Sign your tenancy contract" };

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await publicGet<SignPortalView>(`/api/portal/${encodeURIComponent(token)}`);
  if (!v || v.kind !== "sign") return <LinkGone />;
  const f = v.contract.fields;
  const tenantId =
    f.tenantKind === "company"
      ? f.tenantTradeLicenceNo && `Trade licence ${f.tenantTradeLicenceNo}`
      : f.tenantEmiratesIdNo
        ? `Emirates ID ${f.tenantEmiratesIdNo}`
        : f.tenantPassportNo && `Passport ${f.tenantPassportNo}`;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 className="portal-title">Your tenancy contract</h1>
        <p className="muted">
          Unit {f.unitNo}, {f.building}, {f.community}. Lease {v.leaseRef}, version {v.contract.version}. You sign as
          the {v.role}
          {v.signerCapacity ? `: ${v.signerName}, ${v.signerCapacity}` : ""}.
        </p>
      </div>

      <section className="panel panel-pad stack">
        <dl className="facts">
          <dt>Landlord</dt>
          <dd>{f.landlordNameEn}</dd>
          <dt>Tenant</dt>
          <dd>
            {f.tenantNameEn}
            {tenantId && <div className="row-sub ref">{tenantId}</div>}
          </dd>
          <dt>Property</dt>
          <dd>
            Unit {f.unitNo}, {f.building}
            <div className="row-sub">
              DLD property no. <span className="ref">{f.dldPropertyNo}</span>, Makani{" "}
              <span className="ref">{f.makaniNo}</span>
            </div>
          </dd>
          <dt>Term</dt>
          <dd>
            {longDate(f.startOn)} to {longDate(f.endOn)}
          </dd>
          <dt>Move-in</dt>
          <dd>{longDate(f.moveInOn)}</dd>
          <dt>Annual rent</dt>
          <dd className="num">
            <b>{formatAed(f.annualRentFils)}</b> in {f.cheques} cheque{f.cheques === 1 ? "" : "s"}
          </dd>
          <dt>Security deposit</dt>
          <dd className="num">{formatAed(f.depositFils)}</dd>
          {f.rentFreeDays > 0 && (
            <>
              <dt>Rent-free days</dt>
              <dd>{f.rentFreeDays}</dd>
            </>
          )}
        </dl>
        {(v.contract.addendum.clauses.length > 0 || v.contract.addendum.freeText) && (
          <div className="stack" style={{ gap: 8 }}>
            <h2 className="section-title" style={{ margin: 0 }}>
              Addendum
            </h2>
            <ul className="reasons">
              {v.contract.addendum.clauses.map((c) => {
                const clause = CONTRACT_CLAUSES[c as ContractClauseId];
                return clause ? (
                  <li key={c}>
                    <b>{clause.title}.</b> {clause.text}
                  </li>
                ) : null;
              })}
            </ul>
            {(v.contract.addendum.companyClauses?.length ?? 0) > 0 && (
              <>
                <h3 className="section-title" style={{ margin: 0, fontSize: 14 }}>
                  Additional terms (company)
                </h3>
                <ul className="reasons">
                  {v.contract.addendum.companyClauses?.map((c) => (
                    <li key={c.id}>
                      <b>{c.title}.</b> {c.text}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {v.contract.addendum.freeText && (
              <blockquote className="tenant-text">{v.contract.addendum.freeText}</blockquote>
            )}
          </div>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          <a className="link" href={`/t/${token}/contract.pdf`} target="_blank" rel="noreferrer">
            Read the full contract (PDF)
          </a>
          . Document fingerprint <span className="ref">{v.contract.sha256.slice(0, 16)}</span>.
        </p>
        {v.demo && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Demo: this electronic signature is simulated and the contract is a demo template.
          </p>
        )}
      </section>

      {v.signedAt ? (
        <section className="panel panel-pad" role="status">
          <p className="row-done" style={{ margin: 0 }}>
            <IconCheck size={16} /> You signed this contract on {dateTime(v.signedAt)}. We&apos;ll email you the signed
            copy once everyone has signed.
          </p>
        </section>
      ) : v.canSign ? (
        <SignForm token={token} name={v.signerName} />
      ) : (
        <LinkGone message="This contract can't be signed from this link any more. Use the newest email from us." />
      )}
    </div>
  );
}
