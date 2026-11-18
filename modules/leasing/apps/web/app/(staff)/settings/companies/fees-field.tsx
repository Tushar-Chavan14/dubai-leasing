"use client";

import { EMIRATE_LABELS, EMIRATES, type ContractFee, type Emirate } from "@leasing/core";
import { PlusIcon as IconPlus, TrashIcon as IconTrash } from "@phosphor-icons/react";
import { useState } from "react";
import { Button, iconButtonClass } from "@platform/ui/button";
import { Affix, SET_INPUT, SET_SELECT, SField } from "@platform/ui/settings";
import { aedFilsOrRaw, aedInput } from "../../../../lib/portfolio";

interface Row {
  id: string;
  name: string;
  kind: "registration" | "other";
  amountAed: string;
  payer: "tenant" | "landlord";
  emirates: Emirate[];
}

const newId = () => `fee-${Math.random().toString(36).slice(2, 10)}`;
const toRow = (f: ContractFee): Row => ({
  id: f.id,
  name: f.name,
  kind: f.kind,
  amountAed: aedInput(f.amountFils),
  payer: f.payer,
  emirates: [...f.emirates],
});

/** The rows as the engine takes them (amounts in fils). Text that isn't whole dirhams goes on for the Zod check to refuse. */
export function feesJson(rows: Row[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      amountFils: aedFilsOrRaw(r.amountAed),
      payer: r.payer,
      emirates: r.emirates,
    })),
  );
}

/**
 * The company's contract fees: a registration fee (Ejari, Tawtheeq ...), an agency fee, a municipality fee. Each names the
 * emirates it applies to (none = every emirate). The rows travel in one hidden field as JSON.
 */
export function FeesField({ fees, error }: { fees: ContractFee[] | null | undefined; error?: string | undefined }) {
  const [rows, setRows] = useState<Row[]>(() => (fees ?? []).map(toRow));
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="grid gap-4" data-field="contractFees" data-label="Contract fees">
      <input type="hidden" name="contractFees" value={rows.length ? feesJson(rows) : ""} />
      {rows.length === 0 && <p className="m-0 text-sm text-muted">No fees. Add one to print it in contracts.</p>}
      {rows.map((r, i) => (
        <fieldset key={r.id} className="m-0 grid min-w-0 gap-3 rounded-card border border-line p-4">
          <legend className="px-1 text-xs font-semibold text-muted">Fee {i + 1}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SField label="Name">
              <input
                value={r.name}
                maxLength={80}
                placeholder="Ejari registration fee"
                className={SET_INPUT}
                onChange={(e) => set(i, { name: e.target.value })}
              />
            </SField>
            <SField label="Kind">
              <select
                value={r.kind}
                className={SET_SELECT}
                onChange={(e) => set(i, { kind: e.target.value as Row["kind"] })}
              >
                <option value="registration">Registration fee</option>
                <option value="other">Other fee</option>
              </select>
            </SField>
            <SField label="Amount (AED)" as="div">
              <Affix unit="AED">
                <input
                  value={r.amountAed}
                  inputMode="numeric"
                  aria-label="Amount in AED"
                  onChange={(e) => set(i, { amountAed: e.target.value })}
                />
              </Affix>
            </SField>
            <SField label="Paid by">
              <select
                value={r.payer}
                className={SET_SELECT}
                onChange={(e) => set(i, { payer: e.target.value as Row["payer"] })}
              >
                <option value="tenant">Tenant</option>
                <option value="landlord">Landlord</option>
              </select>
            </SField>
          </div>
          <div className="grid gap-2">
            <span className="text-xs font-semibold text-muted">Applies in (none ticked: every emirate)</span>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {EMIRATES.map((e) => (
                <label key={e} className="flex items-center gap-2 text-[14px]">
                  <input
                    type="checkbox"
                    checked={r.emirates.includes(e)}
                    onChange={(ev) =>
                      set(i, { emirates: ev.target.checked ? [...r.emirates, e] : r.emirates.filter((x) => x !== e) })
                    }
                  />
                  {EMIRATE_LABELS[e]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <button
              type="button"
              className={iconButtonClass("danger")}
              aria-label={`Remove fee ${i + 1}`}
              title="Remove fee"
              onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
            >
              <IconTrash size={18} aria-hidden />
            </button>
          </div>
        </fieldset>
      ))}
      {error && <span className="text-xs text-danger">{error}</span>}
      <div>
        <Button
          variant="ghost"
          size="sm"
          disabled={rows.length >= 20}
          onClick={() =>
            setRows((x) => [
              ...x,
              { id: newId(), name: "", kind: "other", amountAed: "", payer: "tenant", emirates: [] },
            ])
          }
        >
          <IconPlus size={16} />
          Add fee
        </Button>
      </div>
    </div>
  );
}
