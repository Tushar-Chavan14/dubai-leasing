import { Pill } from "@platform/ui/pill";
import { EmptyState } from "@platform/ui/empty-state";
import { TableFrame } from "@platform/ui/page";
import { Fact, FactGrid, ROW_CARD, Section, Sub } from "@platform/ui/record";
import { TABLE, TD, TH } from "@platform/ui/settings";
import Link from "next/link";
import type {
  AgreementSection,
  AmlSection,
  DocumentItem,
  FinanceSection,
  NocSection,
  RegistrationSection,
  SettlementSection,
  SigningSection,
} from "../lib/contracts";
import { shortDate } from "../lib/format";
import { Amount } from "./amount";

/**
 * The record's evidence sections (C39, S71): documents, the compliance review (compliance roles), agreement, signing,
 * NOC, banks, settlement and registration. The engine decides which of them this role gets and whether the deal has
 * reached the step; each one draws only what it was sent. Read only: no file is opened and nothing is changed here.
 */

const words = (s: string): string => {
  const t = s.replaceAll("_", " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const AGREEMENT_KIND: Record<string, string> = { spa: "SPA", mou: "MOU", assignment: "Assignment" };
const REGISTRY_KIND: Record<string, string> = {
  oqood_register: "Oqood registration",
  oqood_transfer: "Oqood transfer",
  trustee_transfer: "Trustee transfer",
};

export function Documents({ items }: { items: DocumentItem[] }) {
  if (!items.length) return null;
  return (
    <Section
      id="documents"
      title="Documents"
      hint="What came in. Files are not opened here, and what a reader copied is never a fact until a person confirms it"
    >
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2 p-0">
        {items.map((d, i) => (
          <li key={`${d.kind}-${i}`} className={`${ROW_CARD} m-0 grid gap-1`}>
            <b className="font-semibold">{words(d.kind)}</b>
            <Sub>
              {d.partyName ? `${d.partyName} · ` : ""}Uploaded {shortDate(d.uploadedOn)}
            </Sub>
            <span className="flex flex-wrap items-center gap-1.5">
              <Pill tone={d.readState === "read" ? "accent" : "neutral"}>
                {d.readState === "read" ? "Read" : "Not read yet"}
              </Pill>
              {d.readState === "read" && !d.confirmed && <Pill tone="warning">Read, not confirmed</Pill>}
              {d.confirmed && <Pill tone="accent">Confirmed</Pill>}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const LEVEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

/** Compliance roles only: the engine sends this section to no one else. */
export function ComplianceReview({ section }: { section: AmlSection }) {
  return (
    <Section id="aml" title="Compliance review" hint="Opens the case view; decisions are made there">
      <FactGrid>
        <Fact label="Cases">{`${section.caseCount} ${section.caseCount === 1 ? "case" : "cases"}`}</Fact>
        <Fact label="Risk level">{section.riskLevel ? LEVEL[section.riskLevel] : "Not set"}</Fact>
      </FactGrid>
      {section.cases.length > 0 && (
        <ul className="m-0 grid list-none gap-2 p-0">
          {section.cases.map((c) => (
            <li key={c.id} className={`${ROW_CARD} m-0`}>
              <Link href={`/compliance/cases/${c.id}`} className="font-semibold text-ink! underline underline-offset-2">
                Open case
              </Link>
              <Sub>
                {words(c.status)} · opened {shortDate(c.openedOn)}
              </Sub>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function Agreement({ section }: { section: AgreementSection }) {
  return (
    <Section id="agreement" title="Agreement" hint="The prepared document, not its text">
      <FactGrid>
        <Fact label="Document">{AGREEMENT_KIND[section.kind] ?? words(section.kind)}</Fact>
        <Fact label="Version">{`version ${section.version}`}</Fact>
        <Fact label="Status">
          <Pill tone={section.status === "approved" ? "accent" : "neutral"}>{words(section.status)}</Pill>
        </Fact>
        <Fact label="Template">{`${section.templateName} · version ${section.templateVersion}`}</Fact>
        <Fact label="Prepared">{shortDate(section.preparedOn)}</Fact>
      </FactGrid>
    </Section>
  );
}

const SIGNER_STATE: Record<
  SigningSection["signers"][number]["state"],
  { text: string; tone: "accent" | "waiting" | "warning" }
> = {
  signed: { text: "Signed", tone: "accent" },
  waiting: { text: "Waiting", tone: "waiting" },
  link_expired: { text: "Link expired", tone: "warning" },
};

export function Signing({ section }: { section: SigningSection }) {
  return (
    <Section id="signing" title="Signing" hint="In the order they sign; links are never shown">
      <ul className="m-0 grid list-none gap-2 p-0">
        {section.signers.map((x) => (
          <li key={x.seq} className={`${ROW_CARD} m-0 grid gap-0.5`}>
            <span className="flex flex-wrap items-center gap-2">
              <b className="font-semibold">
                {x.seq}. {x.name}
              </b>
              <Pill tone={SIGNER_STATE[x.state].tone}>{SIGNER_STATE[x.state].text}</Pill>
            </span>
            <Sub>
              {words(x.role)} · link {x.state === "link_expired" ? "expired" : "expires"} {shortDate(x.linkExpiresOn)}
            </Sub>
          </li>
        ))}
        {section.completedOn && <Sub>All signed on {shortDate(section.completedOn)}.</Sub>}
      </ul>
    </Section>
  );
}

export function Noc({ section }: { section: NocSection }) {
  return (
    <Section id="noc" title="Developer NOC" hint="Dates and amounts a person confirmed">
      <FactGrid>
        <Fact label="Status">
          <Pill tone={section.status === "matched" ? "accent" : "warning"}>{words(section.status)}</Pill>
        </Fact>
        <Fact label="Issued">{shortDate(section.issuedOn)}</Fact>
        <Fact label="Expires">{shortDate(section.expiresOn)}</Fact>
        <Fact label="Service charges">{section.serviceChargesCleared ? "Cleared" : "Not cleared"}</Fact>
        {section.paidFils !== null && (
          <Fact label="Paid to the developer">
            <Amount fils={section.paidFils} confirmed={section.paidConfirmed} />
          </Fact>
        )}
      </FactGrid>
      {section.mismatches.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0">
          {section.mismatches.map((m) => (
            <li key={m} className="m-0 text-[13px] text-muted">
              {m}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function Banks({ section }: { section: FinanceSection }) {
  if (!section.bankLetters.length && !section.payments.length) return null;
  return (
    <Section id="finance" title="Banks" hint="Amounts count once a person confirms them">
      <div className="grid gap-3">
        {section.bankLetters.length > 0 && (
          <ul className="m-0 grid list-none gap-2 p-0" aria-label="Bank letters">
            {section.bankLetters.map((l) => (
              <li key={`${l.side}-${l.kind}`} className={`${ROW_CARD} m-0 grid gap-0.5`}>
                <b className="font-semibold">
                  {words(l.kind)} · {l.side === "buyer" ? "Buyer's bank" : "Seller's bank"}
                </b>
                <Sub>
                  Issued {shortDate(l.issuedOn)}
                  {l.validUntil ? ` · valid until ${shortDate(l.validUntil)}` : ""}
                </Sub>
                {l.amountFils !== null ? (
                  <Amount fils={l.amountFils} confirmed={l.confirmed} />
                ) : (
                  <Sub>No amount confirmed yet</Sub>
                )}
              </li>
            ))}
          </ul>
        )}
        {section.payments.length > 0 && (
          <ul className="m-0 grid list-none gap-2 p-0" aria-label="Payments">
            {section.payments.map((p) => (
              <li key={p.seq} className={`${ROW_CARD} m-0 grid gap-0.5`}>
                <span className="flex flex-wrap items-center gap-2">
                  <b className="font-semibold">Instalment {p.seq}</b>
                  <Pill tone={p.status === "counted" ? "accent" : p.status === "needs_review" ? "warning" : "neutral"}>
                    {words(p.status)}
                  </Pill>
                </span>
                <Sub>
                  {words(p.method)}
                  {p.paidOn ? ` · paid ${shortDate(p.paidOn)}` : ""}
                  {p.account ? ` · account ${p.account}` : ""}
                </Sub>
                {p.amountFils !== null ? (
                  <Amount fils={p.amountFils} />
                ) : p.amountReadFils !== null ? (
                  <Amount fils={p.amountReadFils} confirmed={false} />
                ) : null}
                {p.note && <Sub>{p.note}</Sub>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

export function Settlement({ section }: { section: SettlementSection }) {
  const st = section.statement;
  if (!st && !section.reasons.length) return null;
  return (
    <Section
      id="settlement"
      title="Settlement statement"
      hint="Who pays whom on transfer day. The numbers are the rulebook's"
    >
      {st ? (
        <div className="grid gap-3">
          <FactGrid>
            <Fact label="Version">{`version ${st.version}`}</Fact>
            <Fact label="Status">
              <Pill tone={st.status === "approved" ? "accent" : "waiting"}>{words(st.status)}</Pill>
            </Fact>
            <Fact label="Price">
              <Amount fils={st.priceFils} />
            </Fact>
            <Fact label="Buyer pays">
              <Amount fils={st.buyerPaysFils} />
            </Fact>
            <Fact label="Seller receives">
              <Amount fils={st.sellerReceivesFils} />
            </Fact>
            <Fact label="Balances to zero">
              {st.balancesToZero ? (
                <Pill tone="accent">Yes</Pill>
              ) : (
                <Pill tone="danger">No, off by {st.differenceFils}</Pill>
              )}
            </Fact>
          </FactGrid>
          <TableFrame>
            <table className={TABLE}>
              <caption className="sr-only">Settlement lines</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Line
                  </th>
                  <th scope="col" className={TH}>
                    From
                  </th>
                  <th scope="col" className={TH}>
                    To
                  </th>
                  <th scope="col" className={TH}>
                    Source
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {st.lines.map((l) => (
                  <tr key={l.seq} className="group">
                    <td className={TD}>{l.label}</td>
                    <td className={TD}>{words(l.payer)}</td>
                    <td className={TD}>{words(l.payee)}</td>
                    <td className={TD}>{l.source}</td>
                    <td className={`${TD} text-right`}>
                      <Amount fils={l.amountFils} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        </div>
      ) : (
        <EmptyState title="No statement yet." body={section.reasons.join(" ")} />
      )}
    </Section>
  );
}

const ATTEMPT_TONE: Record<string, "accent" | "danger" | "waiting" | "warning"> = {
  issued: "accent",
  rejected: "danger",
  submitted: "waiting",
  unavailable: "warning",
};

export function Registration({ section }: { section: RegistrationSection }) {
  if (!section.attempts.length) return null;
  return (
    <Section id="registration" title="Registration" hint="Each attempt and what the registry said">
      <ul className="m-0 grid list-none gap-2 p-0">
        {section.attempts.map((a) => (
          <li key={`${a.kind}-${a.attempt}-${a.createdOn}`} className={`${ROW_CARD} m-0 grid gap-0.5`}>
            <span className="flex flex-wrap items-center gap-2">
              <b className="font-semibold">
                {REGISTRY_KIND[a.kind] ?? words(a.kind)} · attempt {a.attempt}
              </b>
              <Pill tone={ATTEMPT_TONE[a.status] ?? "neutral"}>{words(a.status)}</Pill>
            </span>
            <Sub>
              Sent {shortDate(a.createdOn)}
              {a.registryNo ? ` · number ${a.registryNo}` : ""}
              {a.issuedOn ? ` · issued ${shortDate(a.issuedOn)}` : ""}
            </Sub>
            {a.reasons.map((r) => (
              <Sub key={`${r.code}-${r.message}`}>{r.message}</Sub>
            ))}
          </li>
        ))}
      </ul>
    </Section>
  );
}
