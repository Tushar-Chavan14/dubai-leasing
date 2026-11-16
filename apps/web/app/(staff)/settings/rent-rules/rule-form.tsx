"use client";

import { EMIRATE_LABELS, EMIRATES } from "@leasing/core";
import { useActionState, useState, type ReactNode } from "react";
import { RowAction } from "../../../../components/row-action";
import { PencilSimpleIcon as IconPencil, PlusIcon as IconPlus, TrashIcon as IconTrash } from "@phosphor-icons/react";
import { Button, iconButtonClass } from "../../../../components/ui/button";
import { FormAlert } from "../../../../components/ui/action-form";
import {
  Affix,
  FormGrid,
  GRID6,
  Panel,
  SET_INPUT,
  SET_SELECT,
  SField,
  SPAN,
  CHECK_ROW,
} from "../../../../components/ui/settings";
import {
  aedInput,
  aedLimitsLabel,
  type Category,
  COMMUNITIES,
  pctInput,
  pctLabel,
  type RuleResult,
  subtypesFor,
  subtypesLabel,
} from "../../../../lib/portfolio";
import { CopyToEmirate } from "../../../../components/copy-to-emirate";
import { useActionForm } from "../../../../lib/use-action-form";
import type { CompanyRow, RentRuleRow } from "../../../../lib/types";
import { copyRentRule, removeRentRule, saveRentRule } from "./actions";
import { RentTry } from "./rent-try";

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
  const form = useActionForm(action, { serverErrors: state.fieldErrors });
  const fe = form.fieldErrors;
  const inv = (k: string) => (fe[k] ? { "aria-invalid": true as const } : {});
  return (
    <form {...form.formProps} className="grid gap-4" noValidate>
      <FormAlert {...form.alertProps(state)} />
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="companyId" value={rule?.companyId ?? company.id} />
      <div className={GRID6}>
        <fieldset className={`${SPAN[3]} m-0 grid min-w-0 gap-1.5 border-0 p-0`}>
          <legend className="p-0 text-[13px] font-semibold text-ink">
            Types <em className="font-normal text-muted">(none ticked = all types)</em>
          </legend>
          <div className={CHECK_ROW}>
            {subtypesFor(category).map((s) => (
              <label key={s.value}>
                <input
                  type="checkbox"
                  name="subtypes"
                  value={s.value}
                  defaultChecked={rule?.subtypes.includes(s.value) ?? false}
                />
                {s.label}
              </label>
            ))}
          </div>
          {fe.subtypes && <span className="text-xs text-danger">{fe.subtypes}</span>}
        </fieldset>
        <SField label="Emirate" error={fe.emirate} className={SPAN[3]}>
          <select name="emirate" defaultValue={rule?.emirate ?? company.emirates[0] ?? "dubai"} className={SET_SELECT}>
            {EMIRATES.filter((e) => company.emirates.includes(e) || e === rule?.emirate).map((e) => (
              <option key={e} value={e}>
                {EMIRATE_LABELS[e]}
              </option>
            ))}
          </select>
        </SField>
        <SField label="Area" error={fe.community} help="Leave empty for all areas" className={SPAN[3]}>
          <input
            name="community"
            list="rule-communities"
            defaultValue={rule?.community ?? ""}
            maxLength={120}
            className={SET_INPUT}
            {...inv("community")}
          />
          <datalist id="rule-communities">
            {COMMUNITIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </SField>
        <SField
          label="Lowest rent, percent of SRI"
          error={fe.minPctBp}
          help="Relative to the SRI average, for example -5"
          className={SPAN[3]}
        >
          <Affix unit="%">
            <input
              name="minPct"
              inputMode="decimal"
              defaultValue={rule ? pctInput(rule.minPctBp) : ""}
              {...inv("minPctBp")}
            />
          </Affix>
        </SField>
        <SField label="Highest rent, percent of SRI" error={fe.maxPctBp} help="For example 10" className={SPAN[3]}>
          <Affix unit="%">
            <input
              name="maxPct"
              inputMode="decimal"
              defaultValue={rule ? pctInput(rule.maxPctBp) : ""}
              {...inv("maxPctBp")}
            />
          </Affix>
        </SField>
        <SField label="Lowest rent in AED (optional)" error={fe.minRentFils} className={SPAN[3]}>
          <Affix unit="AED">
            <input
              name="minRent"
              inputMode="numeric"
              defaultValue={rule ? aedInput(rule.minRentFils) : ""}
              {...inv("minRentFils")}
            />
          </Affix>
        </SField>
        <SField label="Highest rent in AED (optional)" error={fe.maxRentFils} className={SPAN[3]}>
          <Affix unit="AED">
            <input
              name="maxRent"
              inputMode="numeric"
              defaultValue={rule ? aedInput(rule.maxRentFils) : ""}
              {...inv("maxRentFils")}
            />
          </Affix>
        </SField>
        <SField
          label="Offer discount without a manager (optional)"
          error={fe.maxOfferDiscountPct}
          help="How far below the asking rent an offer or a tenant's counter on these units may go, 0 to 50. Never below this rule's lowest rent. Empty: the company default"
          className={SPAN[3]}
        >
          <Affix unit="%">
            <input
              name="offerDiscount"
              inputMode="numeric"
              defaultValue={rule?.maxOfferDiscountPct ?? ""}
              {...inv("maxOfferDiscountPct")}
            />
          </Affix>
        </SField>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Saving…" : rule ? "Save changes" : "Save rule"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function RentRules({
  rules,
  company,
  category,
  canEdit,
  askAi,
}: {
  rules: RentRuleRow[];
  company: CompanyRow;
  category: Category;
  canEdit: boolean;
  askAi?: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const closeAdd = () => setAdding(false);
  const closeEdit = () => setEditing(null);
  return (
    <FormGrid
      preview={
        <RentTry
          companyId={company.id}
          companyName={company.name}
          category={category}
          firstArea={rules.find((r) => r.community)?.community ?? ""}
        />
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">{company.name}</h2>
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
        <Panel className="p-5">
          <RuleEditor company={company} category={category} onDone={closeAdd} />
        </Panel>
      )}
      {rules.length === 0 ? (
        <p className="m-0 rounded-card border border-dashed border-line bg-raised p-5 text-sm text-muted">
          No {category} rent rules for {company.name} yet. Its units in this category can&apos;t get a price range until
          one is added.
        </p>
      ) : (
        // A stacked list, not a wide table: it fits beside the "Try a unit" card and the agent panel without
        // scrolling sideways. Editing opens the form in place of the row, at full width.
        <Panel>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {rules.map((r) =>
              editing === r.id ? (
                <li key={r.id} className="p-5">
                  <RuleEditor rule={r} company={company} category={category} onDone={closeEdit} />
                </li>
              ) : (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="grid min-w-0 gap-1.5">
                    <p className="m-0 text-sm font-semibold text-ink">
                      {subtypesLabel(r.subtypes)}
                      <span className="font-normal text-muted">
                        {" "}
                        · {EMIRATE_LABELS[r.emirate]} · {r.community ?? "All areas"}
                      </span>
                    </p>
                    <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                      <div className="flex gap-1.5">
                        <dt className="text-muted">Band</dt>
                        <dd className="m-0 font-mono tabular-nums">
                          SRI {pctLabel(r.minPctBp)} to {pctLabel(r.maxPctBp)}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-muted">AED limits</dt>
                        <dd className="m-0 font-mono tabular-nums">{aedLimitsLabel(r.minRentFils, r.maxRentFils)}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-muted">Offer discount</dt>
                        <dd className="m-0 font-mono tabular-nums">
                          {r.maxOfferDiscountPct === null || r.maxOfferDiscountPct === undefined
                            ? "Company default"
                            : `${r.maxOfferDiscountPct}%`}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  {canEdit && (
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        className={iconButtonClass()}
                        aria-label={`Edit ${subtypesLabel(r.subtypes)} rule`}
                        title="Edit"
                        onClick={() => setEditing(r.id)}
                      >
                        <IconPencil size={16} />
                      </button>
                      {!r.community && (
                        <CopyToEmirate
                          action={copyRentRule}
                          id={r.id}
                          label={`Copy ${subtypesLabel(r.subtypes)} rule to another emirate`}
                          options={company.emirates.filter((e) => e !== r.emirate)}
                        />
                      )}
                      <RowAction
                        action={removeRentRule}
                        fields={{ id: r.id }}
                        label={`Remove ${subtypesLabel(r.subtypes)} rule`}
                        icon={<IconTrash size={16} />}
                        danger
                        confirmText="Remove this rule? It stops applying to units straight away."
                      />
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        </Panel>
      )}
    </FormGrid>
  );
}
