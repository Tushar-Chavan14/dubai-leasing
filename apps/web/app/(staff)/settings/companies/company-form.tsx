"use client";

import { useActionState, useState } from "react";
import { IconPlus, IconWarning } from "../../../../lib/icons";
import { KIND_LABEL, type RuleResult } from "../../../../lib/portfolio";
import { createCompany } from "./actions";
import { LegalFields } from "./legal-fields";

export function CompanyForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<RuleResult, FormData>(async (prev, formData) => {
    const r = await createCompany(prev, formData);
    if (r.ok) setOpen(false);
    return r;
  }, {});
  if (!open)
    return (
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>
        <IconPlus size={16} />
        Add company
      </button>
    );
  const nameErr = state.fieldErrors?.name;
  return (
    <form action={action} className="panel panel-pad rule-form" noValidate>
      {state.error && !nameErr && (
        <div className="alert" data-tone="bad" role="alert">
          <IconWarning size={16} />
          {state.error}
        </div>
      )}
      <h3 className="section-title">Company</h3>
      <div className="grid-fields">
        <label className="field span-3">
          <span className="field-label">Company name</span>
          <input name="name" required maxLength={120} {...(nameErr ? { "aria-invalid": true } : {})} />
          {nameErr && <span className="err">{nameErr}</span>}
        </label>
        <label className="field span-3">
          <span className="field-label">Kind</span>
          <select name="kind" defaultValue="realty">
            {Object.entries(KIND_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <LegalFields legal={{}} errors={state.fieldErrors} />
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Saving…" : "Save company"}
        </button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
