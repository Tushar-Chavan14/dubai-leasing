"use client";

import { useActionState, useState } from "react";
import { PlusIcon as IconPlus, WarningIcon as IconWarning } from "@phosphor-icons/react";
import { Button } from "../../../../components/ui/button";
import { Banner } from "../../../../components/ui/form";
import { Block, GRID6, SaveBar, SET_INPUT, SET_SELECT, SField, SPAN } from "../../../../components/ui/settings";
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
      <div>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <IconPlus size={16} />
          Add company
        </Button>
      </div>
    );
  const nameErr = state.fieldErrors?.name;
  return (
    <form action={action} className="grid gap-6 rounded-card border border-line bg-page p-5" noValidate>
      {state.error && !nameErr && (
        <Banner tone="bad" role="alert">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          {state.error}
        </Banner>
      )}
      <Block title="Company" lede="The name staff see everywhere, and what kind of company it is.">
        <div className={GRID6}>
          <SField label="Company name" error={nameErr} className={SPAN[3]}>
            <input
              name="name"
              required
              maxLength={120}
              className={SET_INPUT}
              {...(nameErr ? { "aria-invalid": true } : {})}
            />
          </SField>
          <SField label="Kind" className={SPAN[3]}>
            <select name="kind" defaultValue="realty" className={SET_SELECT}>
              {Object.entries(KIND_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </SField>
        </div>
      </Block>
      <LegalFields legal={{}} errors={state.fieldErrors} />
      <SaveBar>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save company"}
        </Button>
      </SaveBar>
    </form>
  );
}
