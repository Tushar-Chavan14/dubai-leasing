import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHead, PlanPlaceholder, Status } from "../../../components/ui";
import { get } from "../../../lib/engine";
import { aedShort, bedroomsLabel, stateLabel } from "../../../lib/format";
import { IconArea, IconBed, IconBuilding, IconImage, IconPlus, IconUpload } from "../../../lib/icons";
import { CATEGORIES } from "../../../lib/portfolio";
import type { CompanyRow, Me, UnitRow } from "../../../lib/types";

export const metadata: Metadata = { title: "Units" };

const STATES = ["all", "PREP", "READY", "LISTED", "OCCUPIED"] as const;
const EDITORS = ["admin", "leasing_manager", "leasing_officer"];
const IMPORTERS = ["admin", "leasing_manager"];

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; company?: string; category?: string }>;
}) {
  const { state: raw, company: companyRaw, category: categoryRaw } = await searchParams;
  const state = STATES.find((s) => s === raw) ?? "all";
  const [units, me, companies] = await Promise.all([
    get<UnitRow[]>("/api/units"),
    get<Me>("/api/me"),
    get<CompanyRow[]>("/api/companies"),
  ]);
  const companyId = (companies ?? []).find((c) => c.id === companyRaw)?.id ?? "";
  const category = CATEGORIES.find((c) => c.value === categoryRaw)?.value ?? "";
  const scoped = (units ?? []).filter(
    (u) => (!companyId || u.companyId === companyId) && (!category || u.category === category),
  );
  const all = scoped;
  const rows = state === "all" ? all : all.filter((u) => u.state === state);
  const href = (st: string) => {
    const q = new URLSearchParams();
    if (st !== "all") q.set("state", st);
    if (companyId) q.set("company", companyId);
    if (category) q.set("category", category);
    return q.size ? `/units?${q}` : "/units";
  };
  const canEdit = !!me && EDITORS.includes(me.role);
  const canImport = !!me && IMPORTERS.includes(me.role);

  return (
    <>
      <PageHead
        title="Units"
        lede="Every unit in the portfolio, from preparation to occupied. A unit can be listed once its checklist is complete and its price is settled."
        actions={
          canEdit ? (
            <>
              {canImport && (
                <Link href="/settings/import?kind=units" className="btn">
                  <IconUpload size={16} />
                  Import units
                </Link>
              )}
              <Link href="/units/new" className="btn primary">
                <IconPlus size={16} />
                Add unit
              </Link>
            </>
          ) : undefined
        }
      />
      <form method="get" className="btn-row" style={{ alignItems: "end", marginBottom: 16 }}>
        {state !== "all" && <input type="hidden" name="state" value={state} />}
        <label className="field">
          <span className="field-label">Company</span>
          <select name="company" defaultValue={companyId}>
            <option value="">All companies</option>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Category</span>
          <select name="category" defaultValue={category}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn">
          Apply
        </button>
      </form>
      <nav className="tabs" aria-label="Filter units">
        {STATES.map((s) => (
          <Link key={s} href={href(s)} aria-current={s === state ? "page" : undefined}>
            {s === "all" ? "All" : stateLabel(s)}
            <span className="n">{s === "all" ? all.length : all.filter((u) => u.state === s).length}</span>
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <section className="panel">
          <Empty
            icon={<IconBuilding />}
            title={all.length ? "No units in this state" : "No units yet"}
            action={
              canEdit && !all.length ? (
                <Link href="/units/new" className="btn primary">
                  Add the first unit
                </Link>
              ) : undefined
            }
          >
            {all.length ? undefined : "Add a unit with its DLD, Makani and DEWA numbers, photos and asking rent."}
          </Empty>
        </section>
      ) : (
        <ul className="unit-grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((u) => (
            <li key={u.id}>
              <Link href={`/units/${u.id}`} className="unit-card">
                <div className="media">
                  <Status value={u.state} />
                  {u.coverPhotoId ? (
                    <img src={`/media/units/${u.id}/${u.coverPhotoId}`} alt={`Unit ${u.code}`} loading="lazy" />
                  ) : (
                    <PlanPlaceholder bedrooms={u.bedrooms} label="No photos yet" />
                  )}
                  {u.photoCount > 1 && (
                    <span className="count">
                      <IconImage size={13} />
                      {u.photoCount}
                    </span>
                  )}
                </div>
                <div className="body">
                  <div className="code">
                    <b>{u.code}</b>
                    <span className="rent">
                      {u.lease ? (
                        <>
                          {aedShort(u.lease.annualRentFils)} <small>/ yr, let</small>
                        </>
                      ) : u.askingRentFils ? (
                        <>
                          {aedShort(u.askingRentFils)} <small>/ yr</small>
                        </>
                      ) : (
                        <small>No price yet</small>
                      )}
                    </span>
                  </div>
                  <span className="where">
                    {u.building}, {u.community}
                  </span>
                  <span className="specs">
                    <span>
                      <IconBed size={15} />
                      {bedroomsLabel(u.bedrooms)}
                    </span>
                    {u.areaSqft && (
                      <span>
                        <IconArea size={15} />
                        {u.areaSqft.toLocaleString("en-US")} sq ft
                      </span>
                    )}
                    {u.furnished !== null && <span>{u.furnished ? "Furnished" : "Unfurnished"}</span>}
                  </span>
                  {u.lease && (
                    <span className="tenant">
                      Lease <span className="ref">{u.lease.ref}</span>, {stateLabel(u.lease.state).toLowerCase()}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
