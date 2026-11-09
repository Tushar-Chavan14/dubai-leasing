"use client";

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
  TABLE,
  TD,
  TH,
} from "../../../../components/ui/settings";
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
import { useActionForm } from "../../../../lib/use-action-form";
import type { CompanyRow, RentRuleRow } from "../../../../lib/types";
import { removeRentRule, saveRentRule } from "./actions";
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
        <SField label="Type" error={fe.subtype} className={SPAN[3]}>
          <select name="subtype" defaultValue={rule?.subtype ?? ""} className={SET_SELECT}>
            <option value="">All types</option>
            {subtypesFor(category).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
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
        <Panel className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Type</th>
                <th className={TH}>Area</th>
                <th className={TH}>Band</th>
                <th className={TH}>AED limits</th>
                {canEdit && <th className={TH} />}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) =>
                editing === r.id ? (
                  <tr key={r.id} className="group">
                    <td className={TD} colSpan={canEdit ? 5 : 4}>
                      <RuleEditor rule={r} company={company} category={category} onDone={closeEdit} />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="group">
                    <td className={`${TD} whitespace-nowrap font-semibold`}>{subtypeLabel(r.subtype)}</td>
                    <td className={TD}>{r.community ?? "All areas"}</td>
                    <td className={`${TD} whitespace-nowrap font-mono tabular-nums`}>
                      SRI {pctLabel(r.minPctBp)} to {pctLabel(r.maxPctBp)}
                    </td>
                    <td className={`${TD} whitespace-nowrap font-mono tabular-nums`}>
                      {aedLimitsLabel(r.minRentFils, r.maxRentFils)}
                    </td>
                    {canEdit && (
                      <td className={`${TD} whitespace-nowrap`}>
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            className={iconButtonClass()}
                            aria-label={`Edit ${subtypeLabel(r.subtype)} rule`}
                            title="Edit"
                            onClick={() => setEditing(r.id)}
                          >
                            <IconPencil size={16} />
                          </button>
                          <RowAction
                            action={removeRentRule}
                            fields={{ id: r.id }}
                            label={`Remove ${subtypeLabel(r.subtype)} rule`}
                            icon={<IconTrash size={16} />}
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
        </Panel>
      )}
    </FormGrid>
  );
}
