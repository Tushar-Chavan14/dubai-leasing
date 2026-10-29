"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Status } from "../../../../components/ui";
import { IconUpload, IconWarning } from "../../../../lib/icons";
import type { CompanyRow } from "../../../../lib/types";

export type ImportKind = "leases" | "units";

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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
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
      <form onSubmit={onSubmit} className="panel panel-pad stack">
        <label className="field">
          <span className="field-label">Company</span>
          <select
            name="company"
            required={kind !== "units"}
            defaultValue={kind === "units" ? "" : companies.find((c) => c.active)?.slug}
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
          <span className="hint">
            {kind === "units"
              ? "Each row names its company; a company chosen here is used for rows that leave it empty."
              : "Every row is imported under this company."}
          </span>
        </label>
        <label className="dropzone" htmlFor="csv-file">
          <IconUpload size={22} />
          <span>
            <strong>Choose a CSV file</strong> with one {copy.noun} per row
          </span>
          <input id="csv-file" type="file" name="file" accept=".csv,text/csv" style={{ fontSize: 13 }} />
        </label>
        <label className="field">
          <span className="field-label">
            Or paste rows <em>(with the header line)</em>
          </span>
          <textarea name="csv" rows={5} className="ref" placeholder={copy.placeholder} />
        </label>
        <div className="btn-row">
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? "Importing…" : copy.button}
          </button>
        </div>
      </form>
      {error && (
        <div className="alert" data-tone="bad" role="alert" style={{ marginTop: 16 }}>
          <IconWarning size={16} />
          {error}
        </div>
      )}
      {result && (
        <section className="panel section" aria-live="polite">
          <div className="panel-head">
            <h2>
              {result.imported} imported, {result.skipped} skipped, {result.errors} with errors
            </h2>
          </div>
          {kind === "units" && result.imported > 0 && (
            <p className="muted panel-pad" style={{ fontSize: 13.5, margin: 0 }}>
              Imported units start in Preparation. Add photos and a virtual tour link from each unit&apos;s edit page.
            </p>
          )}
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Result</th>
                  <th>{copy.ref}</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => {
                  const href = r.leaseId ? `/work?kind=lease&id=${r.leaseId}` : r.unitId ? `/units/${r.unitId}` : null;
                  return (
                    <tr key={r.row}>
                      <td className="num">{r.row}</td>
                      <td>
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
                      <td className="ref">
                        {href ? (
                          <Link className="link" href={href}>
                            {r.ref}
                          </Link>
                        ) : (
                          (r.ref ?? "—")
                        )}
                      </td>
                      <td>{r.reasons.join("; ") || <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
