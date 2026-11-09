"use client";

import { formatAed, parseAed, SUBTYPES_BY_CATEGORY } from "@leasing/core";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState, useTransition } from "react";
import {
  type ActionResult,
  createUnitAction,
  type PriceRangeView,
  priceRangeAction,
  updateUnitAction,
} from "../app/(staff)/units/actions";
import { aedShort } from "../lib/format";
import { uploadPhoto } from "../lib/images";
import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { type Category, CATEGORIES, COMMUNITIES, subtypeLabel } from "../lib/portfolio";
import type { CompanyRow, UnitRow } from "../lib/types";
import { Button } from "./ui/button";
import { Banner, FIELD, HINT, INPUT as BASE_INPUT, LABEL } from "./ui/form";
import { moveItem, type PhotoItem, PhotoPicker } from "./photo-picker";

interface Values {
  code: string;
  building: string;
  community: string;
  companyId: string;
  category: Category;
  subtype: string;
  unitNo: string;
  floor: string;
  dldPropertyNo: string;
  makaniNo: string;
  plotNo: string;
  dewaPremiseNo: string;
  areaSqft: string;
  bedrooms: string;
  bathrooms: string;
  parkingSpaces: string;
  furnished: "" | "yes" | "no";
  askingRent: string;
  description: string;
  virtualTourUrl: string;
}

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function initial(u: Partial<UnitRow> | undefined, defaultCompanyId: string): Values {
  return {
    code: s(u?.code),
    building: s(u?.building),
    community: s(u?.community),
    companyId: u?.companyId ?? defaultCompanyId,
    category: u?.category ?? "residential",
    subtype: s(u?.subtype),
    unitNo: s(u?.unitNo),
    floor: s(u?.floor),
    dldPropertyNo: s(u?.dldPropertyNo),
    makaniNo: s(u?.makaniNo),
    plotNo: s(u?.plotNo),
    dewaPremiseNo: s(u?.dewaPremiseNo),
    areaSqft: s(u?.areaSqft),
    bedrooms: s(u?.bedrooms ?? 1),
    bathrooms: s(u?.bathrooms),
    parkingSpaces: s(u?.parkingSpaces),
    furnished: u?.furnished === true ? "yes" : u?.furnished === false ? "no" : "",
    askingRent: u?.askingRentFils ? formatAed(u.askingRentFils).replace("AED ", "").replace(/\.00$/, "") : "",
    description: s(u?.description),
    virtualTourUrl: s(u?.virtualTourUrl),
  };
}

const int = (v: string) => (v.trim() === "" ? null : Number(v));

export function UnitForm({
  mode,
  unit,
  companies,
  lockedFields = [],
}: {
  mode: "create" | "edit";
  unit?: UnitRow;
  companies: CompanyRow[];
  lockedFields?: string[];
}) {
  const router = useRouter();
  const [v, setV] = useState<Values>(() =>
    initial(unit, companies.find((c) => c.active)?.id ?? companies[0]?.id ?? ""),
  );
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [result, setResult] = useState<ActionResult>({});
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const set =
    <K extends keyof Values>(k: K) =>
    (e: { target: { value: string } }) =>
      setV((p) => ({ ...p, [k]: e.target.value as Values[K] }));
  const fe = result.fieldErrors ?? {};

  const rentFils = useMemo(() => {
    try {
      return v.askingRent.trim() ? parseAed(v.askingRent) : null;
    } catch {
      return Number.NaN;
    }
  }, [v.askingRent]);
  const residential = v.category === "residential";
  const areaSqft = int(v.areaSqft);
  const bedrooms = residential ? int(v.bedrooms) : null;
  const rangeEnabled = !!v.companyId && !!v.community.trim();
  const rangeArea = areaSqft !== null && Number.isInteger(areaSqft) && areaSqft >= 50 ? areaSqft : null;
  const rangeKey = JSON.stringify([v.companyId, v.category, v.subtype, v.community.trim(), bedrooms, rangeArea]);
  // The answer is stored with the inputs it was fetched for, so a stale one never shows while typing.
  const [fetched, setFetched] = useState<{ key: string; data: PriceRangeView | null } | null>(null);
  const view: PriceRangeView | null | "loading" | "idle" = !rangeEnabled
    ? "idle"
    : fetched?.key === rangeKey
      ? fetched.data
      : "loading";
  useEffect(() => {
    if (!rangeEnabled) return;
    let live = true;
    const t = setTimeout(async () => {
      const data = await priceRangeAction({
        companyId: v.companyId,
        category: v.category,
        subtype: v.subtype || null,
        community: v.community.trim(),
        bedrooms,
        areaSqft: rangeArea,
      });
      if (live) setFetched({ key: rangeKey, data });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [rangeEnabled, rangeKey, v.companyId, v.category, v.subtype, v.community, bedrooms, rangeArea]);
  const loaded = view && view !== "loading" && view !== "idle" ? view : null;
  const range = loaded?.range ?? null;
  const companyName = companies.find((c) => c.id === v.companyId)?.name ?? "The company";
  const rentTone =
    rentFils === null || Number.isNaN(rentFils) || !range
      ? undefined
      : (range.min !== null && rentFils < range.min) || (range.max !== null && rentFils > range.max)
        ? "warn"
        : "good";
  const rangeText = (() => {
    if (!range) return null;
    const { min, max } = range;
    const amount =
      min !== null && max !== null
        ? `${aedShort(min)} to ${aedShort(max)}`
        : min !== null
          ? `${aedShort(min)} or more`
          : max !== null
            ? `up to ${aedShort(max)}`
            : "any amount";
    const basis = loaded?.sriLabel ?? null;
    return `Allowed: ${amount} (${companyName} ${v.category} rule${basis ? `, ${basis}` : ""})`;
  })();

  function payload(): Record<string, unknown> | null {
    if (Number.isNaN(rentFils)) {
      setResult({
        error: "Some fields need attention.",
        fieldErrors: { askingRentFils: "Enter an amount like 85,000" },
      });
      return null;
    }
    return {
      code: v.code,
      building: v.building,
      community: v.community,
      companyId: v.companyId,
      category: v.category,
      subtype: v.subtype || null,
      unitNo: v.unitNo,
      floor: int(v.floor),
      dldPropertyNo: v.dldPropertyNo,
      makaniNo: v.makaniNo,
      plotNo: v.plotNo,
      dewaPremiseNo: v.dewaPremiseNo,
      areaSqft: int(v.areaSqft),
      bedrooms,
      bathrooms: int(v.bathrooms),
      parkingSpaces: int(v.parkingSpaces),
      furnished: v.furnished === "" ? null : v.furnished === "yes",
      askingRentFils: rentFils,
      description: v.description,
      virtualTourUrl: v.virtualTourUrl,
    };
  }

  function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = payload();
    if (!body) return;
    startTransition(async () => {
      if (mode === "edit" && unit) {
        const patch = Object.fromEntries(Object.entries(body).filter(([k]) => !lockedFields.includes(k)));
        const r = await updateUnitAction(unit.id, patch);
        setResult(r);
        if (r.ok) router.push(`/units/${unit.id}`);
        return;
      }
      const r = await createUnitAction(body);
      setResult(r);
      if (!r.ok || !r.id) return;
      // Upload photos one at a time, in the order shown; the first becomes the cover.
      let failed = 0;
      for (const [i, p] of photos.entries()) {
        if (!p.file) continue;
        setProgress(`Uploading photo ${i + 1} of ${photos.length}`);
        setPhotos((list) => list.map((x) => (x.key === p.key ? { ...x, status: "uploading" } : x)));
        try {
          await uploadPhoto(r.id, p.file, p.caption);
          setPhotos((list) => list.map((x) => (x.key === p.key ? { ...x, status: "saved" } : x)));
        } catch (err) {
          failed++;
          setPhotos((list) =>
            list.map((x) => (x.key === p.key ? { ...x, status: "error", error: (err as Error).message } : x)),
          );
        }
      }
      router.push(failed ? `/units/${r.id}/edit?photos=failed` : `/units/${r.id}`);
    });
  }

  const locked = (k: string) => lockedFields.includes(k);
  const err = (k: string) => (fe[k] ? <span className="text-xs text-danger">{fe[k]}</span> : null);
  const inv = (k: string) => (fe[k] ? { "aria-invalid": true as const } : {});

  return (
    <form
      onSubmit={submit}
      noValidate
      className={`@container grid max-w-[980px] ${mode === "edit" ? "" : "[&>section:first-child]:border-t-0 [&>section:first-child]:pt-0"}`}
    >
      {result.error && (
        <div className="mb-5">
          <Banner tone="bad" role="alert">
            <IconWarning size={16} className="mt-0.5 shrink-0" />
            <div>
              <strong>{result.error}</strong>
              {result.reasons && result.reasons.length > 0 && (
                <ul>
                  {result.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          </Banner>
        </div>
      )}

      <FormSection title="The unit" lede="How staff find it. The code appears on leases and tasks.">
        <div className={`${S6} ${W2}`}>
          <label className={FIELD}>
            <span className={LABEL}>Unit code</span>
            <input
              className={INPUT}
              value={v.code}
              onChange={set("code")}
              placeholder="MRN-1204"
              required
              disabled={locked("code")}
              {...inv("code")}
            />
            {err("code") ?? (
              <span className={HINT}>
                {locked("code") ? "Fixed while the unit has a lease" : "Letters, digits and dashes"}
              </span>
            )}
          </label>
          <label className={`${FIELD} ${W4}`}>
            <span className={LABEL}>Building</span>
            <input
              className={INPUT}
              value={v.building}
              onChange={set("building")}
              placeholder="Marina Gate Tower 2"
              required
              {...inv("building")}
            />
            {err("building")}
          </label>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Community</span>
            <input
              className={INPUT}
              value={v.community}
              onChange={set("community")}
              list="communities"
              placeholder="Dubai Marina"
              required
              {...inv("community")}
            />
            <datalist id="communities">
              {COMMUNITIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {err("community")}
          </label>
          <label className={`${FIELD} ${W2}`}>
            <span className={LABEL}>Unit number</span>
            <input
              className={INPUT}
              value={v.unitNo}
              onChange={set("unitNo")}
              placeholder="1204"
              disabled={locked("unitNo")}
              {...inv("unitNo")}
            />
            {err("unitNo")}
          </label>
          <label className={`${FIELD} ${W1}`}>
            <span className={LABEL}>Floor</span>
            <input
              className={INPUT}
              value={v.floor}
              onChange={set("floor")}
              inputMode="numeric"
              placeholder="12"
              {...inv("floor")}
            />
            {err("floor")}
          </label>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Company</span>
            <select className={INPUT} value={v.companyId} onChange={set("companyId")} required {...inv("companyId")}>
              {companies.length === 0 && <option value="">No companies yet</option>}
              {companies
                .filter((c) => c.active || c.id === v.companyId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            {err("companyId")}
          </label>
          <div className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Category</span>
            <Choices label="Category">
              {CATEGORIES.map((c) => (
                <Choice
                  key={c.value}
                  name="category"
                  checked={v.category === c.value}
                  disabled={locked("category")}
                  onChange={() => setV((p) => ({ ...p, category: c.value, subtype: "" }))}
                >
                  {c.label}
                </Choice>
              ))}
            </Choices>
            {locked("category") && <span className={HINT}>Fixed while the unit has a lease</span>}
            {err("category")}
          </div>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Type</span>
            <select className={INPUT} value={v.subtype} onChange={set("subtype")} {...inv("subtype")}>
              <option value="">Not set</option>
              {SUBTYPES_BY_CATEGORY[v.category].map((t) => (
                <option key={t} value={t}>
                  {subtypeLabel(t)}
                </option>
              ))}
            </select>
            {err("subtype")}
          </label>
        </div>
      </FormSection>

      <FormSection
        title="Registration"
        lede="Must match the title deed and DLD records exactly; Ejari rejects any mismatch. Required before the unit can be marked ready."
      >
        <div className={S6}>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>DLD property number</span>
            <input
              className={INPUT}
              value={v.dldPropertyNo}
              onChange={set("dldPropertyNo")}
              disabled={locked("dldPropertyNo")}
              {...inv("dldPropertyNo")}
            />
            {err("dldPropertyNo")}
          </label>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Makani number</span>
            <input
              className={INPUT}
              value={v.makaniNo}
              onChange={set("makaniNo")}
              inputMode="numeric"
              placeholder="10 digits"
              disabled={locked("makaniNo")}
              {...inv("makaniNo")}
            />
            {err("makaniNo") ?? <span className={HINT}>The building entrance's geo-address code</span>}
          </label>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>
              Plot number <em className="font-normal not-italic">(optional)</em>
            </span>
            <input
              className={INPUT}
              value={v.plotNo}
              onChange={set("plotNo")}
              disabled={locked("plotNo")}
              {...inv("plotNo")}
            />
            {err("plotNo")}
          </label>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>DEWA premise number</span>
            <input
              className={INPUT}
              value={v.dewaPremiseNo}
              onChange={set("dewaPremiseNo")}
              {...inv("dewaPremiseNo")}
            />
            {err("dewaPremiseNo")}
          </label>
        </div>
      </FormSection>

      <FormSection title="Layout" lede="Used to match enquiries and to work out the allowed price range.">
        <div className={S6}>
          {residential && (
            <div className={`${FIELD} col-span-6`}>
              <span className={LABEL}>Bedrooms</span>
              <Choices label="Bedrooms">
                {["0", "1", "2", "3", "4", "5", "6"].map((b) => (
                  <Choice
                    key={b}
                    name="bedrooms"
                    checked={v.bedrooms === b}
                    onChange={() => setV((p) => ({ ...p, bedrooms: b }))}
                  >
                    {b === "0" ? "Studio" : b === "6" ? "6+" : b}
                  </Choice>
                ))}
              </Choices>
              {err("bedrooms")}
            </div>
          )}
          <label className={`${FIELD} ${W2}`}>
            <span className={LABEL}>Area</span>
            <Affix unit="sq ft">
              <input
                value={v.areaSqft}
                onChange={set("areaSqft")}
                inputMode="numeric"
                placeholder="850"
                {...inv("areaSqft")}
              />
            </Affix>
            {err("areaSqft")}
          </label>
          <label className={`${FIELD} ${W2}`}>
            <span className={LABEL}>Bathrooms</span>
            <input
              className={INPUT}
              value={v.bathrooms}
              onChange={set("bathrooms")}
              inputMode="numeric"
              placeholder="2"
              {...inv("bathrooms")}
            />
            {err("bathrooms")}
          </label>
          <label className={`${FIELD} ${W2}`}>
            <span className={LABEL}>Parking spaces</span>
            <input
              className={INPUT}
              value={v.parkingSpaces}
              onChange={set("parkingSpaces")}
              inputMode="numeric"
              placeholder="1"
              {...inv("parkingSpaces")}
            />
            {err("parkingSpaces")}
          </label>
          <div className={`${FIELD} col-span-6`}>
            <span className={LABEL}>Furnishing</span>
            <Choices label="Furnishing">
              {(
                [
                  ["no", "Unfurnished"],
                  ["yes", "Furnished"],
                  ["", "Not decided"],
                ] as const
              ).map(([k, label]) => (
                <Choice
                  key={label}
                  name="furnished"
                  checked={v.furnished === k}
                  onChange={() => setV((p) => ({ ...p, furnished: k }))}
                >
                  {label}
                </Choice>
              ))}
            </Choices>
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Asking rent"
        lede="Per year. Outside the allowed range, a leasing manager approves it before the unit can be marked ready."
      >
        <div className={S6}>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Annual rent</span>
            <Affix unit="AED">
              <input
                value={v.askingRent}
                onChange={set("askingRent")}
                inputMode="decimal"
                placeholder="85,000"
                {...inv("askingRentFils")}
              />
            </Affix>
            {err("askingRentFils") ??
              (view === "idle" ? (
                <span className={HINT}>Choose a company and community to see the allowed range.</span>
              ) : view === "loading" ? (
                <span className={HINT}>Checking the allowed range…</span>
              ) : view === null ? (
                <span className={HINT} aria-live="polite">
                  Could not check the allowed range.
                </span>
              ) : rangeText ? (
                <span
                  className={`${HINT} ${rentTone === "warn" ? "text-warning!" : ""}`}
                  aria-live="polite"
                  {...(rentTone ? { "data-tone": rentTone } : {})}
                >
                  {rangeText}
                  {rentTone === "warn" ? ". This price is outside it, so it needs a manager's approval." : ""}
                </span>
              ) : (
                <span className={HINT} aria-live="polite">
                  {view.ruleId
                    ? "This rule gives no allowed range for this unit yet (no rent index row and no AED limits). Setting a price will need a manager's approval."
                    : "No rule covers this unit yet. Setting a price will need a manager's approval."}
                </span>
              ))}
          </label>
        </div>
      </FormSection>

      <FormSection
        title="Description"
        lede="What applicants read on the listing. Plain facts: view, layout, finishes, access."
      >
        <div className="grid gap-4">
          <label className={FIELD}>
            <span className="sr-only">Description</span>
            <textarea
              className={INPUT}
              value={v.description}
              onChange={set("description")}
              rows={5}
              maxLength={4000}
              placeholder="Corner unit with a full marina view, built-in wardrobes, one covered parking space."
            />
            <span className={HINT}>{v.description.length} / 4000</span>
          </label>
          <label className={FIELD}>
            <span className={LABEL}>
              Virtual tour link <em className="font-normal not-italic">(optional)</em>
            </span>
            <input
              className={INPUT}
              type="url"
              value={v.virtualTourUrl}
              onChange={set("virtualTourUrl")}
              maxLength={500}
              placeholder="https://"
              {...inv("virtualTourUrl")}
            />
            <span className={HINT}>
              Shown to applicants on the site visit invitation and the property page. https only.
            </span>
            {err("virtualTourUrl")}
          </label>
        </div>
      </FormSection>

      {mode === "create" && (
        <FormSection title="Photos" lede="The first photo is the cover. You can add more or reorder them later.">
          <PhotoPicker
            items={photos}
            disabled={busy}
            onAdd={(files) =>
              setPhotos((list) => [
                ...list,
                ...files.map((f) => ({
                  key: `${f.name}-${f.size}-${crypto.randomUUID()}`,
                  src: URL.createObjectURL(f),
                  caption: "",
                  file: f,
                })),
              ])
            }
            onRemove={(key) => setPhotos((list) => list.filter((p) => p.key !== key))}
            onMove={(key, to) =>
              setPhotos((list) =>
                moveItem(
                  list,
                  list.findIndex((p) => p.key === key),
                  to,
                ),
              )
            }
            onCaption={(key, caption) => setPhotos((list) => list.map((p) => (p.key === key ? { ...p, caption } : p)))}
          />
        </FormSection>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-5">
        {progress && busy && (
          <span className="mr-auto text-sm text-muted" role="status">
            {progress}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={() => router.back()} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy
            ? "Saving…"
            : mode === "create"
              ? photos.length
                ? `Create unit and upload ${photos.length} photo${photos.length === 1 ? "" : "s"}`
                : "Create unit"
              : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

// Field widths on a six-column grid: full width when narrow, then 1, 2, 3 or 4 of 6 once the form has room.
const S6 = "grid grid-cols-6 items-start gap-x-4 gap-y-4";
const W1 = "col-span-6 @[560px]:col-span-1";
const W2 = "col-span-6 @[560px]:col-span-2";
const W3 = "col-span-6 @[560px]:col-span-3";
const W4 = "col-span-6 @[560px]:col-span-4";
const INPUT = `${BASE_INPUT} aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-60`;

/** A titled block of fields: the title and its note on the left once there is room, the fields on the right. */
export function FormSection({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line py-7 @[760px]:grid-cols-[210px_minmax(0,1fr)] @[760px]:gap-10">
      <header className="grid content-start gap-1">
        <h2 className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        <p className="m-0 text-[13px] text-muted">{lede}</p>
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** A row of radio choices drawn as a pill group. */
function Choices({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex w-fit max-w-full flex-wrap gap-1 rounded-full bg-raised p-[3px]"
    >
      {children}
    </div>
  );
}

function Choice({
  name,
  checked,
  disabled,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="cursor-pointer rounded-full px-3.5 py-1.5 font-sans text-[13px] text-muted has-[:checked]:bg-page has-[:checked]:font-semibold has-[:checked]:text-ink has-[:checked]:shadow-[0_1px_2px_rgb(0_0_0/0.08)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink">
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} className="sr-only" />
      <span>{children}</span>
    </label>
  );
}

/** An input with a unit label on its left (AED, sq ft). */
function Affix({ unit, children }: { unit: string; children: ReactNode }) {
  return (
    <span className="flex items-stretch overflow-hidden rounded-input border border-line bg-page focus-within:border-ink hover:border-ink [&_input]:min-w-0 [&_input]:flex-1 [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-3 [&_input]:py-2 [&_input]:text-sm [&_input]:text-ink [&_input]:outline-none [&_input]:placeholder:text-muted">
      <b className="grid place-items-center border-r border-line bg-raised px-3 font-sans text-xs font-semibold text-muted">
        {unit}
      </b>
      {children}
    </span>
  );
}
