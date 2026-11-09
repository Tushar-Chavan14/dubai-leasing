"use client";

import { useActionState } from "react";
import { FormAlert } from "../../../../../components/ui/action-form";
import { Button } from "../../../../../components/ui/button";
import { Banner } from "../../../../../components/ui/form";
import { SaveBar } from "../../../../../components/ui/settings";
import type { CompanyLegalView } from "../../../../../lib/types";
import { validateCompanyLegal } from "../../../../../lib/company-legal";
import type { RuleResult } from "../../../../../lib/portfolio";
import { useActionForm } from "../../../../../lib/use-action-form";
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
  const form = useActionForm(action, { validate: validateCompanyLegal, serverErrors: state.fieldErrors });
  return (
    <form {...form.formProps} className="grid gap-6" noValidate>
      <input type="hidden" name="id" value={id} />
      <FormAlert {...form.alertProps(state)} />
      {state.ok && !form.pending && !form.clientFailed && (
        <Banner tone="good" role="status">
          Saved.
        </Banner>
      )}
      <fieldset disabled={!canEdit} className="m-0 grid min-w-0 gap-6 border-0 p-0">
        <LegalFields legal={legal} errors={form.fieldErrors} maskedId={!canEdit} />
      </fieldset>
      {canEdit ? (
        <SaveBar note="Saving updates the details used in new contracts and Ejari submissions.">
          <Button type="submit" variant="primary" size="sm" disabled={pending || form.pending}>
            {pending || form.pending ? "Saving…" : "Save details"}
          </Button>
        </SaveBar>
      ) : (
        <p className="m-0 text-[13px] text-muted">
          Only an admin can change these details. ID numbers are masked for your role.
        </p>
      )}
    </form>
  );
}
