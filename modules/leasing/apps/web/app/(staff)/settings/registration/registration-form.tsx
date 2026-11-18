"use client";

import { EMIRATE_LABELS, type Emirate } from "@leasing/core";
import { useActionState } from "react";
import { Button } from "@platform/ui/button";
import { FormAlert } from "@platform/ui/action-form";
import { CHECK_ROW, GRID6, Panel, SET_INPUT, SET_SELECT, SET_TEXTAREA, SField, SPAN } from "@platform/ui/settings";
import type { RuleResult } from "../../../../lib/portfolio";
import { useActionForm } from "@platform/ui/use-action-form";
import { saveFeePayer, saveRegistration } from "./actions";

export interface RegistrationRow {
  mode: "online" | "manual";
  portalName: string;
  portalUrl: string | null;
  instructions: string;
  requiredDocuments: string[];
  referenceExample: string;
  referencePattern: string;
  sources: string[];
  /** D74: names generic contract templates print (saved, else the emirate's default). */
  contractWording: {
    registrationSystem: string;
    registeringAuthority: string;
    governingLaw: string;
    disputeBody: string;
    utilityProvider: string;
  };
  /** D74: an admin saved the wording; until then the built-in default shows. */
  contractWordingSaved: boolean;
  source: "default" | "saved";
  forcedManual: boolean;
}

/** One item a checklist can include (engine `/api/registration-settings/document-options`, D62). */
export interface DocumentOption {
  key: string;
  label: string;
  group: "kyc_document" | "kyc_answer" | "other";
  companies?: string[];
}

const WORDING_FIELDS: { key: keyof RegistrationRow["contractWording"]; label: string; help: string }[] = [
  { key: "registrationSystem", label: "Registration system", help: "For example Ejari" },
  { key: "registeringAuthority", label: "Registering authority", help: "Who registers the contract" },
  { key: "governingLaw", label: "Governing law", help: 'Printed after "governed by"' },
  { key: "disputeBody", label: "Dispute body", help: 'Printed after "referred to"' },
  { key: "utilityProvider", label: "Utility provider", help: "Electricity and water, for example DEWA" },
];

const GROUPS: { group: DocumentOption["group"]; title: string; help: string }[] = [
  {
    group: "kyc_document",
    title: "From the applicant's KYC documents",
    help: "Verified uploads go into the pack PDF",
  },
  {
    group: "kyc_answer",
    title: "Applicant's answers to your KYC questions",
    help: "Printed in the pack as typed",
  },
  { group: "other", title: "Other documents", help: "The signed contract is attached; the rest the officer brings" },
];

export function RegistrationForm({
  emirate,
  row,
  options,
  canEdit,
  operated = true,
}: {
  emirate: string;
  row: RegistrationRow;
  options: DocumentOption[];
  canEdit: boolean;
  /** Some active company operates in this emirate. */
  operated?: boolean;
}) {
  // A saved item no company's form asks any more still shows, so it can be unticked.
  const known = new Set(options.map((o) => o.key));
  const all: DocumentOption[] = [
    ...options,
    ...row.requiredDocuments
      .filter((k) => !known.has(k))
      .map((k) => ({ key: k, label: `${k} (no longer on any KYC form)`, group: "other" as const })),
  ];
  const [state, action, pending] = useActionState<RuleResult, FormData>(saveRegistration, {});
  const form = useActionForm(action, { serverErrors: state.fieldErrors });
  const fe = form.fieldErrors;
  const inv = (k: string) => (fe[k] ? { "aria-invalid": true as const } : {});
  const ro = !canEdit;
  return (
    <Panel className="p-5">
      <form {...form.formProps} className="grid gap-4" noValidate>
        <FormAlert {...form.alertProps(state)} />
        <input type="hidden" name="emirate" value={emirate} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">
            {EMIRATE_LABELS[emirate as Emirate] ?? emirate}
          </h2>
          <span className="flex items-center gap-2">
            {!operated && <span className="text-xs text-muted">No company operates here</span>}
            <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">
              {row.source === "saved" ? "Saved" : "Default"}
            </span>
          </span>
        </div>
        {row.forcedManual && (
          <p className="m-0 text-[13px] text-muted">
            No registry connection exists for this emirate, so staff register by hand.
          </p>
        )}
        <div className={GRID6}>
          <SField label="Mode" error={fe.mode} className={SPAN[2]}>
            <select name="mode" defaultValue={row.mode} disabled={ro} className={SET_SELECT}>
              <option value="online">Online (registry connection)</option>
              <option value="manual">Manual (staff register by hand)</option>
            </select>
          </SField>
          <SField label="Portal name" error={fe.portalName} className={SPAN[2]}>
            <input
              name="portalName"
              defaultValue={row.portalName}
              maxLength={120}
              disabled={ro}
              className={SET_INPUT}
              {...inv("portalName")}
            />
          </SField>
          <SField label="Portal link (https)" error={fe.portalUrl} className={SPAN[2]}>
            <input
              name="portalUrl"
              defaultValue={row.portalUrl ?? ""}
              disabled={ro}
              className={SET_INPUT}
              {...inv("portalUrl")}
            />
          </SField>
          <SField
            label="Instructions"
            error={fe.instructions}
            help="Plain text, shown to the officer"
            className={SPAN[6]}
          >
            <textarea
              name="instructions"
              defaultValue={row.instructions}
              maxLength={2000}
              disabled={ro}
              className={SET_TEXTAREA}
              {...inv("instructions")}
            />
          </SField>
          <SField
            label="In the registration pack"
            help="Everything ticked is listed in the pack; files on record are attached to the one PDF"
            error={fe.requiredDocuments}
            as="div"
            className={SPAN[6]}
          >
            <div className="grid gap-3">
              {GROUPS.map(({ group, title, help }) => {
                const items = all.filter((o) => o.group === group);
                if (!items.length) return null;
                return (
                  <fieldset key={group} className="m-0 grid gap-1.5 border-0 p-0">
                    <legend className="mb-1 text-[12.5px] font-semibold text-ink">
                      {title} <span className="font-normal text-muted">· {help}</span>
                    </legend>
                    <div className={CHECK_ROW}>
                      {items.map((o) => (
                        <label
                          key={o.key}
                          title={o.companies?.length ? `Asked by ${o.companies.join(", ")}` : undefined}
                        >
                          <input
                            type="checkbox"
                            name="requiredDocuments"
                            value={o.key}
                            defaultChecked={row.requiredDocuments.includes(o.key)}
                            disabled={ro}
                          />
                          {o.label.replace(/^(Tenant document: |Applicant's answer: )/, "")}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </SField>
          <SField label="Reference example" error={fe.referenceExample} className={SPAN[3]}>
            <input
              name="referenceExample"
              defaultValue={row.referenceExample}
              maxLength={60}
              disabled={ro}
              className={SET_INPUT}
              {...inv("referenceExample")}
            />
          </SField>
          <SField
            label="Reference pattern"
            error={fe.referencePattern}
            help="Regular expression starting with ^ and ending with $"
            className={SPAN[3]}
          >
            <input
              name="referencePattern"
              defaultValue={row.referencePattern}
              maxLength={200}
              disabled={ro}
              className={`${SET_INPUT} font-mono`}
              {...inv("referencePattern")}
            />
          </SField>
          <div className={`${SPAN[6]} grid gap-1`}>
            <h3 className="m-0 flex items-center gap-2 font-sans text-[13px] font-semibold text-ink">
              Contract wording
              {!row.contractWordingSaved && (
                <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-normal text-muted">
                  Default — not yet confirmed
                </span>
              )}
            </h3>
            <p className="m-0 text-[12.5px] text-muted">Printed in generic templates. Confirm with legal.</p>
          </div>
          {WORDING_FIELDS.map((f) => (
            <SField
              key={f.key}
              label={f.label}
              help={f.help}
              error={fe[`contractWording.${f.key}`]}
              className={SPAN[3]}
            >
              <input
                name={`contractWording.${f.key}`}
                defaultValue={row.contractWording[f.key]}
                maxLength={200}
                disabled={ro}
                className={SET_INPUT}
                {...inv(`contractWording.${f.key}`)}
              />
            </SField>
          ))}
          <SField label="Sources" error={fe.sources} help="One per line" className={SPAN[6]}>
            <textarea name="sources" defaultValue={row.sources.join("\n")} disabled={ro} className={SET_TEXTAREA} />
          </SField>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {state.ok && <span className="text-[13px] text-muted">Saved.</span>}
          </div>
        )}
      </form>
    </Panel>
  );
}

/** Company-wide: who pays the government registration fee. Shown on the offer when the tenant pays. */
export function FeePayerForm({ value, canEdit }: { value: "tenant" | "landlord"; canEdit: boolean }) {
  const [state, action, pending] = useActionState<RuleResult, FormData>(saveFeePayer, {});
  const form = useActionForm(action, { serverErrors: state.fieldErrors });
  return (
    <Panel className="p-5">
      <form {...form.formProps} className="grid gap-4" noValidate>
        <FormAlert {...form.alertProps(state)} />
        <div className={GRID6}>
          <SField
            label="Who pays the registration fee"
            error={form.fieldErrors.registrationFeePaidBy}
            help="When the tenant pays, the offer shows the fee line"
            className={SPAN[2]}
          >
            <select name="registrationFeePaidBy" defaultValue={value} disabled={!canEdit} className={SET_SELECT}>
              <option value="tenant">Tenant</option>
              <option value="landlord">Landlord</option>
            </select>
          </SField>
        </div>
        {canEdit && (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {state.ok && <span className="text-[13px] text-muted">Saved.</span>}
          </div>
        )}
      </form>
    </Panel>
  );
}
