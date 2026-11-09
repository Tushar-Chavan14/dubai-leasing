"use client";

import { Fragment, type ReactNode, useActionState, useState } from "react";
import { RowAction } from "../../../../components/row-action";
import {
  PencilSimpleIcon as IconPencil,
  PlusIcon as IconPlus,
  TrashIcon as IconTrash,
  WarningIcon as IconWarning,
} from "@phosphor-icons/react";
import { type Category, type RuleResult, subtypeLabel, subtypesFor, TENURE_LABEL } from "../../../../lib/portfolio";
import type { CompanyRow, ContractRuleRow, RuleReview } from "../../../../lib/types";
import { ClauseReview, UploadSample } from "./clause-review";
import { removeContractRule, saveContractRule } from "./actions";
import { FIELD, LABEL } from "../../../../components/ui/form";
import {
  ALERT,
  BTN,
  CHECK_ROW,
  GRID6,
  SPAN,
  SET_INPUT,
  SET_SELECT,
  TABLE,
  TD,
  TH,
} from "../../../../components/ui/settings";
import { Button, iconButtonClass } from "../../../../components/ui/button";

type ApprovedTemplates = { id: string; version: number }[];

function RuleEditor({
  rule,
  company,
  templates,
  category,
  onDone,
}: {
  rule?: ContractRuleRow;
  company: CompanyRow;
  templates: ApprovedTemplates;
  category: Category;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<RuleResult, FormData>(async (prev, formData) => {
    const r = await saveContractRule(prev, formData);
    if (r.ok) onDone();
    return r;
  }, {});
  const fe = state.fieldErrors ?? {};
  const err = (k: string) => (fe[k] ? <span className="text-xs text-danger">{fe[k]}</span> : null);
  const inv = (k: string) => (fe[k] ? { "aria-invalid": true as const } : {});
  return (
    <form action={action} className="grid gap-4" noValidate>
      {state.error && (
        <div className={ALERT.bad} role="alert">
          <IconWarning size={16} />
          <div>
            <strong>{state.error}</strong>
            {state.reasons && state.reasons.length > 0 && (
              <ul>
                {state.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {rule && <input type="hidden" name="id" value={rule.id} />}
      {rule && <input type="hidden" name="clauseIds" value={rule.clauseIds.join(",")} />}
      {rule?.sampleDocumentId && <input type="hidden" name="sampleDocumentId" value={rule.sampleDocumentId} />}
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="companyId" value={rule?.companyId ?? company.id} />
      <div className={GRID6}>
        <label className={`${FIELD} ${SPAN[3]}`}>
          <span className={LABEL}>Contract template</span>
          <select className={SET_SELECT} name="templateId" defaultValue={rule?.templateId ?? ""}>
            <option value="">Standard contract</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                Company template v{t.version}
              </option>
            ))}
          </select>
        </label>
        <label className={`${FIELD} ${SPAN[3]}`}>
          <span className={LABEL}>Type</span>
          <select className={SET_SELECT} name="subtype" defaultValue={rule?.subtype ?? ""}>
            <option value="">All types</option>
            {subtypesFor(category).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {err("subtype")}
        </label>
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
  return t ? `Company template v${t.version}` : "Company template (not approved any more)";
};

export function ContractRules({
  rules,
  reviews,
  company,
  templates,
  category,
  canEdit,
  templateReady = {},
  askAi,
}: {
  rules: ContractRuleRow[];
  /** Rule id to true when a company template was read from the rule's sample. */
  templateReady?: Record<string, boolean>;
  reviews: Record<string, RuleReview>;
  company: CompanyRow;
  templates: ApprovedTemplates;
  category: Category;
  canEdit: boolean;
  askAi?: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const closeAdd = () => setAdding(false);
  const closeEdit = () => setEditing(null);
  return (
    <section aria-labelledby="rules-h" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="rules-h" className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">
            Contract rules
          </h2>
          <p className="m-0 mt-0.5 text-[13px] text-muted">
            Which tenures and how many cheques {company.name} allows, by unit type.
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
          <RuleEditor company={company} templates={templates} category={category} onDone={closeAdd} />
        </div>
      )}
      <div className="rounded-card border border-line bg-page">
        {rules.length === 0 ? (
          <p className="m-0 p-5 text-sm text-muted">
            No {category} contract rules for {company.name} yet. Offers use the company defaults.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Type</th>
                  <th className={TH}>Tenure</th>
                  <th className={TH}>Cheques</th>
                  <th className={TH}>Contract</th>
                  {canEdit && <th className={TH} />}
                </tr>
              </thead>
              <tbody>
                {rules.map((r) =>
                  editing === r.id ? (
                    <tr key={r.id} className="group">
                      <td className={TD} colSpan={canEdit ? 5 : 4}>
                        <RuleEditor
                          rule={r}
                          company={company}
                          templates={templates}
                          category={category}
                          onDone={closeEdit}
                        />
                      </td>
                    </tr>
                  ) : (
                    <Fragment key={r.id}>
                      <tr className="group">
                        <td className={`${TD} whitespace-nowrap font-semibold`}>{subtypeLabel(r.subtype)}</td>
                        <td className={TD}>{r.tenures.map((t) => TENURE_LABEL[t] ?? t).join(", ")}</td>
                        <td className={`${TD} whitespace-nowrap font-mono tabular-nums`}>
                          {r.minCheques} to {r.maxCheques}
                        </td>
                        <td className={TD}>{templateLabel(r, templates)}</td>
                        {canEdit && (
                          <td className={`${TD} whitespace-nowrap`}>
                            <div className="flex items-start gap-2">
                              <UploadSample rule={r} label="Upload sample" />
                              <button
                                type="button"
                                className={iconButtonClass()}
                                aria-label={`Edit ${subtypeLabel(r.subtype)} rule`}
                                title="Edit"
                                onClick={() => setEditing(r.id)}
                              >
                                <IconPencil size={16} />
                              </button>
                              <RowAction
                                action={removeContractRule}
                                fields={{ id: r.id }}
                                label={`Remove ${subtypeLabel(r.subtype)} rule`}
                                icon={<IconTrash size={16} />}
                                danger
                                confirmText="Remove this rule? It stops applying to units straight away."
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                      {reviews[r.id]?.sample && (
                        <tr className="group">
                          <td className={TD} colSpan={canEdit ? 5 : 4}>
                            <ClauseReview
                              rule={r}
                              review={reviews[r.id]}
                              canEdit={canEdit}
                              templateReady={templateReady[r.id] === true}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
