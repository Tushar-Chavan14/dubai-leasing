"use client";

import { useActionState } from "react";
import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { Button } from "../../../../../components/ui/button";
import { Banner } from "../../../../../components/ui/form";
import { SaveBar } from "../../../../../components/ui/settings";
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
    <form action={action} className="grid gap-6" noValidate>
      <input type="hidden" name="id" value={id} />
      {state.error && (
        <Banner tone="bad" role="alert">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          {state.error}
        </Banner>
      )}
      {state.ok && (
        <Banner tone="good" role="status">
          Saved.
        </Banner>
      )}
      <fieldset disabled={!canEdit} className="m-0 grid min-w-0 gap-6 border-0 p-0">
        <LegalFields legal={legal} errors={state.fieldErrors} maskedId={!canEdit} />
      </fieldset>
      {canEdit ? (
        <SaveBar note="Saving updates the details used in new contracts and Ejari submissions.">
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save details"}
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
