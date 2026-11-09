import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AskAiMenu } from "../../../../components/ask-ai";
import { buttonClass } from "../../../../components/ui/button";
import { Pill } from "../../../../components/ui/pill";
import { FactKey, FactList, FactVal, Section, Sub, ROW_CARD } from "../../../../components/ui/record";
import { RecordStepper } from "../../../../components/ui/stepper";
import { askPrompts } from "../../../../lib/ask-ai/prompts";
import { canSeeUnits } from "../../../../lib/shell/nav";
import { NotAllowed } from "../not-allowed";
import { UnitActions } from "../../../../components/unit-actions";
import { UnitGallery } from "../../../../components/unit-gallery";
import { Status } from "../../../../components/ui";
import { get } from "../../../../lib/engine";
import { actorLabel, aedShort, bedroomsLabel, dateTime, eventLabel, longDate, shortDate } from "../../../../lib/format";
import {
  ArrowLeftIcon as IconBack,
  CheckIcon as IconCheck,
  PencilSimpleIcon as IconEdit,
} from "@phosphor-icons/react/dist/ssr";
import { CATEGORIES, subtypeLabel } from "../../../../lib/portfolio";
import type { StaffRole } from "@leasing/core";
import type { Me, RecordRow, UnitDetail } from "../../../../lib/types";

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
const STEPS = [
  { state: "PREP", label: "Prep" },
  { state: "READY", label: "Ready" },
  { state: "LISTED", label: "Listed" },
  { state: "OCCUPIED", label: "Occupied" },
] as const;
const CARD = "grid gap-2 rounded-2xl border border-line bg-page p-5";
const CARD_TITLE = "m-0 font-sans text-[15px] font-semibold tracking-tight text-ink";
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
  const [u, me, records] = await Promise.all([
    get<UnitDetail>(`/api/units/${id}`),
    get<Me>("/api/me"),
    get<RecordRow[]>("/api/records"),
  ]);
  if (me && !canSeeUnits(me.role as StaffRole)) return <NotAllowed />;
  if (!u) notFound();
  const applications = (records ?? []).filter((r) => r.kind === "application" && r.unitCode === u.code);
  const stageLabel = STEPS.find((s) => s.state === u.state)?.label ?? "";
  const canEdit = !!me && EDITORS.includes(me.role);
  const checks = CHECKLIST.map((c) => ({ ...c, done: c.ok(u) }));
  const required = checks.filter((c) => c.key !== "photos");
  const doneCount = required.filter((c) => c.done).length;
  const pendingPrice = u.approvals.find((a) => a.gate === "price_out_of_range" && a.status === "pending") ?? null;
  const needsPriceApproval = !!u.askingRentFils && !u.priceInRange && !u.priceApprovedAt && u.state === "PREP";
  const live = u.leases.find((l) => l.state !== "CLOSED");

  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-6 @container">
      <Link
        href="/units"
        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-full border border-line px-3.5 font-sans text-[13px] font-semibold text-ink! no-underline hover:border-ink"
      >
        <IconBack size={14} aria-hidden />
        All units
      </Link>

      <div className="grid items-start gap-x-[26px] gap-y-6 @[880px]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-6">
          <UnitGallery unitId={u.id} code={u.code} photos={u.photos} bedrooms={u.bedrooms} />

          <header className="grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="m-0 font-sans text-[26px] font-semibold leading-tight tracking-tight text-ink">
                    {u.code}
                  </h1>
                  <Status value={u.state} />
                </div>
                <p className="m-0 mt-1 text-sm text-muted">
                  {u.building}, {u.community}
                  {u.floor !== null ? `, floor ${u.floor}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AskAiMenu label="Ask AI" prompts={askPrompts.unit(u.code)} page={{ kind: "unit", id: u.id }} />
                {u.state === "LISTED" && (
                  <Link href={`/applications/new?unit=${u.id}`} className={buttonClass("primary", "sm")}>
                    New application
                  </Link>
                )}
                {canEdit ? (
                  <Link href={`/units/${u.id}/edit`} className={buttonClass("ghost", "sm")}>
                    <IconEdit size={15} aria-hidden />
                    Edit unit
                  </Link>
                ) : null}
              </div>
            </div>
            <div aria-label={`Unit stage: ${stageLabel}`} role="group">
              <RecordStepper stages={STEPS.map((x) => x.label)} current={stageLabel} />
            </div>
          </header>

          <Section id="ready-h" title="Ready-to-list checklist" hint={`${doneCount} of ${required.length} done`}>
            <ul className="m-0 grid list-none gap-2 p-0">
              {checks.map((c) => (
                <li
                  key={c.key}
                  data-ok={c.done}
                  className={`${ROW_CARD} flex items-center justify-between gap-3 text-sm`}
                >
                  <span>{c.label}</span>
                  {c.done ? (
                    <Pill tone="accent">
                      <IconCheck size={12} weight="bold" aria-hidden />
                      Done
                    </Pill>
                  ) : (
                    <Pill tone="neutral">To do</Pill>
                  )}
                </li>
              ))}
            </ul>
          </Section>

          {u.description && (
            <Section id="desc-h" title="Description">
              <p className="m-0 max-w-[68ch] whitespace-pre-line text-sm leading-relaxed text-ink">{u.description}</p>
            </Section>
          )}

          <Section id="facts-h" title="Details">
            <div className="grid gap-x-8 gap-y-5 @[640px]:grid-cols-2">
              <FactList>
                <FactKey>Layout</FactKey>
                <FactVal>
                  {bedroomsLabel(u.bedrooms)}
                  {u.bathrooms !== null ? `, ${u.bathrooms} bath` : ""}
                </FactVal>
                <FactKey>Area</FactKey>
                <FactVal>{u.areaSqft ? `${u.areaSqft.toLocaleString("en-US")} sq ft` : "—"}</FactVal>
                <FactKey>Furnishing</FactKey>
                <FactVal>{u.furnished === null ? "Not decided" : u.furnished ? "Furnished" : "Unfurnished"}</FactVal>
                <FactKey>Parking</FactKey>
                <FactVal>{u.parkingSpaces ?? "—"}</FactVal>
                <FactKey>Category</FactKey>
                <FactVal>{CATEGORIES.find((c) => c.value === u.category)?.label ?? u.category}</FactVal>
                <FactKey>Type</FactKey>
                <FactVal>{u.subtype ? subtypeLabel(u.subtype) : "Not set"}</FactVal>
              </FactList>
              <FactList>
                <FactKey>Unit number</FactKey>
                <FactVal className="font-mono text-[13px]">{u.unitNo ?? "—"}</FactVal>
                <FactKey>DLD property</FactKey>
                <FactVal className="font-mono text-[13px]">{u.dldPropertyNo ?? "—"}</FactVal>
                <FactKey>Makani</FactKey>
                <FactVal className="font-mono text-[13px]">{u.makaniNo ?? "—"}</FactVal>
                <FactKey>Plot</FactKey>
                <FactVal className="font-mono text-[13px]">{u.plotNo ?? "—"}</FactVal>
                <FactKey>DEWA premise</FactKey>
                <FactVal className="font-mono text-[13px]">{u.dewaPremiseNo ?? "—"}</FactVal>
              </FactList>
            </div>
            {u.ownUseLockUntil && (
              <p className="m-0 text-sm text-muted">
                Own-use lock: can&apos;t be re-let before {longDate(u.ownUseLockUntil)}.
              </p>
            )}
          </Section>

          <Section id="hist-h" title="Leases">
            {u.leases.length === 0 ? (
              <p className="m-0 text-sm text-muted">No leases on this unit yet.</p>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {u.leases.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/work?kind=lease&id=${l.id}`}
                      className={`${ROW_CARD} flex flex-wrap items-center justify-between gap-2 text-ink! no-underline hover:border-ink`}
                    >
                      <span className="min-w-0">
                        <b className="block text-sm font-semibold">{l.tenantName ?? "Tenant"}</b>
                        <Sub>
                          <span className="font-mono text-xs">{l.ref}</span> · {shortDate(l.startOn)} to{" "}
                          {longDate(l.endOn)} · {aedShort(l.annualRentFils)} / yr
                        </Sub>
                      </span>
                      <Status value={l.state} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="act-h" title="Activity" hint="append-only audit trail">
            <ul className="m-0 grid list-none gap-2.5 p-0">
              {u.events.toReversed().map((e) => (
                <li key={e.id} className="grid grid-cols-[8.5rem_1fr] gap-3 text-sm">
                  <time dateTime={e.at} className="font-mono text-xs leading-5 text-muted">
                    {dateTime(e.at)}
                  </time>
                  <span>
                    <b className="font-semibold">{eventLabel(e.type)}</b>
                    <span className="text-muted">, {actorLabel(e.actor).toLowerCase()}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <aside className="grid min-w-0 gap-4 @[880px]:sticky @[880px]:top-6">
          <section className={CARD} aria-labelledby="price-h">
            <h2 id="price-h" className={CARD_TITLE}>
              Asking rent
            </h2>
            <div className="font-sans text-[26px] font-semibold leading-tight tracking-tight text-ink">
              {u.askingRentFils ? aedShort(u.askingRentFils) : "No price"}{" "}
              {u.askingRentFils && <small className="text-sm font-normal text-muted">per year</small>}
            </div>
            <p className="m-0 text-[13px] text-muted">
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
              <p className="m-0 text-sm text-ink">
                Let on lease{" "}
                <Link className="font-semibold underline" href={`/work?kind=lease&id=${live.id}`}>
                  {live.ref}
                </Link>{" "}
                until {longDate(live.endOn)}.
              </p>
            )}
            {u.actions.length > 0 || needsPriceApproval ? (
              <div className="mt-2 border-t border-line pt-4">
                <UnitActions
                  unitId={u.id}
                  actions={u.actions}
                  canEdit={canEdit}
                  needsPriceApproval={needsPriceApproval}
                  pendingPriceApprovalId={pendingPrice?.id ?? null}
                />
              </div>
            ) : null}
          </section>

          <section className={CARD} aria-labelledby="sri-h">
            <h2 id="sri-h" className={CARD_TITLE}>
              From the published Smart Rental Index
            </h2>
            <p className="m-0 text-sm font-semibold text-ink">
              {u.priceRange
                ? `Allowed range: ${rangeLabel(u.priceRange)} a year.`
                : "No allowed range for this unit yet."}
            </p>
            <p className="m-0 text-[13px] text-muted">
              {u.priceBasis?.sriLabel ?? "No index row covers this unit yet."}
            </p>
          </section>

          <section className={CARD} aria-labelledby="apps-h">
            <h2 id="apps-h" className={CARD_TITLE}>
              Applications on this unit
            </h2>
            {applications.length === 0 ? (
              <p className="m-0 text-sm text-muted">No applications on this unit yet.</p>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {applications.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/work?kind=application&id=${a.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink! no-underline hover:underline"
                    >
                      <span>
                        <b>{a.title}</b> <span className="text-muted">{a.ref}</span>
                      </span>
                      <Pill tone="neutral">{a.nextStep}</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={CARD} aria-labelledby="landlord-h">
            <h2 id="landlord-h" className={CARD_TITLE}>
              Landlord
            </h2>
            <p className="m-0 text-sm text-muted">
              <Link className="font-semibold text-ink! underline" href={`/settings/companies/${u.landlord.companyId}`}>
                {u.landlord.name}
              </Link>
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
