"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";
import { Status } from "../../../../components/ui";
import { Button } from "../../../../components/ui/button";
import { Banner, INPUT } from "../../../../components/ui/form";
import { Panel, SET_SELECT, SField, TABLE, TD, TH } from "../../../../components/ui/settings";
import { UploadSimpleIcon as IconUpload, WarningIcon as IconWarning } from "@phosphor-icons/react";
import type { CompanyRow } from "../../../../lib/types";

export type ImportKind = "leases" | "units" | "companies";

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
  rows: {
    row: number;
    status: string;
    ref?: string;
    state?: string;
    leaseId?: string;
    unitId?: string;
    reasons: string[];
  }[];
}

const COPY: Record<ImportKind, { noun: string; button: string; ref: string; placeholder: string }> = {
  leases: {
    noun: "lease",
    button: "Import leases",
    ref: "Lease",
    placeholder: "unit_code,building,community,unit_no,…",
  },
  companies: {
    noun: "company",
    button: "Import companies",
    ref: "Company",
    placeholder: "name,slug,kind,legal_name_en,trade_licence_no,…",
  },
  units: {
    noun: "unit",
    button: "Import units",
    ref: "Unit",
    placeholder: "unit_code,building,community,unit_no,category,…",
  },
};

export function ImportForm({ kind, companies }: { kind: ImportKind; companies: CompanyRow[] }) {
  const router = useRouter();
  const copy = COPY[kind];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ImportResult>();

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    setResult(undefined);
    try {
      const res = await fetch(`/api/import/${kind}`, { method: "POST", body: new FormData(e.currentTarget) });
      const body = (await res.json().catch(() => null)) as (ImportResult & { error?: string }) | null;
      if (res.status === 401) return router.push("/login");
      if (!res.ok || !body) return setError(body?.error ?? `Import failed (${res.status})`);
      setResult(body);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="grid gap-4 rounded-card border border-line bg-page p-5">
        {kind !== "companies" && (
          <SField
            label="Company"
            help={
              kind === "units"
                ? "Each row names its company; a company chosen here is used for rows that leave it empty."
                : "Every row is imported under this company."
            }
          >
            <select
              name="company"
              required={kind !== "units"}
              defaultValue={kind === "units" ? "" : companies.find((c) => c.active)?.slug}
              className={SET_SELECT}
            >
              {kind === "units" && <option value="">Use the company column in the file</option>}
              {kind !== "units" && companies.length === 0 && <option value="">No companies yet</option>}
              {companies
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
            </select>
          </SField>
        )}
        <label
          htmlFor="csv-file"
          className="flex cursor-pointer flex-wrap items-center gap-3 rounded-card border border-dashed border-line bg-raised px-4 py-5 text-sm hover:border-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink"
        >
          <span aria-hidden className="grid size-10 flex-none place-items-center rounded-xl bg-page text-ink">
            <IconUpload size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <strong>Choose a CSV file</strong> with one {copy.noun} per row
          </span>
          <input id="csv-file" type="file" name="file" accept=".csv,text/csv" className="max-w-full text-[13px]" />
        </label>
        <SField label="Or paste rows (with the header line)">
          <textarea
            name="csv"
            rows={5}
            className={`${INPUT} resize-y font-mono text-[13px]`}
            placeholder={copy.placeholder}
          />
        </SField>
        <div>
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Importing…" : copy.button}
          </Button>
        </div>
      </form>
      {error && (
        <Banner tone="bad" role="alert">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          {error}
        </Banner>
      )}
      {result && (
        <Panel className="overflow-x-auto">
          <div aria-live="polite">
            <h2 className="m-0 px-5 pt-5 font-sans text-[15px] font-semibold tracking-tight">
              {result.imported} imported, {result.skipped} skipped, {result.errors} with errors
            </h2>
            {kind === "units" && result.imported > 0 && (
              <p className="m-0 px-5 pt-1 text-[13px] text-muted">
                Imported units start in Preparation. Add photos and a virtual tour link from each unit&apos;s edit page.
              </p>
            )}
            <table className={`${TABLE} mt-3`}>
              <thead>
                <tr>
                  <th className={TH}>Row</th>
                  <th className={TH}>Result</th>
                  <th className={TH}>{copy.ref}</th>
                  <th className={TH}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => {
                  const href = r.leaseId ? `/work?kind=lease&id=${r.leaseId}` : r.unitId ? `/units/${r.unitId}` : null;
                  return (
                    <tr key={r.row} className="group">
                      <td className={`${TD} font-mono tabular-nums`}>{r.row}</td>
                      <td className={TD}>
                        <Status
                          value={r.status === "imported" ? "done" : r.status === "error" ? "failed" : "skipped"}
                          label={
                            r.status === "imported"
                              ? `Imported${r.state ? `, ${r.state === "PREP" ? "in preparation" : r.state.toLowerCase()}` : ""}`
                              : r.status === "error"
                                ? "Error"
                                : "Skipped"
                          }
                        />
                      </td>
                      <td className={`${TD} font-mono text-[13px]`}>
                        {href ? (
                          <Link className="text-ink! underline" href={href}>
                            {r.ref}
                          </Link>
                        ) : (
                          (r.ref ?? "—")
                        )}
                      </td>
                      <td className={TD}>{r.reasons.join("; ") || <span className="text-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
