import { buttonClass } from "@platform/ui/button";
import { Breadcrumbs, TableFrame } from "@platform/ui/page";
import { RecordStepper } from "@platform/ui/stepper";
import { Pill } from "@platform/ui/pill";
import { Fact, FactGrid, ROW_CARD, Section, Sub } from "@platform/ui/record";
import { TABLE, TD, TH } from "@platform/ui/settings";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { UnitRecord } from "../lib/contracts";
import { formatMoneyFils, shortDate } from "../lib/format";
import { bedsLabel, fieldWords, floorLabel, sqft, typeLabel, UNIT_STATE_LABEL } from "../lib/words";
import { MediaGallery } from "./inventory-photos";

const STAGES = Object.values(UNIT_STATE_LABEL);
const CARD = "grid gap-2 rounded-2xl border border-line bg-page p-5";
const CARD_TITLE = "m-0 font-sans text-[15px] font-semibold tracking-tight text-ink";
const NOT_SET = <span className="text-muted">Not set</span>;

/**
 * The unit record (S75), laid out like leasing's unit page: breadcrumbs, the gallery, the unit's name and status, then its
 * sections (Overview, Price, Deals, Activity) beside a card with the price in use. An admin gets Edit unit.
 */
export function UnitView({
  unit: u,
  canWork,
  admin,
  canStartDeal = false,
}: {
  unit: UnitRecord;
  canWork: boolean;
  admin: boolean;
  /** M6: a sales role may start a deal on an available unit. */
  canStartDeal?: boolean;
}) {
  const dealLink = (d: { id: string; ref: string }) =>
    canWork ? (
      <Link href={`/work/deals/${d.id}`} className="font-mono font-semibold text-ink! underline tabular-nums">
        {d.ref}
      </Link>
    ) : (
      <span className="font-mono tabular-nums">{d.ref}</span>
    );

  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-6 @container">
      <Breadcrumbs trail={{ href: "/inventory", label: "Inventory" }} current={u.code} />

      <div className="grid items-start gap-x-[26px] gap-y-6 @[880px]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-6">
          <MediaGallery title={`Unit ${u.code}`} name={u.code} photos={u.media} plan={{ bedrooms: u.bedrooms }} />

          <header className="grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="m-0 font-sans text-[26px] font-semibold leading-tight tracking-tight text-ink">
                    {u.code}
                  </h1>
                  <Pill tone={u.state === "AVAILABLE" ? "neutral" : u.state === "HELD" ? "waiting" : "accent"}>
                    {UNIT_STATE_LABEL[u.state]}
                  </Pill>
                </div>
                <p className="m-0 mt-1 text-sm text-muted">
                  {[u.project?.name, u.building?.name, floorLabel(u.floor)].filter(Boolean).join(", ") ||
                    "Not in a project yet"}
                </p>
              </div>
              {canStartDeal && u.state === "AVAILABLE" && (
                <Link href={`/deals/new?unit=${u.id}`} className={buttonClass("primary", "sm")}>
                  Start deal
                </Link>
              )}
              {admin && (
                <Link href={`/inventory/units/${u.id}/edit`} className={buttonClass("ghost", "sm")}>
                  <PencilSimpleIcon size={15} aria-hidden />
                  Edit unit
                </Link>
              )}
            </div>
            <div aria-label={`Unit stage: ${UNIT_STATE_LABEL[u.state]}`} role="group">
              <RecordStepper stages={STAGES} current={UNIT_STATE_LABEL[u.state]} />
            </div>
          </header>

          <Section id="overview-h" title="Overview">
            <FactGrid>
              <Fact label="Type">{typeLabel(u.type) || NOT_SET}</Fact>
              <Fact label="Layout">
                {u.bedrooms === null ? (
                  NOT_SET
                ) : (
                  <>
                    {bedsLabel(u.bedrooms)}
                    {u.bathrooms !== null ? `, ${u.bathrooms} bath` : ""}
                  </>
                )}
              </Fact>
              <Fact label="Internal area">{sqft(u.internalSqft) || NOT_SET}</Fact>
              <Fact label="Balcony">{u.balconySqft === null ? NOT_SET : sqft(u.balconySqft) || "None"}</Fact>
              <Fact label="Floor">{floorLabel(u.floor).replace(/^Floor /, "") || NOT_SET}</Fact>
              <Fact label="View">{u.view ?? NOT_SET}</Fact>
              <Fact label="Parking">{u.parkingSpaces === null ? NOT_SET : u.parkingSpaces}</Fact>
              <Fact label="Community">{u.project?.community ?? NOT_SET}</Fact>
            </FactGrid>
            {u.description && (
              <p className="m-0 max-w-[68ch] whitespace-pre-line text-sm leading-relaxed text-ink">{u.description}</p>
            )}
          </Section>

          <Section id="price-h" title="Price" hint="The price in use is the latest published price list's.">
            {u.priceHistory.length === 0 ? (
              <p className="m-0 text-sm text-muted">No price list has been published with this unit yet.</p>
            ) : (
              <TableFrame>
                <table className={TABLE}>
                  <caption className="sr-only">Price history by version, oldest first</caption>
                  <thead>
                    <tr>
                      {["Version", "Published", "Price"].map((c) => (
                        <th key={c} scope="col" className={TH}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {u.priceHistory.map((h) => (
                      <tr key={h.version} className="group">
                        <td className={`${TD} whitespace-nowrap font-semibold`}>Version {h.version}</td>
                        <td className={`${TD} whitespace-nowrap`}>{shortDate(h.publishedAt)}</td>
                        <td className={`${TD} whitespace-nowrap tabular-nums`}>{formatMoneyFils(h.priceFils)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            )}
          </Section>

          <Section id="deals-h" title="Deals">
            {!u.openDeal && u.pastDeals.length === 0 ? (
              <p className="m-0 text-sm text-muted">No deals on this unit yet.</p>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {u.openDeal && (
                  <li className={`${ROW_CARD} flex items-center justify-between gap-3 text-sm`}>
                    <span>{dealLink(u.openDeal)}</span>
                    <Pill tone="waiting">{u.openDeal.stageLabel || "In progress"}</Pill>
                  </li>
                )}
                {u.pastDeals.map((d) => (
                  <li key={d.id} className={`${ROW_CARD} flex items-center justify-between gap-3 text-sm`}>
                    <span>{dealLink(d)}</span>
                    <Pill tone="neutral">Closed</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="activity-h" title="Activity" hint="Changes to this unit's details and photos">
            {u.activity.length === 0 ? (
              <p className="m-0 text-sm text-muted">Nothing has changed yet.</p>
            ) : (
              <ul className="m-0 grid list-none gap-2.5 p-0">
                {u.activity.map((e) => (
                  <li key={e.id} className="grid grid-cols-[8.5rem_1fr] gap-3 text-sm">
                    <time dateTime={e.at} className="font-mono text-xs leading-5 text-muted">
                      {shortDate(e.at)}
                    </time>
                    <span>
                      <b className="font-semibold">{e.label}</b>
                      {e.changed.length > 0 && <span className="text-muted">: {fieldWords(e.changed)}</span>}
                      <span className="text-muted">, {e.actor}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <aside className="grid min-w-0 gap-4 @[880px]:sticky @[880px]:top-6">
          <section className={CARD} aria-labelledby="price-card-h">
            <h2 id="price-card-h" className={CARD_TITLE}>
              Price in use
            </h2>
            <div className="font-sans text-[26px] font-semibold leading-tight tracking-tight text-ink">
              {u.currentPriceFils === null ? "No price" : formatMoneyFils(u.currentPriceFils)}
            </div>
            <p className="m-0 text-[13px] text-muted">
              {u.currentPriceFils === null
                ? "A deal starts at the price list's price once one is published for this unit."
                : `From version ${u.priceHistory.at(-1)?.version ?? 1} of the price list. A deal starts here.`}
            </p>
            {u.openDeal && (
              <p className="m-0 text-sm text-ink">Deal {dealLink(u.openDeal)} is in progress on this unit.</p>
            )}
          </section>
          {u.project && (
            <section className={CARD} aria-labelledby="project-card-h">
              <h2 id="project-card-h" className={CARD_TITLE}>
                Project
              </h2>
              <p className="m-0 text-sm">
                <Link className="font-semibold text-ink! underline" href={`/inventory/projects/${u.project.id}`}>
                  {u.project.name}
                </Link>
              </p>
              {u.building && <Sub>{u.building.name}</Sub>}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
