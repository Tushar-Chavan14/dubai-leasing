import type { ReactNode } from "react";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { buttonClass } from "@platform/ui/button";
import { EmptyState } from "@platform/ui/empty-state";
import { Breadcrumbs, ROW_LINK, TableFrame } from "@platform/ui/page";
import { Pill } from "@platform/ui/pill";
import { Fact, FactGrid, ROW_CARD, Section, Sub } from "@platform/ui/record";
import { RecordStepper } from "@platform/ui/stepper";
import { TABLE, TD, TH } from "@platform/ui/settings";
import type { SpaRole } from "@spa/core";
import Link from "next/link";
import type { ListingRecord, ListingRowView, OffersView, PermitView } from "../lib/contracts";
import { ListingOffers } from "./listing-offers";
import { canWriteListings } from "../lib/listing-roles";
import { permitText } from "../lib/catalogue";
import { formatMoneyFils, shareLabel, shortDate } from "../lib/format";
import {
  bedsLabel,
  floorLabel,
  FURNISHED_LABEL,
  LISTING_STAGES,
  LISTING_STATE_LABEL,
  sqft,
  typeLabel,
} from "../lib/words";
import { MediaGallery } from "./inventory-photos";
import { ListingDocuments } from "./listing-documents";
import { ListingNextStep } from "./listing-next-step";
import { fieldWords } from "../lib/words";

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

const CARD = "grid gap-2 rounded-2xl border border-line bg-page p-5";
const CARD_TITLE = "m-0 font-sans text-[15px] font-semibold tracking-tight text-ink";
const NOT_SET = <span className="text-muted">Not set</span>;
const STATE_TONE = { PUBLISHED: "accent", UNDER_OFFER: "waiting", WITHDRAWN: "danger" } as const;
const OFFER_TONE = { SENT: "waiting", ACCEPTED: "accent" } as const;

/**
 * The listing record (S77), laid out like leasing's unit page: breadcrumbs, the gallery, the title with its state and the
 * stage stepper, then the cards (Next step, Overview, Documents, Sellers, Photos, Offers and deals, Activity) beside a side
 * column with the price and the permit. Sales roles act here; any other role reads without a button, a seller or a file.
 */
export function ListingView({
  listing: l,
  viewer,
  offers = null,
  handoff = null,
}: {
  listing: ListingRecord;
  /** M6: the listing's offers and policy terms from the engine; without them the section shows the latest offer only. */
  offers?: OffersView | null;
  viewer: SpaRole;
  /** Demo mode only (S80): the hand-off line the page drew (a server component, so this file stays client-safe). */
  handoff?: ReactNode;
}) {
  const canWrite = canWriteListings(viewer);
  const withdrawn = l.state === "WITHDRAWN";
  const stateLabel = LISTING_STATE_LABEL[l.state as keyof typeof LISTING_STATE_LABEL] ?? l.stateLabel;
  const editable = canWrite && ["DRAFT", "VERIFIED", "ACTIVE", "PUBLISHED"].includes(l.state);
  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-6 @container">
      <Breadcrumbs trail={{ href: "/listings", label: "Listings" }} current={l.ref} />

      <div className="grid items-start gap-x-[26px] gap-y-6 @[880px]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-6">
          <MediaGallery title={l.title} name={l.title} photos={l.media} plan={{ bedrooms: l.bedrooms }} />

          <header className="grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="m-0 font-sans text-[26px] font-semibold leading-tight tracking-tight text-ink">
                    {l.title}
                  </h1>
                  <Pill tone={STATE_TONE[l.state as keyof typeof STATE_TONE] ?? "neutral"}>{stateLabel}</Pill>
                </div>
                <p className="m-0 mt-1 text-sm text-muted">{[l.ref, l.community].filter(Boolean).join(" · ")}</p>
              </div>
              {editable && (
                <Link href={`/listings/${l.id}/edit`} className={buttonClass("ghost", "sm")}>
                  <PencilSimpleIcon size={15} aria-hidden />
                  Edit listing
                </Link>
              )}
            </div>
            {!withdrawn && (
              <div aria-label={`Listing stage: ${stateLabel}`} role="group">
                <RecordStepper stages={LISTING_STAGES.map((k) => LISTING_STATE_LABEL[k])} current={stateLabel} />
              </div>
            )}
          </header>

          <div className="record-cards grid gap-4">
            <ListingNextStep
              listing={l}
              handoff={l.ownership && !l.ownership.matched && l.ownership.waitingForManager ? handoff : null}
            />

            <Section id="overview-h" title="Overview">
              <FactGrid>
                <Fact label="Asking price">
                  {l.askingPriceFils === null ? NOT_SET : formatMoneyFils(l.askingPriceFils)}
                </Fact>
                <Fact label="Community">{l.community ?? NOT_SET}</Fact>
                <Fact label="Type">{typeLabel(l.unitType) || NOT_SET}</Fact>
                <Fact label="Layout">
                  {l.bedrooms === null ? (
                    NOT_SET
                  ) : (
                    <>
                      {bedsLabel(l.bedrooms)}
                      {l.bathrooms !== null ? `, ${l.bathrooms} bath` : ""}
                    </>
                  )}
                </Fact>
                <Fact label="Size">{sqft(l.sizeSqft) || NOT_SET}</Fact>
                <Fact label="Floor">{floorLabel(l.floor).replace(/^Floor /, "") || NOT_SET}</Fact>
                <Fact label="View">{l.view ?? NOT_SET}</Fact>
                <Fact label="Parking">{l.parkingSpaces === null ? NOT_SET : l.parkingSpaces}</Fact>
                <Fact label="Furnishing">{l.furnished ? FURNISHED_LABEL[l.furnished] : NOT_SET}</Fact>
                <Fact label="Agent">{l.agent ?? NOT_SET}</Fact>
                <Fact label="Permit number" mono>
                  {l.permit.no ?? "None"}
                </Fact>
                <Fact label="Permit last valid day">
                  {l.permit.expiresOn ? shortDate(l.permit.expiresOn) : "No permit"}
                </Fact>
                <Fact label="Permit status">
                  <Permit p={l.permit} />
                </Fact>
              </FactGrid>
              {l.description && (
                <p className="m-0 max-w-[68ch] whitespace-pre-line text-sm leading-relaxed text-ink">{l.description}</p>
              )}
            </Section>

            <ListingDocuments listing={l} canWrite={canWrite} />

            <Section id="sellers" title="Sellers" hint="Every co-owner signs the listing agreement">
              {l.sellers ? (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {l.sellers.map((s) => (
                    <li key={s.partyId || `${s.name}-${s.kind}`} className={ROW_CARD}>
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

            <Section id="photos-h" title="Photos" hint="The first photo is the cover">
              <p className="m-0 text-sm text-muted">
                {l.media.length === 0
                  ? "No photos yet."
                  : l.media.length === 1
                    ? "1 photo, shown in the gallery above."
                    : `${l.media.length} photos, shown in the gallery above.`}
                {editable && (
                  <>
                    {" "}
                    <Link href={`/listings/${l.id}/edit#photos`} className="font-semibold text-ink! underline">
                      {l.media.length ? "Change the photos" : "Add photos"}
                    </Link>
                  </>
                )}
              </p>
            </Section>

            {offers ? (
              <ListingOffers listingId={l.id} state={l.state} offers={offers} canWrite={canWrite} />
            ) : (
              <Section id="offers-h" title="Offers and deals">
                {l.offer ? (
                  <FactGrid>
                    <Fact label="Offer">
                      <Pill tone={OFFER_TONE[l.offer.state as keyof typeof OFFER_TONE] ?? "neutral"}>
                        {l.offer.label}
                      </Pill>
                    </Fact>
                    <Fact label="Offer price">{formatMoneyFils(l.offer.priceFils)}</Fact>
                    <Fact label="Sellers answer until">{shortDate(l.offer.validUntil)}</Fact>
                  </FactGrid>
                ) : (
                  <p className="m-0 text-sm text-muted">No offer yet.</p>
                )}
                {l.openDeal && (
                  <p className="m-0 text-sm">
                    Deal{" "}
                    <Link
                      href={`/work/deals/${l.openDeal.id}`}
                      className="font-mono font-semibold text-ink! underline tabular-nums"
                    >
                      {l.openDeal.ref}
                    </Link>
                    {l.openDeal.stageLabel ? <span className="text-muted"> · {l.openDeal.stageLabel}</span> : null}
                  </p>
                )}
              </Section>
            )}

            <Section id="activity-h" title="Activity" hint="Changes to this listing, newest first">
              {l.activity.length === 0 ? (
                <p className="m-0 text-sm text-muted">Nothing has changed yet.</p>
              ) : (
                <ul className="m-0 grid list-none gap-2.5 p-0">
                  {l.activity.map((e) => (
                    <li key={e.id} className="grid grid-cols-[8.5rem_1fr] gap-3 text-sm">
                      <time dateTime={e.at} className="font-mono text-xs leading-5 text-muted">
                        {shortDate(e.at)}
                      </time>
                      <span>
                        <b className="font-semibold">{e.label}</b>
                        {e.changed.length > 0 && <span className="text-muted">: {fieldWords(e.changed)}</span>}
                        {e.note && <span className="text-muted">: {e.note}</span>}
                        <span className="text-muted">, {e.actor}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>

        <aside className="grid min-w-0 gap-4 @[880px]:sticky @[880px]:top-6">
          <section className={CARD} aria-labelledby="price-card-h">
            <h2 id="price-card-h" className={CARD_TITLE}>
              Asking price
            </h2>
            <div className="font-sans text-[26px] font-semibold leading-tight tracking-tight text-ink">
              {l.askingPriceFils === null ? "No price" : formatMoneyFils(l.askingPriceFils)}
            </div>
            <p className="m-0 text-[13px] text-muted">{l.sellerKind} seller. Offers are made against this price.</p>
          </section>
          <section className={CARD} aria-labelledby="page-card-h">
            <h2 id="page-card-h" className={CARD_TITLE}>
              Public page
            </h2>
            <div>
              <Pill tone={PAGE_TONE[l.page.state]}>{l.page.label}</Pill>
            </div>
            <Permit p={l.permit} />
          </section>
        </aside>
      </div>
    </div>
  );
}
