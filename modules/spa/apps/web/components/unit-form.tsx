"use client";

import { FormAlert } from "@platform/ui/action-form";
import { Button } from "@platform/ui/button";
import { zodFieldErrors } from "@platform/ui/field-errors";
import { FIELD, HINT, INPUT as BASE_INPUT, LABEL } from "@platform/ui/form";
import { useActionForm } from "@platform/ui/use-action-form";
import { UNIT_TYPES, UnitDetails } from "@spa/core";
import { type ReactNode, useState, useTransition } from "react";
import { type ActionResult, createUnitAction, updateUnitAction } from "../app/(staff)/inventory/unit-actions";
import type { UnitRecord } from "../lib/contracts";
import { UNIT_TYPE_LABEL } from "../lib/words";

export interface FormProject {
  id: string;
  name: string;
  buildings: { id: string; code: string; name: string }[];
}

interface Values {
  projectId: string;
  buildingId: string;
  code: string;
  type: string;
  bedrooms: string;
  bathrooms: string;
  internalSqft: string;
  balconySqft: string;
  floor: string;
  view: string;
  parkingSpaces: string;
  description: string;
}

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const text = (v: string): string | null => (v.trim() === "" ? null : v.trim());

function initial(unit: UnitRecord | undefined, projects: FormProject[], projectId: string | undefined): Values {
  const project = projects.find((p) => p.id === (unit?.project?.id ?? projectId)) ?? projects[0];
  return {
    projectId: project?.id ?? "",
    buildingId: unit?.building?.id ?? project?.buildings[0]?.id ?? "",
    code: s(unit?.code),
    type: s(unit?.type),
    bedrooms: s(unit?.bedrooms),
    bathrooms: s(unit?.bathrooms),
    internalSqft: s(unit?.internalSqft),
    balconySqft: s(unit?.balconySqft),
    floor: s(unit?.floor),
    view: s(unit?.view),
    parkingSpaces: s(unit?.parkingSpaces),
    description: s(unit?.description),
  };
}

const INPUT = `${BASE_INPUT} aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-60`;
const S6 = "grid grid-cols-6 items-start gap-x-4 gap-y-4";
const W1 = "col-span-6 @[560px]:col-span-1";
const W2 = "col-span-6 @[560px]:col-span-2";
const W3 = "col-span-6 @[560px]:col-span-3";

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

/**
 * The New and Edit unit form (S75), laid out like leasing's: Where, Layout, Description. Checked in the browser with the
 * same `UnitDetails` schema the engine uses; the engine checks again and its answer is mapped under the field it names.
 * On Edit the project and building are fixed (a unit stays where it was placed); the code is fixed by the engine while
 * a deal is open.
 */
export function UnitForm({
  mode,
  unit,
  projects,
  projectId,
}: {
  mode: "create" | "edit";
  unit?: UnitRecord;
  projects: FormProject[];
  /** The project to start on (from the project page's "New unit"). */
  projectId?: string | undefined;
}) {
  const [v, setV] = useState<Values>(() => initial(unit, projects, projectId));
  const [result, setResult] = useState<ActionResult>({});
  const [busy, startTransition] = useTransition();
  const set =
    <K extends keyof Values>(k: K) =>
    (e: { target: { value: string } }) =>
      setV((p) => ({ ...p, [k]: e.target.value as Values[K] }));
  const project = projects.find((p) => p.id === v.projectId);

  const details = () => ({
    type: text(v.type),
    bedrooms: num(v.bedrooms),
    bathrooms: num(v.bathrooms),
    internalSqft: num(v.internalSqft),
    balconySqft: num(v.balconySqft),
    floor: num(v.floor),
    view: text(v.view),
    parkingSpaces: num(v.parkingSpaces),
    description: text(v.description),
  });

  function submit() {
    startTransition(async () => {
      if (mode === "edit" && unit) {
        const r = await updateUnitAction(unit.id, { code: v.code, ...details() });
        setResult(r);
        if (r.ok) window.location.assign(`/inventory/units/${unit.id}`);
        return;
      }
      const r = await createUnitAction(v.projectId, { buildingId: v.buildingId, code: v.code, ...details() });
      setResult(r);
      if (r.ok && r.id) window.location.assign(`/inventory/units/${r.id}`);
    });
  }

  const form = useActionForm(submit, {
    validate: () => {
      const errors: Record<string, string> = {};
      if (!v.code.trim()) errors.code = "Enter the unit code";
      if (mode === "create" && !v.buildingId) errors.buildingId = "Choose a building";
      const parsed = UnitDetails.safeParse(details());
      if (!parsed.success) Object.assign(errors, zodFieldErrors(parsed.error));
      return Object.keys(errors).length ? errors : null;
    },
    serverErrors: result.fieldErrors,
  });
  const fe = form.fieldErrors;
  const err = (k: string) => (fe[k] ? <span className="text-xs text-danger">{fe[k]}</span> : null);
  const inv = (k: string) => ({ "data-field": k, ...(fe[k] ? { "aria-invalid": true as const } : {}) });

  return (
    <form {...form.formProps} noValidate className="@container grid max-w-[980px] [&>section:first-child]:border-t-0">
      {(result.error || form.invalid.length > 0) && (
        <div className="mb-5">
          <FormAlert {...form.alertProps(result)} />
        </div>
      )}

      <FormSection title="Where" lede="The project and building it belongs to, and the code staff know it by.">
        <div className={`${S6}`}>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Project</span>
            {mode === "edit" ? (
              <input className={INPUT} value={unit?.project?.name ?? "Not in a project yet"} disabled readOnly />
            ) : (
              <select
                className={INPUT}
                value={v.projectId}
                onChange={(e) => {
                  const next = projects.find((p) => p.id === e.target.value);
                  setV((p) => ({ ...p, projectId: e.target.value, buildingId: next?.buildings[0]?.id ?? "" }));
                }}
                required
                {...inv("projectId")}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Building</span>
            {mode === "edit" ? (
              <input className={INPUT} value={unit?.building?.name ?? ""} disabled readOnly />
            ) : (
              <select
                className={INPUT}
                value={v.buildingId}
                onChange={set("buildingId")}
                required
                {...inv("buildingId")}
              >
                {(project?.buildings ?? []).length === 0 && <option value="">This project has no building yet</option>}
                {(project?.buildings ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </select>
            )}
            {err("buildingId") ??
              (mode === "edit" ? <span className={HINT}>A unit stays in the building it was placed in</span> : null)}
          </label>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Unit code</span>
            <input
              className={INPUT}
              value={v.code}
              onChange={set("code")}
              placeholder="U-101"
              maxLength={40}
              required
              {...inv("code")}
            />
            {err("code") ?? <span className={HINT}>Letters, digits and dashes</span>}
          </label>
        </div>
      </FormSection>

      <FormSection title="Layout" lede="Used to find the unit and to describe it to buyers.">
        <div className={S6}>
          <label className={`${FIELD} ${W2}`}>
            <span className={LABEL}>Type</span>
            <select className={INPUT} value={v.type} onChange={set("type")} {...inv("type")}>
              <option value="">Not set</option>
              {UNIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {UNIT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            {err("type")}
          </label>
          <label className={`${FIELD} ${W2}`}>
            <span className={LABEL}>Bedrooms</span>
            <input
              className={INPUT}
              value={v.bedrooms}
              onChange={set("bedrooms")}
              inputMode="numeric"
              {...inv("bedrooms")}
            />
            {err("bedrooms") ?? <span className={HINT}>0 is a studio</span>}
          </label>
          <label className={`${FIELD} ${W2}`}>
            <span className={LABEL}>Bathrooms</span>
            <input
              className={INPUT}
              value={v.bathrooms}
              onChange={set("bathrooms")}
              inputMode="numeric"
              {...inv("bathrooms")}
            />
            {err("bathrooms")}
          </label>
          <label className={`${FIELD} ${W2}`}>
            <span className={LABEL}>Internal area (sq ft)</span>
            <input
              className={INPUT}
              value={v.internalSqft}
              onChange={set("internalSqft")}
              inputMode="numeric"
              {...inv("internalSqft")}
            />
            {err("internalSqft")}
          </label>
          <label className={`${FIELD} ${W2}`}>
            <span className={LABEL}>Balcony (sq ft)</span>
            <input
              className={INPUT}
              value={v.balconySqft}
              onChange={set("balconySqft")}
              inputMode="numeric"
              {...inv("balconySqft")}
            />
            {err("balconySqft")}
          </label>
          <label className={`${FIELD} ${W1}`}>
            <span className={LABEL}>Floor</span>
            <input className={INPUT} value={v.floor} onChange={set("floor")} inputMode="numeric" {...inv("floor")} />
            {err("floor")}
          </label>
          <label className={`${FIELD} ${W1}`}>
            <span className={LABEL}>Parking</span>
            <input
              className={INPUT}
              value={v.parkingSpaces}
              onChange={set("parkingSpaces")}
              inputMode="numeric"
              {...inv("parkingSpaces")}
            />
            {err("parkingSpaces")}
          </label>
          <label className={`${FIELD} col-span-6`}>
            <span className={LABEL}>View</span>
            <input
              className={INPUT}
              value={v.view}
              onChange={set("view")}
              maxLength={60}
              placeholder="Marina"
              {...inv("view")}
            />
            {err("view")}
          </label>
        </div>
      </FormSection>

      <FormSection title="Description" lede="Shown on the unit page. Plain text, up to 2,000 characters.">
        <label className={FIELD}>
          <span className={LABEL}>Description</span>
          <textarea
            className={INPUT}
            value={v.description}
            onChange={set("description")}
            rows={5}
            maxLength={2000}
            {...inv("description")}
          />
          {err("description") ?? <span className={HINT}>{v.description.length} / 2000</span>}
        </label>
      </FormSection>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-5">
        <Button variant="ghost" size="sm" onClick={() => window.history.back()} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "Saving…" : mode === "create" ? "Create unit" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
