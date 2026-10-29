"use client";

import { formatAed, parseAed, SUBTYPES_BY_CATEGORY } from "@leasing/core";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  type ActionResult,
  createUnitAction,
  type PriceRangeView,
  priceRangeAction,
  updateUnitAction,
} from "../app/(staff)/units/actions";
import { aedShort } from "../lib/format";
import { uploadPhoto } from "../lib/images";
import { IconWarning } from "../lib/icons";
import { type Category, CATEGORIES, COMMUNITIES, subtypeLabel } from "../lib/portfolio";
import type { CompanyRow, UnitRow } from "../lib/types";
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

  function submit(e: React.FormEvent) {
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
  const err = (k: string) => (fe[k] ? <span className="err">{fe[k]}</span> : null);
  const inv = (k: string) => (fe[k] ? { "aria-invalid": true as const } : {});

  return (
    <form onSubmit={submit} noValidate>
      {result.error && (
        <div className="alert" data-tone="bad" role="alert" style={{ marginBottom: 20 }}>
          <IconWarning size={16} />
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
        </div>
      )}

      <section className="form-section">
        <header>
          <h2>The unit</h2>
          <p>How staff find it. The code appears on leases and tasks.</p>
        </header>
        <div className="grid-fields">
          <label className="field span-2">
            <span className="field-label">Unit code</span>
            <input
              value={v.code}
              onChange={set("code")}
              placeholder="MRN-1204"
              required
              disabled={locked("code")}
              {...inv("code")}
            />
            {err("code") ?? (
              <span className="hint">
                {locked("code") ? "Fixed while the unit has a lease" : "Letters, digits and dashes"}
              </span>
            )}
          </label>
          <label className="field span-4">
            <span className="field-label">Building</span>
            <input
              value={v.building}
              onChange={set("building")}
              placeholder="Marina Gate Tower 2"
              required
              {...inv("building")}
            />
            {err("building")}
          </label>
          <label className="field span-3">
            <span className="field-label">Community</span>
            <input
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
          <label className="field span-2">
            <span className="field-label">Unit number</span>
            <input
              value={v.unitNo}
              onChange={set("unitNo")}
              placeholder="1204"
              disabled={locked("unitNo")}
              {...inv("unitNo")}
            />
            {err("unitNo")}
          </label>
          <label className="field">
            <span className="field-label">Floor</span>
            <input value={v.floor} onChange={set("floor")} inputMode="numeric" placeholder="12" {...inv("floor")} />
            {err("floor")}
          </label>
          <label className="field span-3">
            <span className="field-label">Company</span>
            <select value={v.companyId} onChange={set("companyId")} required {...inv("companyId")}>
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
          <div className="field span-3">
            <span className="field-label">Category</span>
            <div className="segmented" role="radiogroup" aria-label="Category">
              {CATEGORIES.map((c) => (
                <label key={c.value}>
                  <input
                    type="radio"
                    name="category"
                    checked={v.category === c.value}
                    disabled={locked("category")}
                    onChange={() => setV((p) => ({ ...p, category: c.value, subtype: "" }))}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
            {locked("category") && <span className="hint">Fixed while the unit has a lease</span>}
            {err("category")}
          </div>
          <label className="field span-3">
            <span className="field-label">Type</span>
            <select value={v.subtype} onChange={set("subtype")} {...inv("subtype")}>
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
      </section>

      <section className="form-section">
        <header>
          <h2>Registration</h2>
          <p>
            Must match the title deed and DLD records exactly; Ejari rejects any mismatch. Required before the unit can
            be marked ready.
          </p>
        </header>
        <div className="grid-fields">
          <label className="field span-3">
            <span className="field-label">DLD property number</span>
            <input
              value={v.dldPropertyNo}
              onChange={set("dldPropertyNo")}
              disabled={locked("dldPropertyNo")}
              {...inv("dldPropertyNo")}
            />
            {err("dldPropertyNo")}
          </label>
          <label className="field span-3">
            <span className="field-label">Makani number</span>
            <input
              value={v.makaniNo}
              onChange={set("makaniNo")}
              inputMode="numeric"
              placeholder="10 digits"
              disabled={locked("makaniNo")}
              {...inv("makaniNo")}
            />
            {err("makaniNo") ?? <span className="hint">The building entrance's geo-address code</span>}
          </label>
          <label className="field span-3">
            <span className="field-label">
              Plot number <em>(optional)</em>
            </span>
            <input value={v.plotNo} onChange={set("plotNo")} disabled={locked("plotNo")} {...inv("plotNo")} />
            {err("plotNo")}
          </label>
          <label className="field span-3">
            <span className="field-label">DEWA premise number</span>
            <input value={v.dewaPremiseNo} onChange={set("dewaPremiseNo")} {...inv("dewaPremiseNo")} />
            {err("dewaPremiseNo")}
          </label>
        </div>
      </section>

      <section className="form-section">
        <header>
          <h2>Layout</h2>
          <p>Used to match enquiries and to work out the allowed price range.</p>
        </header>
        <div className="grid-fields">
          {residential && (
            <div className="field span-6">
              <span className="field-label">Bedrooms</span>
              <div className="segmented" role="radiogroup" aria-label="Bedrooms">
                {["0", "1", "2", "3", "4", "5", "6"].map((b) => (
                  <label key={b}>
                    <input
                      type="radio"
                      name="bedrooms"
                      checked={v.bedrooms === b}
                      onChange={() => setV((p) => ({ ...p, bedrooms: b }))}
                    />
                    <span>{b === "0" ? "Studio" : b === "6" ? "6+" : b}</span>
                  </label>
                ))}
              </div>
              {err("bedrooms")}
            </div>
          )}
          <label className="field span-2">
            <span className="field-label">Area</span>
            <span className="affix">
              <b>sq ft</b>
              <input
                value={v.areaSqft}
                onChange={set("areaSqft")}
                inputMode="numeric"
                placeholder="850"
                {...inv("areaSqft")}
              />
            </span>
            {err("areaSqft")}
          </label>
          <label className="field span-2">
            <span className="field-label">Bathrooms</span>
            <input
              value={v.bathrooms}
              onChange={set("bathrooms")}
              inputMode="numeric"
              placeholder="2"
              {...inv("bathrooms")}
            />
            {err("bathrooms")}
          </label>
          <label className="field span-2">
            <span className="field-label">Parking spaces</span>
            <input
              value={v.parkingSpaces}
              onChange={set("parkingSpaces")}
              inputMode="numeric"
              placeholder="1"
              {...inv("parkingSpaces")}
            />
            {err("parkingSpaces")}
          </label>
          <div className="field span-6">
            <span className="field-label">Furnishing</span>
            <div className="segmented" role="radiogroup" aria-label="Furnishing">
              {(
                [
                  ["no", "Unfurnished"],
                  ["yes", "Furnished"],
                  ["", "Not decided"],
                ] as const
              ).map(([k, label]) => (
                <label key={label}>
                  <input
                    type="radio"
                    name="furnished"
                    checked={v.furnished === k}
                    onChange={() => setV((p) => ({ ...p, furnished: k }))}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="form-section">
        <header>
          <h2>Asking rent</h2>
          <p>Per year. Outside the allowed range, a leasing manager approves it before the unit can be marked ready.</p>
        </header>
        <div className="grid-fields">
          <label className="field span-3">
            <span className="field-label">Annual rent</span>
            <span className="affix">
              <b>AED</b>
              <input
                value={v.askingRent}
                onChange={set("askingRent")}
                inputMode="decimal"
                placeholder="85,000"
                {...inv("askingRentFils")}
              />
            </span>
            {err("askingRentFils") ??
              (view === "idle" ? (
                <span className="hint">Choose a company and community to see the allowed range.</span>
              ) : view === "loading" ? (
                <span className="hint">Checking the allowed range…</span>
              ) : view === null ? (
                <span className="hint" aria-live="polite">
                  Could not check the allowed range.
                </span>
              ) : rangeText ? (
                <span className="hint" aria-live="polite" {...(rentTone ? { "data-tone": rentTone } : {})}>
                  {rangeText}
                  {rentTone === "warn" ? ". This price is outside it, so it needs a manager's approval." : ""}
                </span>
              ) : (
                <span className="hint" aria-live="polite">
                  {view.ruleId
                    ? "This rule gives no allowed range for this unit yet (no rent index row and no AED limits). Setting a price will need a manager's approval."
                    : "No rule covers this unit yet. Setting a price will need a manager's approval."}
                </span>
              ))}
          </label>
        </div>
      </section>

      <section className="form-section">
        <header>
          <h2>Description</h2>
          <p>What applicants read on the listing. Plain facts: view, layout, finishes, access.</p>
        </header>
        <label className="field">
          <span className="sr-only">Description</span>
          <textarea
            value={v.description}
            onChange={set("description")}
            rows={5}
            maxLength={4000}
            placeholder="Corner unit with a full marina view, built-in wardrobes, one covered parking space."
          />
          <span className="hint">{v.description.length} / 4000</span>
        </label>
        <label className="field">
          <span className="field-label">
            Virtual tour link <em>(optional)</em>
          </span>
          <input
            type="url"
            value={v.virtualTourUrl}
            onChange={set("virtualTourUrl")}
            maxLength={500}
            placeholder="https://"
            {...inv("virtualTourUrl")}
          />
          <span className="hint">Shown to applicants on the viewing invitation and the property page. https only.</span>
          {err("virtualTourUrl")}
        </label>
      </section>

      {mode === "create" && (
        <section className="form-section">
          <header>
            <h2>Photos</h2>
            <p>The first photo is the cover. You can add more or reorder them later.</p>
          </header>
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
        </section>
      )}

      <div className="form-foot">
        {progress && busy && (
          <span className="progress" role="status">
            {progress}
          </span>
        )}
        <button type="button" className="btn ghost" onClick={() => router.back()} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy
            ? "Saving…"
            : mode === "create"
              ? photos.length
                ? `Create unit and upload ${photos.length} photo${photos.length === 1 ? "" : "s"}`
                : "Create unit"
              : "Save changes"}
        </button>
      </div>
    </form>
  );
}
