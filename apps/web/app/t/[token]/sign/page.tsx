import { CONTRACT_CLAUSES, type ContractClauseId, formatAed } from "@leasing/core";
import type { Metadata } from "next";
import { ArrowSquareOutIcon as IconOpen, FilePdfIcon as IconPdf } from "@phosphor-icons/react/dist/ssr";
import { Note, PAGE, PortalTitle, Rows, Section, Tiles } from "../../../../components/ui/portal";
import { portalView } from "../../../../lib/engine";
import { dateTime, longDate } from "../../../../lib/format";
import type { SignPortalView } from "../../../../lib/portal";
import { LinkGone } from "../link-gone";
import { SignForm } from "./sign-form";

export const metadata: Metadata = { title: "Sign your tenancy contract" };

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await portalView<SignPortalView>(token);
  if (!v || v.kind !== "sign") return <LinkGone />;
  const f = v.contract.fields;
  const tenantId =
    f.tenantKind === "company"
      ? f.tenantTradeLicenceNo && `Trade licence ${f.tenantTradeLicenceNo}`
      : f.tenantEmiratesIdNo
        ? `Emirates ID ${f.tenantEmiratesIdNo}`
        : f.tenantPassportNo && `Passport ${f.tenantPassportNo}`;
  const hasAddendum = v.contract.addendum.clauses.length > 0 || v.contract.addendum.freeText;
  const companyClauses = v.contract.addendum.companyClauses ?? [];
  return (
    <div className={PAGE}>
      <PortalTitle
        title="Sign your tenancy contract"
        sub={
          <>
            Unit {f.unitNo}, {f.building}, {f.community}. Lease {v.leaseRef}, version {v.contract.version}. You sign as
            the {v.role}
            {v.signerCapacity ? `: ${v.signerName}, ${v.signerCapacity}` : ""}.
          </>
        }
      />
      <Tiles
        label="Contract summary"
        items={[
          { label: "Annual rent", value: formatAed(f.annualRentFils) },
          { label: "Cheques", value: f.cheques },
          { label: "Security deposit", value: formatAed(f.depositFils) },
          { label: "Move in", value: longDate(f.moveInOn) },
          { label: "Term", value: `${longDate(f.startOn)} to ${longDate(f.endOn)}`, wide: true },
        ]}
      />
      <Rows
        label="Parties and property"
        rows={[
          { label: "Landlord", value: f.landlordNameEn },
          {
            label: "Tenant",
            value: (
              <>
                {f.tenantNameEn}
                {tenantId && <div className="font-mono text-xs text-muted">{tenantId}</div>}
              </>
            ),
          },
          {
            label: "Property",
            value: (
              <>
                Unit {f.unitNo}, {f.building}
                <div className="text-xs text-muted">
                  DLD property no. <span className="font-mono">{f.dldPropertyNo}</span>, Makani{" "}
                  <span className="font-mono">{f.makaniNo}</span>
                </div>
              </>
            ),
          },
          ...(f.rentFreeDays > 0 ? [{ label: "Rent-free days", value: f.rentFreeDays }] : []),
        ]}
      />
      {hasAddendum && (
        <Section title="Addendum">
          <ul className="m-0 grid list-none gap-2.5 p-0 text-[15px] leading-snug">
            {v.contract.addendum.clauses.map((c) => {
              const clause = CONTRACT_CLAUSES[c as ContractClauseId];
              return clause ? (
                <li key={c}>
                  <b>{clause.title}.</b> {clause.text}
                </li>
              ) : null;
            })}
          </ul>
          {companyClauses.length > 0 && (
            <>
              <h3 className="m-0 text-sm font-semibold">Additional terms (company)</h3>
              <ul className="m-0 grid list-none gap-2.5 p-0 text-[15px] leading-snug">
                {companyClauses.map((c) => (
                  <li key={c.id}>
                    <b>{c.title}.</b> {c.text}
                  </li>
                ))}
              </ul>
            </>
          )}
          {v.contract.addendum.freeText && (
            <blockquote className="m-0 border-l-2 border-line pl-3 text-[15px] text-muted">
              {v.contract.addendum.freeText}
            </blockquote>
          )}
        </Section>
      )}
      <a
        className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-3 text-[15px] text-ink! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        href={`/t/${token}/contract.pdf`}
        target="_blank"
        rel="noreferrer"
      >
        <span className="flex items-center gap-2.5">
          <IconPdf size={22} aria-hidden />
          Read the full contract (PDF)
        </span>
        <IconOpen size={18} className="text-muted" aria-hidden />
      </a>
      <Note>
        Document fingerprint <span className="font-mono">{v.contract.sha256.slice(0, 16)}</span>.
        {v.demo && " Demo: this electronic signature is simulated and the contract is a demo template."}
      </Note>

      {v.signedAt ? (
        <Section tone="accent">
          <p role="status" className="m-0">
            You signed this contract on {dateTime(v.signedAt)}. We&apos;ll email you the signed copy once everyone has
            signed.
          </p>
        </Section>
      ) : v.canSign ? (
        <SignForm token={token} name={v.signerName} />
      ) : (
        <LinkGone message="This contract can't be signed from this link any more. Use the newest email from us." />
      )}
    </div>
  );
}
