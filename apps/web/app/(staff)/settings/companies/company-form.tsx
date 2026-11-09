"use client";

import { useActionState, useState } from "react";
import { PlusIcon as IconPlus } from "@phosphor-icons/react";
import { FormAlert } from "../../../../components/ui/action-form";
import { Button } from "../../../../components/ui/button";
import { Block, GRID6, SaveBar, SET_INPUT, SET_SELECT, SField, SPAN } from "../../../../components/ui/settings";
import { validateCompanyCreate } from "../../../../lib/company-legal";
import { KIND_LABEL, type RuleResult } from "../../../../lib/portfolio";
import { useActionForm } from "../../../../lib/use-action-form";
import { createCompany } from "./actions";
import { LegalFields } from "./legal-fields";

export function CompanyForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<RuleResult, FormData>(async (prev, formData) => {
    const r = await createCompany(prev, formData);
    if (r.ok) setOpen(false);
    return r;
  }, {});
  const form = useActionForm(action, { validate: validateCompanyCreate, serverErrors: state.fieldErrors });
  if (!open)
    return (
      <div>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <IconPlus size={16} />
          Add company
        </Button>
      </div>
    );
  const errors = form.fieldErrors;
  const nameErr = errors.name;
  return (
    <form {...form.formProps} className="grid gap-6 rounded-card border border-line bg-page p-5" noValidate>
      <FormAlert {...form.alertProps(state)} />
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
          <SField label="Kind" error={errors.kind} className={SPAN[3]}>
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
      <LegalFields legal={{}} errors={errors} />
      <SaveBar>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={pending || form.pending}>
          {pending || form.pending ? "Saving…" : "Save company"}
        </Button>
      </SaveBar>
    </form>
  );
}
