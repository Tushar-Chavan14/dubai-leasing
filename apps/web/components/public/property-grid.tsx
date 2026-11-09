import { ArrowUpRightIcon, CheckIcon, ChatCircleTextIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { type Chip, type GridFilters, SIZE_BANDS, aed, applyChip, isActive, toQuery } from "../../lib/grid-filters";
import { gridText } from "../../lib/grid-text";
import { type PropertyCategory, type PublicUnitSummary, factsList, rentShort, typeLabel } from "../../lib/listings";
import { buttonClass } from "../ui/button";
import { Cover } from "./cover";
import { Finder } from "./finder";
import { HeroPanel } from "./hero-panel";

const CATEGORIES: PropertyCategory[] = ["residential", "commercial", "retail"];
const t = gridText(false);

const href = (f: GridFilters) => {
  const q = toQuery(f);
  return q ? `/customer/properties?${q}` : "/customer/properties";
};

/** The listing grid and its filter chips. Each chip is a link that changes the URL query; the page refetches from the engine. */
/** Budget steps for the finder: round AED figures from the cheapest listing up, plus the one already applied. */
function budgetSteps(options: PublicUnitSummary[], current: number | null) {
  const cheapest = Math.min(...options.map((u) => u.rentFils / 100));
  const steps = [60, 80, 100, 150, 200, 300, 500].map((k) => k * 1000).filter((v) => v >= cheapest);
  const all =
    current !== null && !steps.includes(current / 100) ? [...steps, current / 100].toSorted((a, b) => a - b) : steps;
  return all.map((v) => ({ value: v, label: t.upToShort(v) }));
}

/** The listing grid, its finder and filter chips. Each chip is a link that changes the URL query; the page refetches from the engine. */
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
  const showSize = f.category === "commercial" || f.category === "retail";
  const homes = f.category === "residential";

  const chip = (label: string, on: boolean, c: Chip) => (
    <Link
      key={label}
      href={href(applyChip(f, c))}
      aria-current={on ? "true" : undefined}
      scroll={false}
      className={`inline-flex h-9 items-center gap-1 rounded-full border px-3.5 text-sm transition-colors duration-150 ease-out motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${on ? "border-transparent bg-accent font-semibold text-on-accent!" : "border-line text-ink! hover:bg-raised"}`}
    >
      {on && <CheckIcon size={12} weight="bold" aria-hidden="true" />}
      {label}
    </Link>
  );
  const heroPhoto =
    units.find((u) => u.photoUrls[0])?.photoUrls[0] ?? options.find((u) => u.photoUrls[0])?.photoUrls[0];
  const cheapest = options.length ? options.reduce((m, u) => (u.rentFils < m.rentFils ? u : m)) : undefined;

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-10 md:px-8">
      <header className="grid items-center gap-8 py-8 md:grid-cols-[1.05fr_1fr] md:gap-10 md:py-12">
        <div className="grid justify-items-start">
          <h1 className="m-0 max-w-[16ch] text-[40px] leading-[1.04] font-semibold tracking-[-0.035em] text-balance md:text-[52px]">
            {t.title}
          </h1>
          <p className="mt-4! mb-0 max-w-[46ch] text-base text-muted md:text-[17px]">
            Book a site visit, apply and sign without leaving your phone.
          </p>
          {!loadFailed && options.length > 0 && (
            <Finder
              filters={f}
              communities={communities}
              beds={beds.map((b) => ({ value: b, label: t.beds(b) }))}
              budgets={budgetSteps(options, f.maxRentFils)}
              labels={{
                area: "Area",
                anyArea: t.anyArea,
                beds: "Bedrooms",
                anyBeds: "Any",
                budget: "Budget a year",
                anyBudget: "Any",
                search: "Search",
              }}
            />
          )}
          <Link
            href="/customer/chat"
            className="mt-5! inline-flex items-center gap-1.5 text-sm font-medium text-ink! underline underline-offset-4 hover:text-muted!"
          >
            <ChatCircleTextIcon size={16} aria-hidden="true" />
            Ask in chat
          </Link>
        </div>
        <div className="hidden aspect-[4/3] max-h-[380px] overflow-hidden rounded-[22px] bg-raised md:block md:w-full">
          {heroPhoto ? (
            <Cover building="" photo={heroPhoto} alt="" />
          ) : (
            <HeroPanel count={options.length} from={cheapest?.rent} areas={communities.length} />
          )}
        </div>
      </header>

      <section id="homes" aria-label="Properties" className="scroll-mt-24">
        {!loadFailed && options.length > 0 && (
          <nav className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3" aria-label="Filters">
            <div className="flex flex-wrap items-center gap-2">
              {categories.length > 1 &&
                categories.map((c) => chip(t.category[c], f.category === c, { kind: "category", category: c }))}
              {showSize &&
                SIZE_BANDS.map((b) => chip(t.sizes[b.key], f.sizeBand === b.key, { kind: "size", size: b.key }))}
              {f.maxRentFils !== null && (
                <Link
                  href={href(applyChip(f, { kind: "budget-clear" }))}
                  scroll={false}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3.5 text-sm text-ink! hover:bg-raised"
                >
                  {t.upTo(aed(f.maxRentFils))}
                  <span className="text-muted">{t.removeBudget}</span>
                </Link>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-muted">
              <p className="m-0" role="status">
                {t.count(units.length, homes)}
              </p>
              {isActive(f) && (
                <Link
                  href="/customer/properties#homes"
                  className="text-ink! underline underline-offset-4"
                  scroll={false}
                >
                  {t.startOver}
                </Link>
              )}
            </div>
          </nav>
        )}

        {loadFailed ? (
          <p className="py-8 text-base text-muted" role="alert">
            We couldn&apos;t load the properties just now. Refresh the page in a moment.
          </p>
        ) : options.length === 0 ? (
          <p className="py-8 text-base text-muted">
            No properties are open for site visit right now.{" "}
            <Link href="/customer/chat" className="underline underline-offset-4">
              Chat with us
            </Link>{" "}
            and we&apos;ll tell you when one is.
          </p>
        ) : units.length === 0 ? (
          <div className="grid justify-items-start gap-4 rounded-card border border-line bg-raised p-6 text-base text-muted">
            <p className="m-0">{t.nothing}</p>
            <Link href="/customer/properties#homes" className={buttonClass("ghost", "sm")}>
              {t.startOver}
            </Link>
          </div>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-x-5 gap-y-9 p-0 sm:grid-cols-2 lg:grid-cols-3" role="list">
            {units.map((u) => (
              <li key={u.id}>
                <Card unit={u} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Card({ unit: u }: { unit: PublicUnitSummary }) {
  const type = typeLabel(u);
  return (
    <article className="grid gap-2.5">
      <Link
        href={`/customer/properties/${u.id}`}
        className="group grid gap-3 rounded-[18px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
      >
        <span className="block aspect-[4/3] overflow-hidden rounded-[18px] bg-raised">
          <Cover
            building={u.building}
            photo={u.photoUrls[0]}
            alt=""
            className="transition-transform duration-500 ease-out motion-reduce:transition-none group-hover:scale-[1.02] motion-reduce:group-hover:scale-100"
          />
        </span>
        <span className="flex items-start justify-between gap-4">
          <span className="grid gap-0.5">
            <b className="text-base leading-snug font-semibold tracking-tight">{u.building}</b>
            <span className="text-sm text-muted">
              {u.community}
              {type ? ` · ${type}` : ""}
            </span>
            <span className="text-sm text-muted">{factsList(u).join(" · ")}</span>
          </span>
          <span className="text-base font-semibold whitespace-nowrap tabular-nums">
            {rentShort(u.rent)}
            <span className="font-normal text-muted"> /yr</span>
          </span>
        </span>
      </Link>
      <Link
        href={`/customer/chat?unit=${u.id}`}
        className="inline-flex w-fit items-center gap-1 rounded-full text-sm text-muted! hover:text-ink! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        Ask about this in chat
        <ArrowUpRightIcon size={13} aria-hidden="true" />
        <span className="sr-only">: {u.building}</span>
      </Link>
    </article>
  );
}
