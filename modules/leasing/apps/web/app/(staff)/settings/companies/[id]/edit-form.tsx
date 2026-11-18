"use client";

import { useActionState } from "react";
import { FormAlert } from "@platform/ui/action-form";
import { Button } from "@platform/ui/button";
import { Banner } from "@platform/ui/form";
import { SaveBar } from "@platform/ui/settings";
import type { Emirate, PropertyCategory } from "@leasing/core";
import { CategoriesField } from "../../../../../components/categories-field";
import { EmiratesField } from "../../../../../components/emirates-field";
import type { CompanyLegalView } from "../../../../../lib/types";
import { validateCompanyLegal } from "../../../../../lib/company-legal";
import type { RuleResult } from "../../../../../lib/portfolio";
import { useActionForm } from "@platform/ui/use-action-form";
import { saveCompanyCategories, saveCompanyEmirates, saveCompanyLegal } from "../actions";
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

export function EditEmiratesForm({ id, emirates, canEdit }: { id: string; emirates: Emirate[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState<RuleResult, FormData>(saveCompanyEmirates, {});
  const form = useActionForm(action, {
    validate: (fd) => (fd.getAll("emirates").length ? null : { emirates: "Pick at least one emirate." }),
    serverErrors: state.fieldErrors,
  });
  return (
    <form {...form.formProps} className="grid gap-3 rounded-card border border-line bg-page p-5" noValidate>
      <input type="hidden" name="id" value={id} />
      <h2 className="m-0 text-[15px] font-semibold">Operates in</h2>
      <p className="m-0 text-[13px] text-muted">
        Units, rent rules and contract rules can only use these emirates. An emirate that still has units or active
        rules can't be removed.
      </p>
      <FormAlert {...form.alertProps(state)} />
      {state.ok && !form.pending && !form.clientFailed && (
        <Banner tone="good" role="status">
          Saved.
        </Banner>
      )}
      <fieldset disabled={!canEdit} className="m-0 min-w-0 border-0 p-0">
        <EmiratesField selected={emirates} error={form.fieldErrors.emirates} />
      </fieldset>
      {canEdit && (
        <SaveBar>
          <Button type="submit" variant="primary" size="sm" disabled={pending || form.pending}>
            {pending || form.pending ? "Saving…" : "Save emirates"}
          </Button>
        </SaveBar>
      )}
    </form>
  );
}

export function EditCategoriesForm({
  id,
  categories,
  canEdit,
}: {
  id: string;
  categories: PropertyCategory[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<RuleResult, FormData>(saveCompanyCategories, {});
  const form = useActionForm(action, {
    validate: (fd) => (fd.getAll("categories").length ? null : { categories: "Pick at least one property type." }),
    serverErrors: state.fieldErrors,
  });
  return (
    <form {...form.formProps} className="grid gap-3 rounded-card border border-line bg-page p-5" noValidate>
      <input type="hidden" name="id" value={id} />
      <h2 className="m-0 text-[15px] font-semibold">Offers for lease</h2>
      <p className="m-0 text-[13px] text-muted">
        Units, rent rules and contract rules can only use these property types. A type that still has units or active
        rules can't be removed.
      </p>
      <FormAlert {...form.alertProps(state)} />
      {state.ok && !form.pending && !form.clientFailed && (
        <Banner tone="good" role="status">
          Saved.
        </Banner>
      )}
      <fieldset disabled={!canEdit} className="m-0 min-w-0 border-0 p-0">
        <CategoriesField selected={categories} error={form.fieldErrors.categories} />
      </fieldset>
      {canEdit && (
        <SaveBar>
          <Button type="submit" variant="primary" size="sm" disabled={pending || form.pending}>
            {pending || form.pending ? "Saving…" : "Save property types"}
          </Button>
        </SaveBar>
      )}
    </form>
  );
}
