"use client";

import { Fragment, useActionState, useState } from "react";
import { RowAction } from "../../../../components/row-action";
import { IconPlus, IconWarning } from "../../../../lib/icons";
import { type Category, type RuleResult, subtypeLabel, subtypesFor, TENURE_LABEL } from "../../../../lib/portfolio";
import type { CompanyRow, ContractRuleRow, RuleReview } from "../../../../lib/types";
import { ClauseReview, UploadSample } from "./clause-review";
import { removeContractRule, saveContractRule } from "./actions";

type ApprovedTemplates = Record<string, { id: string; version: number }[]>;

function RuleEditor({
  rule,
  companies,
  templates,
  category,
  onDone,
}: {
  rule?: ContractRuleRow;
  companies: CompanyRow[];
  templates: ApprovedTemplates;
  category: Category;
  onDone: () => void;
}) {
  const [companyId, setCompanyId] = useState(rule?.companyId ?? companies.find((c) => c.active)?.id ?? "");
  const approved = templates[companyId] ?? [];
  const [state, action, pending] = useActionState<RuleResult, FormData>(async (prev, formData) => {
    const r = await saveContractRule(prev, formData);
    if (r.ok) onDone();
    return r;
  }, {});
  const fe = state.fieldErrors ?? {};
  const err = (k: string) => (fe[k] ? <span className="err">{fe[k]}</span> : null);
  const inv = (k: string) => (fe[k] ? { "aria-invalid": true as const } : {});
  const choices = rule ? companies.filter((c) => c.id === rule.companyId) : companies.filter((c) => c.active);
  return (
    <form action={action} className="rule-form" noValidate>
      {state.error && (
        <div className="alert" data-tone="bad" role="alert">
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
      <div className="grid-fields">
        <label className="field span-3">
          <span className="field-label">Company</span>
          <select
            name="companyId"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            disabled={!!rule}
            required
          >
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-3">
          <span className="field-label">Contract template</span>
          <select name="templateId" defaultValue={rule?.templateId ?? ""} key={companyId}>
            <option value="">Standard contract</option>
            {approved.map((t) => (
              <option key={t.id} value={t.id}>
                Company template v{t.version}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-3">
          <span className="field-label">Type</span>
          <select name="subtype" defaultValue={rule?.subtype ?? ""}>
            <option value="">All types</option>
            {subtypesFor(category).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {err("subtype")}
        </label>
        <fieldset className="field span-2">
          <legend className="field-label">Tenure</legend>
          <div className="check-row">
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
        <label className="field">
          <span className="field-label">Fewest cheques</span>
          <input name="minCheques" inputMode="numeric" defaultValue={rule?.minCheques ?? 1} {...inv("minCheques")} />
          {err("minCheques")}
        </label>
        <label className="field">
          <span className="field-label">Most cheques</span>
          <input name="maxCheques" inputMode="numeric" defaultValue={rule?.maxCheques ?? 4} {...inv("maxCheques")} />
          {err("maxCheques")}
        </label>
      </div>
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Saving…" : rule ? "Save changes" : "Save rule"}
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const templateLabel = (r: ContractRuleRow, templates: ApprovedTemplates) => {
  if (!r.templateId) return "Standard layout (no company template)";
  const t = (templates[r.companyId] ?? []).find((x) => x.id === r.templateId);
  return t ? `Company template v${t.version}` : "Company template (not approved any more)";
};

export function ContractRules({
  rules,
  reviews,
  companies,
  templates,
  category,
  canEdit,
  templateReady = {},
}: {
  rules: ContractRuleRow[];
  /** Rule id to true when a company template was read from the rule's sample. */
  templateReady?: Record<string, boolean>;
  reviews: Record<string, RuleReview>;
  companies: CompanyRow[];
  templates: ApprovedTemplates;
  category: Category;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const nameOf = (id: string) => companies.find((c) => c.id === id)?.name ?? "Unknown company";
  const closeAdd = () => setAdding(false);
  const closeEdit = () => setEditing(null);
  return (
    <>
      {canEdit && (
        <div className="settings-add">
          {adding ? (
            <div className="panel panel-pad">
              <RuleEditor companies={companies} templates={templates} category={category} onDone={closeAdd} />
            </div>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => setAdding(true)}
              disabled={!companies.some((c) => c.active)}
            >
              <IconPlus size={16} />
              Add rule
            </button>
          )}
        </div>
      )}
      <section className="panel">
        {rules.length === 0 ? (
          <p className="muted panel-pad">No {category} contract rules yet. Offers use the company defaults.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Type</th>
                  <th>Tenure</th>
                  <th>Cheques</th>
                  <th>Contract</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {rules.map((r) =>
                  editing === r.id ? (
                    <tr key={r.id}>
                      <td colSpan={canEdit ? 6 : 5}>
                        <RuleEditor
                          rule={r}
                          companies={companies}
                          templates={templates}
                          category={category}
                          onDone={closeEdit}
                        />
                      </td>
                    </tr>
                  ) : (
                    <Fragment key={r.id}>
                      <tr>
                        <td>{nameOf(r.companyId)}</td>
                        <td>{subtypeLabel(r.subtype)}</td>
                        <td>{r.tenures.map((t) => TENURE_LABEL[t] ?? t).join(", ")}</td>
                        <td className="num nowrap">
                          {r.minCheques} to {r.maxCheques}
                        </td>
                        <td>{templateLabel(r, templates)}</td>
                        {canEdit && (
                          <td className="nowrap">
                            <div className="btn-row">
                              <UploadSample rule={r} />
                              <button type="button" className="btn small" onClick={() => setEditing(r.id)}>
                                Edit
                              </button>
                              <RowAction
                                action={removeContractRule}
                                fields={{ id: r.id }}
                                label="Remove"
                                danger
                                confirmText="Remove this rule? It stops applying to units straight away."
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                      {reviews[r.id]?.sample && (
                        <tr>
                          <td colSpan={canEdit ? 6 : 5}>
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
      </section>
    </>
  );
}
