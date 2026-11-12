"use client";

import { useActionState } from "react";
import { FormAlert } from "../../../../components/ui/action-form";
import { Button } from "../../../../components/ui/button";
import { Affix, GRID6, Panel, SET_INPUT, SField, SPAN } from "../../../../components/ui/settings";
import type { RuleResult } from "../../../../lib/portfolio";
import { useActionForm } from "../../../../lib/use-action-form";
import { saveOfferDiscount } from "./actions";

/**
 * Company-wide: how far below a unit's approved asking rent an offer or a tenant's counter may go before a manager
 * must approve it. Rent rules limit the asking rent itself; this limits negotiation.
 */
export function OfferDiscountForm({ value, canEdit }: { value: number; canEdit: boolean }) {
  const [state, action, pending] = useActionState<RuleResult, FormData>(saveOfferDiscount, {});
  const form = useActionForm(action, { serverErrors: state.fieldErrors });
  return (
    <Panel className="p-5">
      <form {...form.formProps} className="grid gap-4" noValidate>
        <FormAlert {...form.alertProps(state)} />
        <div className={GRID6}>
          <SField
            label="Default offer discount without a manager"
            error={form.fieldErrors.maxRentDiscountPercent}
            help="Used for units whose rent rule leaves the discount empty. Set a discount per company, emirate and area on each rule below. 0 sends every lower counter to a manager."
            className={SPAN[3]}
          >
            <Affix unit="%">
              <input
                name="maxRentDiscountPercent"
                inputMode="numeric"
                defaultValue={value}
                disabled={!canEdit}
                className={SET_INPUT}
              />
            </Affix>
          </SField>
        </div>
        {canEdit && (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {state.ok && <span className="text-[13px] text-muted">Saved.</span>}
          </div>
        )}
      </form>
    </Panel>
  );
}
