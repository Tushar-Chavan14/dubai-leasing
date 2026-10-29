import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UnitActions } from "../../../../components/unit-actions";
import { UnitGallery } from "../../../../components/unit-gallery";
import { PageHead, Status } from "../../../../components/ui";
import { get } from "../../../../lib/engine";
import { actorLabel, aedShort, bedroomsLabel, dateTime, eventLabel, longDate, shortDate } from "../../../../lib/format";
import { IconCheck, IconCircle } from "../../../../lib/icons";
import { CATEGORIES, subtypeLabel } from "../../../../lib/portfolio";
import type { Me, UnitDetail } from "../../../../lib/types";

export const metadata: Metadata = { title: "Unit" };

const CHECKLIST: { key: string; label: string; ok: (u: UnitDetail) => boolean }[] = [
  { key: "dld", label: "DLD property number", ok: (u) => !!u.dldPropertyNo },
  { key: "unit", label: "Unit number", ok: (u) => !!u.unitNo },
  { key: "makani", label: "Makani number", ok: (u) => !!u.makaniNo },
  { key: "dewa", label: "DEWA premise number", ok: (u) => !!u.dewaPremiseNo },
  { key: "area", label: "Area", ok: (u) => u.areaSqft !== null },
  { key: "beds", label: "Bedrooms", ok: (u) => u.bedrooms !== null },
  { key: "furn", label: "Furnishing", ok: (u) => u.furnished !== null },
  {
    key: "price",
    label: "Asking rent in range or approved",
    ok: (u) => !!u.askingRentFils && (u.priceInRange || !!u.priceApprovedAt),
  },
  { key: "photos", label: "At least one photo (recommended)", ok: (u) => u.photos.length > 0 },
];
const EDITORS = ["admin", "leasing_manager", "leasing_officer"];

/** A null side is no limit: "AED 95,000 to 110,000", "AED 95,000 or more", "up to AED 110,000". */
function rangeLabel({ min, max }: { min: number | null; max: number | null }): string {
  if (min !== null && max !== null) return `${aedShort(min)} to ${aedShort(max).replace("AED ", "")}`;
  if (min !== null) return `${aedShort(min)} or more`;
  if (max !== null) return `up to ${aedShort(max)}`;
  return "no limits";
}

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [u, me] = await Promise.all([get<UnitDetail>(`/api/units/${id}`), get<Me>("/api/me")]);
  if (!u) notFound();
  const canEdit = !!me && EDITORS.includes(me.role);
  const checks = CHECKLIST.map((c) => ({ ...c, done: c.ok(u) }));
  const required = checks.filter((c) => c.key !== "photos");
  const doneCount = required.filter((c) => c.done).length;
  const pendingPrice = u.approvals.find((a) => a.gate === "price_out_of_range" && a.status === "pending") ?? null;
  const needsPriceApproval = !!u.askingRentFils && !u.priceInRange && !u.priceApprovedAt && u.state === "PREP";
  const live = u.leases.find((l) => l.state !== "CLOSED");

  return (
    <>
      <PageHead
        back={{ href: "/units", label: "Units" }}
        title={u.code}
        badge={<Status value={u.state} />}
        lede={`${u.building}, ${u.community}${u.floor !== null ? `, floor ${u.floor}` : ""}`}
        actions={
          <>
            {u.state === "LISTED" && (
              <Link href={`/applications/new?unit=${u.id}`} className="btn primary">
                New application
              </Link>
            )}
            {canEdit ? (
              <Link href={`/units/${u.id}/edit`} className="btn">
                Edit unit
              </Link>
            ) : null}
          </>
        }
      />

      <div className="split">
        <div className="stack">
          <UnitGallery unitId={u.id} code={u.code} photos={u.photos} bedrooms={u.bedrooms} />

          {u.description && (
            <section className="panel panel-pad">
              <h2 className="section-title">Description</h2>
              <p className="prose">{u.description}</p>
            </section>
          )}

          <section className="panel panel-pad" aria-labelledby="facts-h">
            <h2 id="facts-h" className="section-title">
              Details
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 24 }}>
              <dl className="facts">
                <dt>Landlord</dt>
                <dd>
                  <Link href={`/settings/companies/${u.landlord.companyId}`}>{u.landlord.name}</Link>
                </dd>
                <dt>Layout</dt>
                <dd>
                  {bedroomsLabel(u.bedrooms)}
                  {u.bathrooms !== null ? `, ${u.bathrooms} bath` : ""}
                </dd>
                <dt>Area</dt>
                <dd className="num">{u.areaSqft ? `${u.areaSqft.toLocaleString("en-US")} sq ft` : "—"}</dd>
                <dt>Furnishing</dt>
                <dd>{u.furnished === null ? "Not decided" : u.furnished ? "Furnished" : "Unfurnished"}</dd>
                <dt>Parking</dt>
                <dd>{u.parkingSpaces ?? "—"}</dd>
                <dt>Category</dt>
                <dd>{CATEGORIES.find((c) => c.value === u.category)?.label ?? u.category}</dd>
                <dt>Type</dt>
                <dd>{u.subtype ? subtypeLabel(u.subtype) : "Not set"}</dd>
              </dl>
              <dl className="facts">
                <dt>Unit number</dt>
                <dd className="ref">{u.unitNo ?? "—"}</dd>
                <dt>DLD property</dt>
                <dd className="ref">{u.dldPropertyNo ?? "—"}</dd>
                <dt>Makani</dt>
                <dd className="ref">{u.makaniNo ?? "—"}</dd>
                <dt>Plot</dt>
                <dd className="ref">{u.plotNo ?? "—"}</dd>
                <dt>DEWA premise</dt>
                <dd className="ref">{u.dewaPremiseNo ?? "—"}</dd>
              </dl>
            </div>
            {u.ownUseLockUntil && (
              <p className="muted" style={{ marginTop: 16, fontSize: 14 }}>
                Own-use lock: can&apos;t be re-let before {longDate(u.ownUseLockUntil)}.
              </p>
            )}
          </section>

          <section className="panel" aria-labelledby="hist-h">
            <div className="panel-head">
              <h2 id="hist-h">Leases</h2>
            </div>
            {u.leases.length === 0 ? (
              <p className="muted panel-pad">No leases on this unit yet.</p>
            ) : (
              <ul className="list" style={{ marginTop: 6 }}>
                {u.leases.map((l) => (
                  <li key={l.id}>
                    <Link href={`/work?kind=lease&id=${l.id}`} className="list-row">
                      <div>
                        <div className="title">{l.tenantName ?? "Tenant"}</div>
                        <div className="meta">
                          <span className="ref">{l.ref}</span>
                          <span>
                            {shortDate(l.startOn)} to {longDate(l.endOn)}
                          </span>
                          <span className="num">{aedShort(l.annualRentFils)} / yr</span>
                        </div>
                      </div>
                      <Status value={l.state} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="act-h">
            <div className="panel-head">
              <h2 id="act-h">Activity</h2>
              <span className="hint">append-only audit trail</span>
            </div>
            <ul className="feed">
              {u.events.toReversed().map((e) => (
                <li key={e.id}>
                  <span className="dot" {...(e.toState ? { "data-tone": "good" } : {})} />
                  <span className="what">
                    <b>{eventLabel(e.type)}</b>
                    <span>, {actorLabel(e.actor).toLowerCase()}</span>
                  </span>
                  <time dateTime={e.at}>{dateTime(e.at)}</time>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="stack sticky">
          <section className="panel panel-pad" aria-labelledby="price-h">
            <h2 id="price-h" className="sr-only">
              Asking rent
            </h2>
            <div className="price">
              {u.askingRentFils ? aedShort(u.askingRentFils) : "No price"} {u.askingRentFils && <small>per year</small>}
            </div>
            <p className="muted" style={{ marginTop: 6, fontSize: 13.5 }}>
              {!u.askingRentFils
                ? "Set an asking rent before the unit can be marked ready."
                : u.priceApprovedAt
                  ? "Approved by a leasing manager."
                  : u.priceInRange
                    ? `Within the allowed range${u.priceRange ? ` (${rangeLabel(u.priceRange)})` : ""}.`
                    : u.priceRange
                      ? `Outside the allowed range (${rangeLabel(u.priceRange)}); needs a manager's approval.`
                      : u.priceBasis?.ruleId
                        ? "The rule gives no allowed range for this unit yet (no rent index row and no AED limits); setting a price needs a manager's approval."
                        : "No rule covers this unit yet; setting a price needs a manager's approval."}
            </p>
            {live && (
              <p style={{ marginTop: 12, fontSize: 14 }}>
                Let on lease{" "}
                <Link className="link" href={`/work?kind=lease&id=${live.id}`}>
                  {live.ref}
                </Link>{" "}
                until {longDate(live.endOn)}.
              </p>
            )}
            {u.actions.length > 0 || needsPriceApproval ? (
              <>
                <div className="divider" />
                <UnitActions
                  unitId={u.id}
                  actions={u.actions}
                  canEdit={canEdit}
                  needsPriceApproval={needsPriceApproval}
                  pendingPriceApprovalId={pendingPrice?.id ?? null}
                />
              </>
            ) : null}
          </section>

          <section className="panel panel-pad" aria-labelledby="ready-h">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 id="ready-h" className="section-title" style={{ margin: 0 }}>
                Readiness
              </h2>
              <span className="muted num" style={{ fontSize: 13 }}>
                {doneCount} of {required.length}
              </span>
            </div>
            <div className="meter" aria-hidden="true">
              <i style={{ width: `${(doneCount / required.length) * 100}%` }} />
            </div>
            <ul className="checks">
              {checks.map((c) => (
                <li key={c.key} data-ok={c.done}>
                  {c.done ? <IconCheck size={16} /> : <IconCircle size={16} />}
                  {c.label}
                  <span className="sr-only">{c.done ? "done" : "missing"}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}
