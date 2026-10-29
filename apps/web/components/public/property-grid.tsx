import Link from "next/link";
import { type Chip, type GridFilters, SIZE_BANDS, aed, applyChip, isActive, toQuery } from "../../lib/grid-filters";
import { gridText } from "../../lib/grid-text";
import { type PropertyCategory, type PublicUnitSummary, factsList, typeLabel } from "../../lib/listings";
import { Cover } from "./cover";

const CATEGORIES: PropertyCategory[] = ["residential", "commercial", "retail"];
const t = gridText(false);

const href = (f: GridFilters) => {
  const q = toQuery(f);
  return q ? `/customer/properties?${q}` : "/customer/properties";
};

/** The listing grid and its filter chips. Each chip is a link that changes the URL query; the page refetches from the engine. */
export function PropertyGrid({
  options,
  units,
  loadFailed,
  filters: f,
}: {
  /** Every open listing: where the chip choices come from. */
  options: PublicUnitSummary[];
  units: PublicUnitSummary[];
  loadFailed: boolean;
  filters: GridFilters;
}) {
  const communities = [...new Set(options.map((u) => u.community))].toSorted();
  const categories = CATEGORIES.filter((c) => options.some((u) => u.category === c));
  const beds = [
    ...new Set(options.filter((u) => u.category === "residential").map((u) => Math.min(u.bedrooms ?? 0, 4))),
  ].toSorted();
  const showBeds = f.category === "residential" && beds.length > 1;
  const showSize = f.category === "commercial" || f.category === "retail";
  const homes = f.category === "residential";

  const chip = (label: string, on: boolean, c: Chip) => (
    <Link
      key={label}
      href={href(applyChip(f, c))}
      className="sp-chip"
      aria-current={on ? "true" : undefined}
      scroll={false}
    >
      {label}
    </Link>
  );

  return (
    <div className="pg pub-wrap">
      <header className="sp-head">
        <div>
          <h1 className="sp-title">{t.title}</h1>
          <p className="sp-count" role="status">
            {loadFailed ? "" : t.count(units.length, homes)}
          </p>
        </div>
        <Link href="/customer/chat" className="btn small">
          Ask in chat
        </Link>
      </header>

      {!loadFailed && options.length > 0 && (
        <nav className="sp-filters" aria-label="Filters">
          {communities.length > 1 && (
            <div className="sp-group" role="group" aria-label="Area">
              {chip(t.anyArea, f.community === null, { kind: "community", community: null })}
              {communities.map((c) => chip(c, f.community === c, { kind: "community", community: c }))}
            </div>
          )}
          {categories.length > 1 && (
            <div className="sp-group" role="group" aria-label="Type">
              {categories.map((c) => chip(t.category[c], f.category === c, { kind: "category", category: c }))}
            </div>
          )}
          {showBeds && (
            <div className="sp-group" role="group" aria-label="Bedrooms">
              {beds.map((b) => chip(t.beds(b), f.bedrooms === b, { kind: "bedrooms", bedrooms: b }))}
            </div>
          )}
          {showSize && (
            <div className="sp-group" role="group" aria-label="Size">
              {SIZE_BANDS.map((b) => chip(t.sizes[b.key], f.sizeBand === b.key, { kind: "size", size: b.key }))}
            </div>
          )}
          {isActive(f) && (
            <div className="sp-group" role="group" aria-label="Budget and reset">
              {f.maxRentFils !== null && (
                <>
                  <span className="sp-budget">{t.upTo(aed(f.maxRentFils))}</span>
                  <Link href={href(applyChip(f, { kind: "budget-clear" }))} className="btn small" scroll={false}>
                    {t.removeBudget}
                  </Link>
                </>
              )}
              <Link href="/customer/properties" className="sp-chip sp-chip-quiet" scroll={false}>
                {t.startOver}
              </Link>
            </div>
          )}
        </nav>
      )}

      <div className="sp-body">
        {loadFailed ? (
          <p className="pub-empty" role="alert">
            We couldn&apos;t load the properties just now. Refresh the page in a moment.
          </p>
        ) : options.length === 0 ? (
          <p className="pub-empty">
            No properties are open for viewing right now. <Link href="/customer/chat">Chat with us</Link> and we&apos;ll
            tell you when one is.
          </p>
        ) : units.length === 0 ? (
          <div className="pub-empty">
            <p>{t.nothing}</p>
            <Link href="/customer/properties" className="btn small">
              {t.startOver}
            </Link>
          </div>
        ) : (
          <ul className="sp-list" role="list">
            {units.map((u) => (
              <li key={u.id}>
                <Card unit={u} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Card({ unit: u }: { unit: PublicUnitSummary }) {
  const type = typeLabel(u);
  return (
    <article className="sp-card">
      <Link href={`/customer/properties/${u.id}`} className="sp-card-ask">
        <span className="sp-card-frame">
          <Cover building={u.building} photo={u.photoUrls[0]} className="pub-card-img" alt="" />
        </span>
        <span className="sp-card-text">
          <b>{u.building}</b>
          <span className="muted">
            {u.community}
            {type ? ` · ${type}` : ""}
          </span>
          <span>{factsList(u).join(" · ")}</span>
          <span className="sp-card-rent">{u.rent}</span>
        </span>
      </Link>
      <Link href={`/customer/chat?unit=${u.id}`} className="sp-card-more">
        Ask about this in chat
        <span className="sr-only">: {u.building}</span>
      </Link>
    </article>
  );
}
