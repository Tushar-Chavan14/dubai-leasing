"use client";

import { EMIRATE_LABELS, EMIRATES } from "@leasing/core";
import { ActionForm } from "../../../../components/ui/action-form";
import { useActionState } from "react";
import { CheckIcon as IconCheck, WarningIcon as IconWarning } from "@phosphor-icons/react";
import { Button } from "../../../../components/ui/button";
import { Banner } from "../../../../components/ui/form";
import { Affix, SET_INPUT, SET_SELECT, SField } from "../../../../components/ui/settings";
import { type SriState, saveSri } from "./actions";

export function SriForm() {
  const [s, action, pending] = useActionState<SriState, FormData>(saveSri, {});
  return (
    <ActionForm state={s} action={action} className="grid gap-3.5">
      <SField label="Emirate">
        <select name="emirate" defaultValue="dubai" className={SET_SELECT}>
          {EMIRATES.map((e) => (
            <option key={e} value={e}>
              {EMIRATE_LABELS[e]}
            </option>
          ))}
        </select>
      </SField>
      <SField label="Community">
        <input name="community" required placeholder="Dubai Marina" className={SET_INPUT} />
      </SField>
      <SField label="Size">
        <select name="bedrooms" defaultValue="1" className={SET_SELECT}>
          <option value="0">Studio</option>
          {[1, 2, 3, 4, 5].map((b) => (
            <option key={b} value={b}>
              {b} bed
            </option>
          ))}
        </select>
      </SField>
      <SField label="Average annual rent">
        <Affix unit="AED">
          <input name="avg" inputMode="decimal" required placeholder="100,000" />
        </Affix>
      </SField>
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          Save
        </Button>
      </div>
      {s.ok && (
        <Banner tone="good" role="status">
          <IconCheck size={16} className="mt-0.5 shrink-0" />
          {s.ok}
        </Banner>
      )}
      {s.error && (
        <Banner tone="bad" role="alert">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          {s.error}
        </Banner>
      )}
    </ActionForm>
  );
}
