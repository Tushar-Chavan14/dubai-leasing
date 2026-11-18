"use client";

import { useActionState } from "react";
import { FormAlert } from "@platform/ui/action-form";
import { Button } from "@platform/ui/button";
import { CHECK_ROW, GRID6, Panel, SET_INPUT, SField, SPAN } from "@platform/ui/settings";
import type { RuleResult } from "../../../../lib/portfolio";
import { useActionForm } from "@platform/ui/use-action-form";
import { saveChangePolicy } from "./actions";

export interface ChangePolicy {
  enabled: boolean;
  roles: ("tenant" | "landlord")[];
  maxOpenPerSigner: number;
  maxChars: number;
}

/**
 * D67: whether a tenant or landlord can ask for a change from the signing page. While a request is open, signing
 * pauses for both parties; the leasing agent drafts the change and a leasing officer re-issues or declines it.
 */
export function ChangePolicyForm({ value, canEdit }: { value: ChangePolicy; canEdit: boolean }) {
  const [state, action, pending] = useActionState<RuleResult, FormData>(saveChangePolicy, {});
  const form = useActionForm(action, { serverErrors: state.fieldErrors });
  const fe = form.fieldErrors;
  return (
    <Panel className="p-5">
      <form {...form.formProps} className="grid gap-4" noValidate>
        <div className="grid gap-1">
          <h2 className="m-0 text-base font-semibold">Change requests while signing</h2>
          <p className="m-0 text-[13px] text-muted">
            Signers can ask for a change from their signing link. Signing pauses for both parties until a leasing
            officer re-issues the contract (it still needs the final contract approval) or declines with a note. The
            leasing agent drafts the change and never writes rent, cheques, deposit or dates. Applies to all companies.
          </p>
        </div>
        <FormAlert {...form.alertProps(state)} />
        <div className={CHECK_ROW}>
          <label>
            <input type="checkbox" name="enabled" defaultChecked={value.enabled} disabled={!canEdit} />
            Allow change requests
          </label>
        </div>
        <div className={GRID6}>
          <SField label="Who can ask" error={fe.roles} className={SPAN[2]}>
            <div className={CHECK_ROW}>
              {(["tenant", "landlord"] as const).map((r) => (
                <label key={r}>
                  <input
                    type="checkbox"
                    name="roles"
                    value={r}
                    defaultChecked={value.roles.includes(r)}
                    disabled={!canEdit}
                  />
                  {r === "tenant" ? "Tenant" : "Landlord"}
                </label>
              ))}
            </div>
          </SField>
          <SField label="Open requests per signer" error={fe.maxOpenPerSigner} help="1 to 5" className={SPAN[2]}>
            <input
              name="maxOpenPerSigner"
              type="number"
              min={1}
              max={5}
              defaultValue={value.maxOpenPerSigner}
              disabled={!canEdit}
              className={SET_INPUT}
            />
          </SField>
          <SField label="Longest request (characters)" error={fe.maxChars} help="100 to 2000" className={SPAN[2]}>
            <input
              name="maxChars"
              type="number"
              min={100}
              max={2000}
              step={50}
              defaultValue={value.maxChars}
              disabled={!canEdit}
              className={SET_INPUT}
            />
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
