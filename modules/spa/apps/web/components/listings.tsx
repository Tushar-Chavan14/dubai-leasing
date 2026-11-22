import { EmptyState } from "@platform/ui/empty-state";
import { ROW_LINK, TableFrame } from "@platform/ui/page";
import { Pill } from "@platform/ui/pill";
import { Fact, FactGrid, Section, Sub } from "@platform/ui/record";
import { TABLE, TD, TH } from "@platform/ui/settings";
import type { SpaRole } from "@spa/core";
import Link from "next/link";
import type { ListingRecord, ListingRowView, PermitView } from "../lib/contracts";
import { permitText } from "../lib/catalogue";
import { formatMoneyFils, shareLabel, shortDate } from "../lib/format";

const COLUMNS = ["Ref", "Property", "Seller", "Asking", "State", "Permit", "Page", "Offer"];

const PERMIT_TONE = { expiring: "warning", expired: "danger", valid: "neutral", none: "neutral" } as const;
const PAGE_TONE = { live: "accent", hidden: "warning", off: "neutral" } as const;
const OFFER_WORDS: Record<string, string> = {
  SENT: "waiting",
  ACCEPTED: "accent",
  REJECTED: "neutral",
  EXPIRED: "neutral",
};

function Permit({ p }: { p: PermitView }) {
  const date = p.expiresOn ? shortDate(p.expiresOn) : "";
  const words = permitText(p, date);
  if (p.status === "valid") return <span className="whitespace-nowrap">{words}</span>;
  if (p.status === "none") return <span className="text-muted">{words}</span>;
  return (
    <>
      <Pill tone={PERMIT_TONE[p.status]}>{words}</Pill>
      <Sub>{p.status === "expired" ? `Ended ${date}` : `Valid to ${date}`}</Sub>
    </>
  );
}

/** The Listings table (design §4.7). No owner name and no document number: the engine doesn't send them. */
export function ListingTable({ listings, next }: { listings: ListingRowView[]; next: { href: string } | null }) {
  if (!listings.length)
    return (
      <EmptyState
        title="No listings."
        body="A listing appears here with its permit and offer once a sales officer adds it. Try the other tab if you expected one."
      />
    );
  return (
    <div className="grid gap-3">
      <TableFrame>
        <table className={TABLE}>
          <caption className="sr-only">Listings</caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c} scope="col" className={TH}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => (
              <tr key={l.id} className="group">
                <td className={TD}>
                  <Link href={`/listings/${l.id}`} className={`${ROW_LINK} font-mono tabular-nums`}>
                    {l.ref}
                  </Link>
                </td>
                <td className={`${TD} min-w-[200px]`}>
                  {l.title}
                  {l.community && <Sub>{l.community}</Sub>}
                </td>
                <td className={`${TD} whitespace-nowrap`}>{l.sellerKind}</td>
                <td className={`${TD} whitespace-nowrap tabular-nums`}>
                  {l.askingPriceFils === null ? (
                    <span className="text-muted">Not set</span>
                  ) : (
                    formatMoneyFils(l.askingPriceFils)
                  )}
                </td>
                <td className={TD}>
                  <Pill tone={l.state === "PUBLISHED" ? "accent" : "neutral"}>{l.stateLabel}</Pill>
                </td>
                <td className={TD}>
                  <Permit p={l.permit} />
                </td>
                <td className={TD}>
                  <Pill tone={PAGE_TONE[l.page.state]}>{l.page.label}</Pill>
                </td>
                <td className={TD}>
                  {l.offer ? (
                    <>
                      <Pill
                        tone={
                          OFFER_WORDS[l.offer.state] === "waiting"
                            ? "waiting"
                            : OFFER_WORDS[l.offer.state] === "accent"
                              ? "accent"
                              : "neutral"
                        }
                      >
                        {l.offer.label}
                      </Pill>
                      <Sub>until {shortDate(l.offer.validUntil)}</Sub>
                    </>
                  ) : (
                    <span className="text-muted">No offer</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      {next && (
        <Link href={next.href} className="w-fit text-[13px] text-ink underline underline-offset-2">
          Next page
        </Link>
      )}
    </div>
  );
}

const OWNERSHIP_WORDS = { title_deed: "Title deed", oqood: "Oqood certificate" } as const;

/**
 * One listing (design §4.5, as far as the engine reads it): header facts, sellers (sales roles only), the ownership
 * document's result, the permit, the public page and the offer. Read only: nothing here changes a listing.
 */
export function ListingView({ listing: l, viewer: _viewer }: { listing: ListingRecord; viewer: SpaRole }) {
  return (
    <div className="grid gap-8">
      <Section id="facts" title="Listing">
        <FactGrid>
          <Fact label="State">{l.stateLabel}</Fact>
          <Fact label="Asking price">
            {l.askingPriceFils === null ? "Not set" : formatMoneyFils(l.askingPriceFils)}
          </Fact>
          <Fact label="Seller">{l.sellerKind}</Fact>
          <Fact label="Agent">{l.agent ?? "Not set"}</Fact>
          {l.bedrooms !== null && <Fact label="Bedrooms">{l.bedrooms}</Fact>}
          {l.sizeSqft !== null && <Fact label="Size">{l.sizeSqft.toLocaleString("en-US")} sq ft</Fact>}
        </FactGrid>
        {l.description && <p className="m-0 max-w-[70ch] text-sm text-muted">{l.description}</p>}
      </Section>

      <Section id="sellers" title="Sellers" hint="Every co-owner signs the listing agreement">
        {l.sellers ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {l.sellers.map((s) => (
              <li key={`${s.name}-${s.kind}`} className="m-0 rounded-xl border border-line bg-page px-3.5 py-2.5">
                <b className="block font-semibold">{s.name}</b>
                <Sub>
                  {[
                    s.kind === "company" ? "Company" : "Individual",
                    shareLabel(s.shareBps),
                    s.signed ? "Signed" : "Not signed yet",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Sub>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-muted">Sellers are shown to sales roles.</p>
        )}
      </Section>

      <Section id="ownership" title="Ownership document">
        {l.ownership ? (
          <p className="m-0 text-sm">
            {OWNERSHIP_WORDS[l.ownership.kind]} ·{" "}
            {l.ownership.matched ? "Matched to the sellers" : "Not matched to the sellers yet: a sales manager decides"}
          </p>
        ) : (
          <p className="m-0 text-sm text-muted">No ownership document recorded yet.</p>
        )}
      </Section>

      <Section id="permit" title="Advertising permit">
        <FactGrid>
          <Fact label="Permit number" mono>
            {l.permit.no ?? "None"}
          </Fact>
          <Fact label="Valid to">{l.permit.expiresOn ? shortDate(l.permit.expiresOn) : "No permit"}</Fact>
          <Fact label="Status">
            <Permit p={l.permit} />
          </Fact>
        </FactGrid>
      </Section>

      <Section id="page" title="Public page">
        <Pill tone={PAGE_TONE[l.page.state]}>{l.page.label}</Pill>
      </Section>

      <Section id="offer" title="Offer">
        {l.offer ? (
          <FactGrid>
            <Fact label="State">{l.offer.label}</Fact>
            <Fact label="Offer price">{formatMoneyFils(l.offer.priceFils)}</Fact>
            <Fact label="Sellers answer until">{shortDate(l.offer.validUntil)}</Fact>
          </FactGrid>
        ) : (
          <p className="m-0 text-sm text-muted">No offer yet.</p>
        )}
      </Section>
    </div>
  );
}
