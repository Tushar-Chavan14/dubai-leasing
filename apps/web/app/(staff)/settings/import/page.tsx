import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHead } from "../../../../components/ui";
import { get } from "../../../../lib/engine";
import type { CompanyRow } from "../../../../lib/types";
import { type ImportKind, ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import" };

const LEASE_COLUMNS: [string, string][] = [
  ["unit_code, building, community, unit_no", "the unit; existing units are matched by code"],
  ["dld_property_no, makani_no, dewa_premise_no", "registration numbers (optional on import)"],
  ["bedrooms, area_sqft, furnished", "0 for studio; furnished yes or no"],
  ["tenant_name, tenant_email, tenant_phone, tenant_emirates_id", "tenant; the name exactly as on the ID"],
  ["start_on, end_on", "YYYY-MM-DD, Dubai calendar dates"],
  ["annual_rent_aed, deposit_aed, cheques", "amounts in AED; 1 to 12 cheques"],
  ["ejari_no", "required for leases already running"],
];

const UNIT_COLUMNS: [string, string][] = [
  ["unit_code, building, community", "required; code like MRN-1204 (letters, digits, dashes)"],
  ["unit_no, category, subtype", "category is residential (default), commercial or retail; subtype must fit it"],
  ["dld_property_no, makani_no, plot_no, dewa_premise_no", "registration numbers; Makani has 10 digits"],
  ["bedrooms, bathrooms, area_sqft, floor, parking_spaces", "whole numbers; 0 bedrooms for studio"],
  ["furnished", "yes or no"],
  ["asking_rent_aed", "annual asking rent in AED, e.g. 85000"],
  ["description, virtual_tour_url", "listing text; tour link must start with https://"],
  ["company", "name or slug of the company that owns the unit and is its landlord; unknown is a row error"],
];

const PAGES: Record<ImportKind, { title: string; lede: string; columns: [string, string][]; note: ReactNode }> = {
  leases: {
    title: "Import leases",
    lede: "Bring current leases in from a spreadsheet. Each lease's state comes from its dates, and its renewal milestones are scheduled at once. Importing the same file again skips rows that are already in.",
    columns: LEASE_COLUMNS,
    note: "Running leases become active, or in renewal from five months before their end. Leases imported after their 90-day notice deadline get a same-rent renewal task. Leases that already ended are refused.",
  },
  units: {
    title: "Import units",
    lede: "Bring your portfolio in from a spreadsheet. Units start in Preparation with the same checks as the unit form. Codes that already exist are skipped, never overwritten.",
    columns: UNIT_COLUMNS,
    note: (
      <>
        Add photos and a virtual tour link later from each unit&apos;s edit page.{" "}
        <a className="link" href="/samples/units-sample.csv" download>
          Download a sample CSV
        </a>
        .
      </>
    ),
  },
};

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind: raw } = await searchParams;
  const kind: ImportKind = raw === "units" ? "units" : "leases";
  const page = PAGES[kind];
  const companies = (await get<CompanyRow[]>("/api/companies")) ?? [];
  return (
    <>
      <PageHead title={page.title} lede={page.lede} />
      <nav className="tabs" aria-label="What to import">
        <Link href="/settings/import" aria-current={kind === "leases" ? "page" : undefined}>
          Leases
        </Link>
        <Link href="/settings/import?kind=units" aria-current={kind === "units" ? "page" : undefined}>
          Units
        </Link>
      </nav>
      <div className="split">
        <ImportForm key={kind} kind={kind} companies={companies} />
        <aside className="panel panel-pad">
          <h2 className="section-title">Columns</h2>
          <dl className="facts" style={{ gridTemplateColumns: "1fr" }}>
            {page.columns.map(([cols, note]) => (
              <div key={cols}>
                <dt className="ref" style={{ color: "var(--ink)" }}>
                  {cols}
                </dt>
                <dd className="muted" style={{ fontSize: 13 }}>
                  {note}
                </dd>
              </div>
            ))}
          </dl>
          <div className="divider" />
          <p className="muted" style={{ fontSize: 13.5 }}>
            {page.note}
          </p>
        </aside>
      </div>
    </>
  );
}
