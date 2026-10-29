"use client";

import { useActionState } from "react";
import { IconWarning } from "../../../../../lib/icons";
import type { CompanyLegalView } from "../../../../../lib/types";
import type { RuleResult } from "../../../../../lib/portfolio";
import { saveCompanyLegal } from "../actions";
import { LegalFields } from "../legal-fields";

export function EditLegalForm({
  id,
  legal,
  canEdit,
}: {
  id: string;
  legal: CompanyLegalView["legal"];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<RuleResult, FormData>(saveCompanyLegal, {});
  return (
    <form action={action} className="panel panel-pad rule-form" noValidate>
      <input type="hidden" name="id" value={id} />
      {state.error && (
        <div className="alert" data-tone="bad" role="alert">
          <IconWarning size={16} />
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="alert" data-tone="good" role="status">
          Saved.
        </div>
      )}
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <LegalFields legal={legal} errors={state.fieldErrors} maskedId={!canEdit} />
      </fieldset>
      {canEdit ? (
        <div className="btn-row">
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? "Saving…" : "Save details"}
          </button>
        </div>
      ) : (
        <p className="muted">Only an admin can change these details. ID numbers are masked for your role.</p>
      )}
    </form>
  );
}
