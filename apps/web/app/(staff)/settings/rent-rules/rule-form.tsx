"use client";

import { useActionState, useState } from "react";
import { RowAction } from "../../../../components/row-action";
import { IconPlus, IconWarning } from "../../../../lib/icons";
import {
  aedInput,
  aedLimitsLabel,
  type Category,
  COMMUNITIES,
  pctInput,
  pctLabel,
  type RuleResult,
  subtypeLabel,
  subtypesFor,
} from "../../../../lib/portfolio";
import type { CompanyRow, RentRuleRow } from "../../../../lib/types";
import { removeRentRule, saveRentRule } from "./actions";

function RuleEditor({
  rule,
  company,
  category,
  onDone,
}: {
  rule?: RentRuleRow;
  company: CompanyRow;
  category: Category;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<RuleResult, FormData>(async (prev, formData) => {
    const r = await saveRentRule(prev, formData);
    if (r.ok) onDone();
    return r;
  }, {});
  const fe = state.fieldErrors ?? {};
  const err = (k: string) => (fe[k] ? <span className="err">{fe[k]}</span> : null);
  const inv = (k: string) => (fe[k] ? { "aria-invalid": true as const } : {});
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
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="companyId" value={rule?.companyId ?? company.id} />
      <div className="grid-fields">
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
        <label className="field span-3">
          <span className="field-label">Area</span>
          <input
            name="community"
            list="rule-communities"
            defaultValue={rule?.community ?? ""}
            maxLength={120}
            {...inv("community")}
          />
          <datalist id="rule-communities">
            {COMMUNITIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {err("community") ?? <span className="hint">Leave empty for all areas</span>}
        </label>
        <label className="field span-3">
          <span className="field-label">Lowest rent, percent of SRI</span>
          <span className="affix">
            <b>%</b>
            <input
              name="minPct"
              inputMode="decimal"
              defaultValue={rule ? pctInput(rule.minPctBp) : ""}
              {...inv("minPctBp")}
            />
          </span>
          {err("minPctBp") ?? <span className="hint">Relative to the SRI average, for example -5</span>}
        </label>
        <label className="field span-3">
          <span className="field-label">Highest rent, percent of SRI</span>
          <span className="affix">
            <b>%</b>
            <input
              name="maxPct"
              inputMode="decimal"
              defaultValue={rule ? pctInput(rule.maxPctBp) : ""}
              {...inv("maxPctBp")}
            />
          </span>
          {err("maxPctBp") ?? <span className="hint">For example 10</span>}
        </label>
        <label className="field span-3">
          <span className="field-label">
            Lowest rent in AED <em>(optional)</em>
          </span>
          <span className="affix">
            <b>AED</b>
            <input
              name="minRent"
              inputMode="numeric"
              defaultValue={rule ? aedInput(rule.minRentFils) : ""}
              {...inv("minRentFils")}
            />
          </span>
          {err("minRentFils")}
        </label>
        <label className="field span-3">
          <span className="field-label">
            Highest rent in AED <em>(optional)</em>
          </span>
          <span className="affix">
            <b>AED</b>
            <input
              name="maxRent"
              inputMode="numeric"
              defaultValue={rule ? aedInput(rule.maxRentFils) : ""}
              {...inv("maxRentFils")}
            />
          </span>
          {err("maxRentFils")}
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

export function RentRules({
  rules,
  company,
  category,
  canEdit,
}: {
  rules: RentRuleRow[];
  company: CompanyRow;
  category: Category;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const closeAdd = () => setAdding(false);
  const closeEdit = () => setEditing(null);
  return (
    <>
      {canEdit && (
        <div className="settings-add">
          {adding ? (
            <div className="panel panel-pad">
              <RuleEditor company={company} category={category} onDone={closeAdd} />
            </div>
          ) : (
            <button type="button" className="btn primary" onClick={() => setAdding(true)}>
              <IconPlus size={16} />
              Add rule
            </button>
          )}
        </div>
      )}
      <section className="panel">
        {rules.length === 0 ? (
          <p className="muted panel-pad">
            No {category} rent rules for {company.name} yet. Its units in this category can&apos;t get a price range
            until one is added.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Area</th>
                  <th>Band</th>
                  <th>AED limits</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {rules.map((r) =>
                  editing === r.id ? (
                    <tr key={r.id}>
                      <td colSpan={canEdit ? 5 : 4}>
                        <RuleEditor rule={r} company={company} category={category} onDone={closeEdit} />
                      </td>
                    </tr>
                  ) : (
                    <tr key={r.id}>
                      <td>{subtypeLabel(r.subtype)}</td>
                      <td>{r.community ?? "All areas"}</td>
                      <td className="num nowrap">
                        SRI {pctLabel(r.minPctBp)} to {pctLabel(r.maxPctBp)}
                      </td>
                      <td className="num nowrap">{aedLimitsLabel(r.minRentFils, r.maxRentFils)}</td>
                      {canEdit && (
                        <td className="nowrap">
                          <div className="btn-row">
                            <button type="button" className="btn small" onClick={() => setEditing(r.id)}>
                              Edit
                            </button>
                            <RowAction
                              action={removeRentRule}
                              fields={{ id: r.id }}
                              label="Remove"
                              danger
                              confirmText="Remove this rule? It stops applying to units straight away."
                            />
                          </div>
                        </td>
                      )}
                    </tr>
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
