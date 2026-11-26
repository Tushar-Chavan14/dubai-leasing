"use client";

import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { Button } from "@platform/ui/button";
import { FIELD, HINT, INPUT as BASE_INPUT, LABEL } from "@platform/ui/form";
import { Segmented } from "@platform/ui/segmented";
import { shareLabel } from "../lib/format";

/**
 * Repeatable person or company rows, shared by the listing form (sellers) and the deal and offer forms (buyers, M6).
 * A person has a name, email and nationality (optional for a seller, required for a buyer); a company has its licence
 * details and the authorised signatory who signs for it. Shares are all-or-none and checked by the engine's schemas.
 */
export interface PartyRow {
  kind: "person" | "company";
  name: string;
  email: string;
  phone: string;
  nationality: string;
  licenceNo: string;
  licenceExpiresOn: string;
  issuingAuthority: string;
  signerName: string;
  signerEmail: string;
  authority: "poa" | "board_resolution";
  share: string;
}

export const blankParty = (kind: "person" | "company" = "person"): PartyRow => ({
  kind,
  name: "",
  email: "",
  phone: "",
  nationality: "",
  licenceNo: "",
  licenceExpiresOn: "",
  issuingAuthority: "",
  signerName: "",
  signerEmail: "",
  authority: "poa",
  share: "",
});

const text = (v: string): string | undefined => (v.trim() === "" ? undefined : v.trim());

/** "33.33" (percent) to basis points by integer arithmetic; null when it isn't a percentage. */
export function pctToBps(v: string): number | undefined | null {
  const t = v.trim().replace(/%$/, "");
  if (t === "") return undefined;
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** The row as the engine's `SellerInput` / `BuyerInput` wants it. */
export function partyPayload(r: PartyRow) {
  const shareBps = pctToBps(r.share);
  const common = { email: r.email.trim(), ...(typeof shareBps === "number" ? { shareBps } : {}) };
  return r.kind === "person"
    ? { kind: "person", fullNameEn: r.name.trim(), phone: text(r.phone), nationality: text(r.nationality), ...common }
    : {
        kind: "company",
        tradeName: r.name.trim(),
        licenceNo: r.licenceNo.trim(),
        licenceExpiresOn: r.licenceExpiresOn.trim(),
        issuingAuthority: r.issuingAuthority.trim(),
        signatory: { fullNameEn: r.signerName.trim(), email: r.signerEmail.trim(), authority: r.authority },
        ...common,
      };
}

const INPUT = `${BASE_INPUT} aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-60`;
const S6 = "grid grid-cols-6 items-start gap-x-4 gap-y-4";
const W1 = "col-span-6 @[560px]:col-span-1";
const W2 = "col-span-6 @[560px]:col-span-2";
const W3 = "col-span-6 @[560px]:col-span-3";
const ROW = "grid gap-4 rounded-xl border border-line bg-page p-4";

export function PartyRows({
  role,
  rows,
  setRows,
  inv,
  err,
  max,
}: {
  role: "seller" | "buyer";
  rows: PartyRow[];
  setRows: (next: PartyRow[] | ((prev: PartyRow[]) => PartyRow[])) => void;
  /** Marks an input invalid and names it for the form's error summary. */
  inv: (key: string, label?: string) => Record<string, unknown>;
  err: (key: string) => React.ReactNode;
  max: number;
}) {
  const prefix = `${role}s`;
  const Role = role === "seller" ? "Seller" : "Buyer";
  const setRow = (i: number, patch: Partial<PartyRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const total = rows.reduce(
    (n, r) => n + (typeof pctToBps(r.share) === "number" ? (pctToBps(r.share) as number) : 0),
    0,
  );
  return (
    <div className="grid gap-4">
      <div data-field={prefix} tabIndex={-1} className="grid gap-4">
        {rows.map((r, i) => {
          const nameKey = `${prefix}.${i}.${r.kind === "person" ? "fullNameEn" : "tradeName"}`;
          return (
            <fieldset key={i} className={ROW}>
              <legend className="sr-only">
                {Role} {i + 1}
              </legend>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Segmented<"person" | "company">
                  label={`${Role} ${i + 1} is`}
                  value={r.kind}
                  onChange={(kind) => setRow(i, { kind })}
                  options={[
                    { value: "person", label: "Person" },
                    { value: "company", label: "Company" },
                  ]}
                />
                {rows.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                    <TrashIcon size={15} aria-hidden />
                    Remove {role}
                  </Button>
                )}
              </div>
              <div className={S6}>
                <label className={`${FIELD} ${W3}`}>
                  <span className={LABEL}>{r.kind === "person" ? "Full name" : "Trade name"}</span>
                  <input
                    className={INPUT}
                    value={r.name}
                    onChange={(e) => setRow(i, { name: e.target.value })}
                    maxLength={200}
                    {...inv(nameKey, `${Role} ${i + 1} name`)}
                  />
                  {err(nameKey)}
                </label>
                <label className={`${FIELD} ${W2}`}>
                  <span className={LABEL}>Email</span>
                  <input
                    className={INPUT}
                    type="email"
                    value={r.email}
                    onChange={(e) => setRow(i, { email: e.target.value })}
                    {...inv(`${prefix}.${i}.email`, `${Role} ${i + 1} email`)}
                  />
                  {err(`${prefix}.${i}.email`)}
                </label>
                <label className={`${FIELD} ${W1}`}>
                  <span className={LABEL}>Share %</span>
                  <input
                    className={INPUT}
                    value={r.share}
                    onChange={(e) => setRow(i, { share: e.target.value })}
                    inputMode="decimal"
                    placeholder="Equal"
                    {...inv(`${prefix}.${i}.share`, `${Role} ${i + 1} share`)}
                  />
                  {err(`${prefix}.${i}.share`)}
                </label>
                {r.kind === "person" ? (
                  <>
                    <label className={`${FIELD} ${W3}`}>
                      <span className={LABEL}>Phone (optional)</span>
                      <input
                        className={INPUT}
                        value={r.phone}
                        onChange={(e) => setRow(i, { phone: e.target.value })}
                        maxLength={30}
                      />
                    </label>
                    <label className={`${FIELD} ${W3}`}>
                      <span className={LABEL}>{role === "buyer" ? "Nationality" : "Nationality (optional)"}</span>
                      <input
                        className={INPUT}
                        value={r.nationality}
                        onChange={(e) => setRow(i, { nationality: e.target.value })}
                        maxLength={60}
                        {...(role === "buyer" ? inv(`${prefix}.${i}.nationality`, `${Role} ${i + 1} nationality`) : {})}
                      />
                      {role === "buyer" && err(`${prefix}.${i}.nationality`)}
                    </label>
                  </>
                ) : (
                  <>
                    <label className={`${FIELD} ${W2}`}>
                      <span className={LABEL}>Licence number</span>
                      <input
                        className={INPUT}
                        value={r.licenceNo}
                        onChange={(e) => setRow(i, { licenceNo: e.target.value })}
                        maxLength={60}
                        {...inv(`${prefix}.${i}.licenceNo`, `${Role} ${i + 1} licence number`)}
                      />
                      {err(`${prefix}.${i}.licenceNo`)}
                    </label>
                    <label className={`${FIELD} ${W2}`}>
                      <span className={LABEL}>Licence valid to</span>
                      <input
                        className={INPUT}
                        type="date"
                        value={r.licenceExpiresOn}
                        onChange={(e) => setRow(i, { licenceExpiresOn: e.target.value })}
                        {...inv(`${prefix}.${i}.licenceExpiresOn`, `${Role} ${i + 1} licence date`)}
                      />
                      {err(`${prefix}.${i}.licenceExpiresOn`)}
                    </label>
                    <label className={`${FIELD} ${W2}`}>
                      <span className={LABEL}>Issuing authority</span>
                      <input
                        className={INPUT}
                        value={r.issuingAuthority}
                        onChange={(e) => setRow(i, { issuingAuthority: e.target.value })}
                        maxLength={120}
                        {...inv(`${prefix}.${i}.issuingAuthority`, `${Role} ${i + 1} issuing authority`)}
                      />
                      {err(`${prefix}.${i}.issuingAuthority`)}
                    </label>
                    <label className={`${FIELD} ${W2}`}>
                      <span className={LABEL}>Signatory name</span>
                      <input
                        className={INPUT}
                        value={r.signerName}
                        onChange={(e) => setRow(i, { signerName: e.target.value })}
                        maxLength={200}
                        {...inv(`${prefix}.${i}.signatory.fullNameEn`, `${Role} ${i + 1} signatory name`)}
                      />
                      {err(`${prefix}.${i}.signatory.fullNameEn`)}
                    </label>
                    <label className={`${FIELD} ${W2}`}>
                      <span className={LABEL}>Signatory email</span>
                      <input
                        className={INPUT}
                        type="email"
                        value={r.signerEmail}
                        onChange={(e) => setRow(i, { signerEmail: e.target.value })}
                        {...inv(`${prefix}.${i}.signatory.email`, `${Role} ${i + 1} signatory email`)}
                      />
                      {err(`${prefix}.${i}.signatory.email`)}
                    </label>
                    <label className={`${FIELD} ${W2}`}>
                      <span className={LABEL}>Signs with</span>
                      <select
                        className={INPUT}
                        value={r.authority}
                        onChange={(e) => setRow(i, { authority: e.target.value as PartyRow["authority"] })}
                      >
                        <option value="poa">Power of attorney</option>
                        <option value="board_resolution">Board resolution</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
            </fieldset>
          );
        })}
      </div>
      {err(prefix)}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRows((rs) => [...rs, blankParty()])}
          disabled={rows.length >= max}
        >
          <PlusIcon size={15} aria-hidden />
          Add a {role}
        </Button>
        <span className={HINT}>
          {rows.some((r) => r.share.trim())
            ? `Shares so far: ${shareLabel(total) ?? "0%"} of 100%`
            : "Leave the shares empty for equal owners"}
        </span>
      </div>
    </div>
  );
}
