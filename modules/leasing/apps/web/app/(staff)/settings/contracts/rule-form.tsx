"use client";

import { type Emirate, EMIRATE_LABELS, EMIRATES } from "@leasing/core";
import type { EmirateTab } from "../../../../components/emirate-tabs";
import { type ReactNode, useActionState, useState } from "react";
import { RowAction } from "../../../../components/row-action";
import { PencilSimpleIcon as IconPencil, PlusIcon as IconPlus, TrashIcon as IconTrash } from "@phosphor-icons/react";
import { useActionForm } from "@platform/ui/use-action-form";
import { FormAlert } from "@platform/ui/action-form";
import { type Category, type RuleResult, subtypesFor, subtypesLabel, TENURE_LABEL } from "../../../../lib/portfolio";
import type { CompanyRow, ContractRuleRow } from "../../../../lib/types";
import { copyContractRule, removeContractRule, saveContractRule } from "./actions";
import { FIELD, LABEL } from "@platform/ui/form";
import { CopyToEmirate } from "../../../../components/copy-to-emirate";
import { BTN, CHECK_ROW, GRID6, SPAN, SET_INPUT, SET_SELECT } from "@platform/ui/settings";
import { Button, iconButtonClass } from "@platform/ui/button";

type ApprovedTemplates = { id: string; name: string; version: number; emirates: Emirate[] }[];

/** D68: templates a rule for `emirate` may use (an all-emirates rule may use any; other emirates fall back). */
const usableIn = (templates: ApprovedTemplates, emirate: Emirate | null) =>
  templates.filter((t) => emirate === null || t.emirates.length === 0 || t.emirates.includes(emirate));

const templateName = (t: ApprovedTemplates[number]) =>
  `${t.name} · v${t.version}${t.emirates.length ? ` (${t.emirates.map((e) => EMIRATE_LABELS[e]).join(", ")})` : ""}`;

function RuleEditor({
  rule,
  company,
  templates,
  category,
  emirate,
  onDone,
}: {
  rule?: ContractRuleRow;
  company: CompanyRow;
  templates: ApprovedTemplates;
  category: Category;
  emirate: EmirateTab;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<RuleResult, FormData>(async (prev, formData) => {
    const r = await saveContractRule(prev, formData);
    if (r.ok) onDone();
    return r;
  }, {});
  const form = useActionForm(action, { serverErrors: state.fieldErrors });
  const fe = form.fieldErrors;
  const err = (k: string) => (fe[k] ? <span className="text-xs text-danger">{fe[k]}</span> : null);
  const inv = (k: string) => (fe[k] ? { "aria-invalid": true as const } : {});
  return (
    <form {...form.formProps} className="grid gap-4" noValidate>
      <FormAlert {...form.alertProps(state)} />
      {rule && <input type="hidden" name="id" value={rule.id} />}
      {rule && <input type="hidden" name="clauseIds" value={rule.clauseIds.join(",")} />}
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="companyId" value={rule?.companyId ?? company.id} />
      <div className={GRID6}>
        <label className={`${FIELD} ${SPAN[2]}`}>
          <span className={LABEL}>Contract template</span>
          <select className={SET_SELECT} name="templateId" defaultValue={rule?.templateId ?? ""}>
            <option value="">Standard contract</option>
            {usableIn(templates, rule ? rule.emirate : emirate === "any" ? null : emirate).map((t) => (
              <option key={t.id} value={t.id}>
                {templateName(t)}
              </option>
            ))}
          </select>
          <a className="text-xs text-muted underline" href={`/settings/contract-templates?company=${company.id}`}>
            Upload or review templates
          </a>
        </label>
        {rule ? (
          <label className={`${FIELD} ${SPAN[2]}`}>
            <span className={LABEL}>Move to emirate</span>
            <select className={SET_SELECT} name="emirate" defaultValue={rule.emirate ?? ""} {...inv("emirate")}>
              <option value="">All emirates</option>
              {EMIRATES.filter((e) => company.emirates.includes(e) || e === rule.emirate).map((e) => (
                <option key={e} value={e}>
                  {EMIRATE_LABELS[e]}
                </option>
              ))}
            </select>
            {err("emirate")}
          </label>
        ) : (
          <input type="hidden" name="emirate" value={emirate === "any" ? "" : emirate} />
        )}
        <fieldset className={`${FIELD} ${SPAN[2]} m-0 min-w-0 border-0 p-0`}>
          <legend className={`${LABEL} p-0`}>
            Types <em>(none ticked = all types)</em>
          </legend>
          <div className={CHECK_ROW}>
            {subtypesFor(category).map((s) => (
              <label key={s.value}>
                <input
                  type="checkbox"
                  name="subtypes"
                  value={s.value}
                  defaultChecked={rule?.subtypes.includes(s.value) ?? false}
                />
                {s.label}
              </label>
            ))}
          </div>
          {err("subtypes")}
        </fieldset>
        <fieldset className={`${FIELD} ${SPAN[2]} m-0 min-w-0 border-0 p-0`}>
          <legend className={`${LABEL} p-0`}>Tenure</legend>
          <div className={CHECK_ROW}>
            {Object.entries(TENURE_LABEL).map(([v, l]) => (
              <label key={v}>
                <input
                  type="checkbox"
                  name="tenures"
                  value={v}
                  defaultChecked={rule ? rule.tenures.includes(v as "annual") : v === "annual"}
                />
                {l}
              </label>
            ))}
          </div>
          {err("tenures")}
        </fieldset>
        <label className={`${FIELD} ${SPAN[2]}`}>
          <span className={LABEL}>Fewest cheques</span>
          <input
            className={SET_INPUT}
            name="minCheques"
            inputMode="numeric"
            defaultValue={rule?.minCheques ?? 1}
            {...inv("minCheques")}
          />
          {err("minCheques")}
        </label>
        <label className={`${FIELD} ${SPAN[2]}`}>
          <span className={LABEL}>Most cheques</span>
          <input
            className={SET_INPUT}
            name="maxCheques"
            inputMode="numeric"
            defaultValue={rule?.maxCheques ?? 4}
            {...inv("maxCheques")}
          />
          {err("maxCheques")}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={BTN.primary} disabled={pending}>
          {pending ? "Saving…" : rule ? "Save changes" : "Save rule"}
        </button>
        <button type="button" className={BTN.ghost} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const templateLabel = (r: ContractRuleRow, templates: ApprovedTemplates) => {
  if (!r.templateId) return "Standard layout (no company template)";
  const t = templates.find((x) => x.id === r.templateId);
  return t ? templateName(t) : "Company template (not approved any more)";
};

export function ContractRules({
  rules,
  company,
  templates,
  category,
  emirate,
  canEdit,
  askAi,
}: {
  rules: ContractRuleRow[];
  company: CompanyRow;
  templates: ApprovedTemplates;
  category: Category;
  /** The emirate tab: new rules are made for it. */
  emirate: EmirateTab;
  canEdit: boolean;
  askAi?: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const closeAdd = () => setAdding(false);
  const closeEdit = () => setEditing(null);
  return (
    <section aria-labelledby="rules-h" className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="rules-h" className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">
            Contract rules
          </h2>
          <p className="m-0 mt-0.5 text-[13px] text-muted">
            Which tenures and how many cheques {company.name} allows, by unit type. One rule may cover several types.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {askAi}
          {canEdit && !adding && (
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              <IconPlus size={16} />
              Add rule
            </Button>
          )}
        </div>
      </div>
      {canEdit && adding && (
        <div className="rounded-card border border-line bg-page p-5">
          <RuleEditor company={company} templates={templates} category={category} emirate={emirate} onDone={closeAdd} />
        </div>
      )}
      <div className="min-w-0 rounded-card border border-line bg-page">
        {rules.length === 0 ? (
          <p className="m-0 p-5 text-sm text-muted">
            No {category} contract rules for {company.name} yet. Offers use the company defaults.
          </p>
        ) : (
          // A stacked list, not a wide table: it fits beside the preview and the agent panel without scrolling sideways.
          <ul className="m-0 list-none divide-y divide-line p-0">
            {rules.map((r) =>
              editing === r.id ? (
                <li key={r.id} className="p-5">
                  <RuleEditor
                    rule={r}
                    company={company}
                    templates={templates}
                    category={category}
                    emirate={emirate}
                    onDone={closeEdit}
                  />
                </li>
              ) : (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="grid min-w-0 gap-1.5">
                    <p className="m-0 text-sm font-semibold text-ink">{subtypesLabel(r.subtypes)}</p>
                    <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                      <div className="flex gap-1.5">
                        <dt className="text-muted">Tenure</dt>
                        <dd className="m-0">{r.tenures.map((t) => TENURE_LABEL[t] ?? t).join(", ")}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-muted">Cheques</dt>
                        <dd className="m-0 font-mono tabular-nums">
                          {r.minCheques} to {r.maxCheques}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-muted">Contract</dt>
                        <dd className="m-0">{templateLabel(r, templates)}</dd>
                      </div>
                    </dl>
                  </div>
                  {canEdit && (
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        className={iconButtonClass()}
                        aria-label={`Edit ${subtypesLabel(r.subtypes)} rule`}
                        title="Edit"
                        onClick={() => setEditing(r.id)}
                      >
                        <IconPencil size={16} />
                      </button>
                      <CopyToEmirate
                        action={copyContractRule}
                        id={r.id}
                        label={`Copy ${subtypesLabel(r.subtypes)} rule to another emirate`}
                        options={[
                          ...company.emirates.filter((e) => e !== r.emirate),
                          ...(r.emirate === null ? [] : ["" as const]),
                        ]}
                      />
                      <RowAction
                        action={removeContractRule}
                        fields={{ id: r.id }}
                        label={`Remove ${subtypesLabel(r.subtypes)} rule`}
                        icon={<IconTrash size={16} />}
                        danger
                        confirmText="Remove this rule? It stops applying to units straight away."
                      />
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
