import { Button } from "@platform/ui/button";
import { ROW_LINK, TableFrame } from "@platform/ui/page";
import { Pill } from "@platform/ui/pill";
import { Fact, FactGrid, Section, Sub } from "@platform/ui/record";
import {
  Block,
  CHECK_ROW,
  FormGrid,
  Note,
  Preview,
  SaveBar,
  SET_INPUT,
  SET_SELECT,
  SField,
  TABLE,
  TD,
  TH,
} from "@platform/ui/settings";
import type { SpaKycConfig } from "@spa/core";
import Link from "next/link";
import type { KycDetail, KycIndex } from "../lib/contracts";
import { shortDate } from "../lib/format";

type Action = (f: FormData) => void | Promise<void>;

export const KYC_ROLE_WORDS: Record<string, string> = {
  buyer_person: "Buyer (a person)",
  seller_person: "Seller (a person)",
  company_party: "Company",
  beneficial_owner: "Company owner",
};
const DEAL_WORDS: Record<string, string> = {
  primary_offplan: "Primary off-plan",
  resale_ready: "Ready resale",
  resale_offplan: "Off-plan resale",
};
const SEVERITY_WORDS = { off: "Off", warning: "Warn", blocker: "Block" } as const;
const CROSS_WORDS: Record<string, string> = {
  required_documents: "Every required document is there",
  names_consistent: "The name is the same on every document",
  name_matches_deal: "The name matches the deal",
};
const TYPE_WORDS: Record<string, string> = {
  text: "Short text",
  textarea: "Long text",
  select: "Choice",
  date: "Date",
  number: "Number",
  document: "Document upload",
  email: "Email",
  phone: "Phone",
  checkbox: "Tick box",
};

/** Every party role with its deal-type overrides: what is in force, and whether a draft waits. */
export function KycIndexTable({ items }: { items: KycIndex["items"] }) {
  const roles = [...new Set(items.map((i) => i.role))];
  const cell = (role: string, dealType: string | null) => {
    const i = items.find((x) => x.role === role && x.dealType === dealType);
    if (!i) return null;
    const href = `/settings/kyc/${role}${dealType ? `?dealType=${dealType}` : ""}`;
    return (
      <Link href={href} className={ROW_LINK}>
        {i.version ? `Version ${i.version}` : dealType ? "Uses the general form" : "Starter form"}
        {i.hasDraft && (
          <Pill tone="waiting" className="ml-2">
            Draft waiting
          </Pill>
        )}
      </Link>
    );
  };
  return (
    <TableFrame>
      <table className={TABLE}>
        <caption className="sr-only">KYC forms</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Who fills it in
            </th>
            <th scope="col" className={TH}>
              Every deal
            </th>
            {Object.entries(DEAL_WORDS).map(([k, w]) => (
              <th key={k} scope="col" className={TH}>
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r} className="group">
              <td className={TD}>{KYC_ROLE_WORDS[r] ?? r}</td>
              <td className={TD}>{cell(r, null)}</td>
              {Object.keys(DEAL_WORDS).map((d) => (
                <td key={d} className={TD}>
                  {cell(r, d)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

/** The form as the party sees it: each field with its label, help and required mark. Nothing is submitted from here. */
export function PartyFormPreview({ config }: { config: SpaKycConfig }) {
  return (
    <ol className="m-0 grid list-none gap-3 p-0" aria-label="The form as the party sees it">
      {config.form.map((f) => (
        <li key={f.key} className="grid gap-1">
          <span className="text-sm font-semibold text-ink">
            {f.label}
            {f.required ? (
              <span className="text-danger"> *</span>
            ) : (
              <span className="font-normal text-muted"> (optional)</span>
            )}
          </span>
          {f.type === "document" ? (
            <span className="rounded-input border border-dashed border-line px-3 py-2 text-sm text-muted">
              Choose a file to upload
            </span>
          ) : f.type === "select" ? (
            <span className="rounded-input border border-line px-3 py-2 text-sm text-muted">
              {f.options.length ? f.options.join(" · ") : "Choose one"}
            </span>
          ) : (
            <span className="rounded-input border border-line px-3 py-2 text-sm text-muted">
              {f.placeholder || " "}
            </span>
          )}
          {f.help && <span className="text-xs text-muted">{f.help}</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * One KYC form (S41, S66): the draft if there is one, else the form in force. An admin edits the labels, help, required
 * flags, the confidence bar and the three cross-checks, then saves a draft and publishes it as the next version. A
 * published version is read-only: a change is always a new draft. Custom rules are listed, not edited here.
 */
export function KycEditor({
  d,
  canEdit,
  save,
  publish,
}: {
  d: KycDetail;
  canEdit: boolean;
  save: Action;
  publish: Action;
}) {
  const config = d.draft ?? d.effective.config;
  const target = (
    <>
      <input type="hidden" name="role" value={d.role} />
      <input type="hidden" name="dealType" value={d.dealType ?? ""} />
    </>
  );
  const inForce =
    d.effective.version === 0
      ? "the starter form (never published)"
      : `version ${d.effective.version}${d.effective.scope !== d.scope ? ` of the general form` : ""}`;
  return (
    <div className="grid gap-6">
      <FactGrid>
        <Fact label="Who fills it in">{KYC_ROLE_WORDS[d.role] ?? d.role}</Fact>
        <Fact label="Applies to">{d.dealType ? `${DEAL_WORDS[d.dealType]} deals only` : "Every deal type"}</Fact>
        <Fact label="In force">{inForce}</Fact>
        <Fact label="Draft">{d.draft ? "Waiting to be published" : "None"}</Fact>
      </FactGrid>
      <FormGrid
        preview={
          <Preview
            title="The form as the party sees it"
            lede={d.draft ? "This is the draft." : "This is the form in force."}
          >
            <PartyFormPreview config={config} />
          </Preview>
        }
      >
        <form action={save} className="grid gap-6">
          {target}
          <Block
            title="Fields"
            lede={
              canEdit
                ? "Change the words and whether a field is required. Keys, types and options stay as they are."
                : "Published versions are read-only."
            }
          >
            <TableFrame>
              <table className={TABLE}>
                <caption className="sr-only">Fields</caption>
                <thead>
                  <tr>
                    {["Label", "Type", "Help text", "Required"].map((c) => (
                      <th key={c} scope="col" className={TH}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {config.form.map((f) => (
                    <tr key={f.key} className="group">
                      <td className={TD}>
                        <input
                          name={`label_${f.key}`}
                          defaultValue={f.label}
                          disabled={!canEdit}
                          maxLength={80}
                          aria-label={`Label for ${f.label}`}
                          className={SET_INPUT}
                        />
                      </td>
                      <td className={TD}>
                        {TYPE_WORDS[f.type] ?? f.type}
                        {f.type === "document" && f.documentKind && <Sub>{f.documentKind.replace(/_/g, " ")}</Sub>}
                      </td>
                      <td className={TD}>
                        <input
                          name={`help_${f.key}`}
                          defaultValue={f.help}
                          disabled={!canEdit}
                          maxLength={200}
                          aria-label={`Help for ${f.label}`}
                          className={SET_INPUT}
                        />
                      </td>
                      <td className={TD}>
                        <input
                          type="checkbox"
                          name={`required_${f.key}`}
                          defaultChecked={f.required}
                          disabled={!canEdit}
                          aria-label={`${f.label} is required`}
                          className="size-4 accent-primary"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          </Block>
          <Block
            title="Checks across documents"
            lede="Run by code. A check can warn or block; it never decides for a person."
          >
            <div className="grid gap-3">
              <SField
                label="Smallest confidence the reader may report"
                help="Between 0.5 and 1. Below it, a read is held for a person."
              >
                <input
                  name="minConfidence"
                  defaultValue={String(config.rules.minConfidence)}
                  disabled={!canEdit}
                  inputMode="decimal"
                  className={`${SET_INPUT} max-w-32`}
                />
              </SField>
              {(Object.keys(CROSS_WORDS) as (keyof typeof CROSS_WORDS)[]).map((k) => {
                const s = config.rules.cross[k as keyof typeof config.rules.cross];
                return (
                  <div key={k} className={CHECK_ROW}>
                    <span className="min-w-60 flex-1">{CROSS_WORDS[k]}</span>
                    <select
                      name={`cross_${k}`}
                      defaultValue={s.severity}
                      disabled={!canEdit}
                      aria-label={CROSS_WORDS[k]}
                      className={SET_SELECT}
                    >
                      {Object.entries(SEVERITY_WORDS).map(([v, w]) => (
                        <option key={v} value={v}>
                          {w}
                        </option>
                      ))}
                    </select>
                    <label>
                      <input
                        type="checkbox"
                        name={`cross_email_${k}`}
                        defaultChecked={s.emailApplicant}
                        disabled={!canEdit}
                      />
                      Email the person
                    </label>
                  </div>
                );
              })}
            </div>
          </Block>
          <Block
            title="Custom rules"
            lede="Listed here as they are in the form. Rules are checked by code; a model check can only warn."
          >
            {config.rules.company.length === 0 ? (
              <Note>No custom rules.</Note>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {config.rules.company.map((r, i) => (
                  <li key={i} className="rounded-xl border border-line px-3.5 py-2.5 text-sm">
                    <Pill tone={r.severity === "blocker" ? "danger" : "warning"}>
                      {r.severity === "blocker" ? "Blocks" : "Warns"}
                    </Pill>{" "}
                    {r.label}
                  </li>
                ))}
              </ul>
            )}
          </Block>
          {canEdit && (
            <SaveBar note="Saving makes a draft. Nothing changes for parties until you publish it.">
              <Button type="submit" variant="primary" size="sm">
                Save draft
              </Button>
            </SaveBar>
          )}
        </form>
        {canEdit && d.draft && (
          <form action={publish} className="flex flex-wrap items-center gap-3">
            {target}
            <Button type="submit" variant="ghost" size="sm">
              Publish the draft as the next version
            </Button>
            <Note>Published versions never change. Deals keep reading the version they started with.</Note>
          </form>
        )}
      </FormGrid>
      <Section id="versions" title="Published versions" hint="Read-only">
        {d.versions.length === 0 ? (
          <p className="m-0 text-sm text-muted">None yet. The starter form is in force.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0 text-sm">
            {d.versions.map((v) => (
              <li key={v.version}>
                Version {v.version}
                {v.publishedAt ? `, published ${shortDate(v.publishedAt)}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
