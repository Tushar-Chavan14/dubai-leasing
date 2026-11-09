import type { Metadata } from "next";
import { AskAiMenu } from "../../../../components/ask-ai";
import { askPrompts } from "../../../../lib/ask-ai/prompts";
import type { ReactNode } from "react";
import { TabLinks } from "../../../../components/ui/page";
import { FormGrid, Preview, SetPage } from "../../../../components/ui/settings";
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

const COMPANY_COLUMNS: [string, string][] = [
  [
    "name, slug, kind",
    "name required; slug optional (made from the name); kind developer, realty or owner, required for a new company",
  ],
  ["categories", "residential, commercial, retail; checked, not stored"],
  [
    "legal_name_en, legal_name_ar, trade_licence_no, licence_authority, trade_licence_expires_on, rera_orn",
    "legal details; expiry must be in the future",
  ],
  ["registered_address, email, phone, cheque_payee", "landlord contact details"],
  [
    "signatory_name, signatory_title, signatory_email, signatory_id_no, signatory_id_expires_on",
    "authorised signatory; ID like 784-YYYY-NNNNNNN-C or a passport number",
  ],
];

const PAGES: Record<ImportKind, { title: string; lede: string; columns: [string, string][]; note: ReactNode }> = {
  leases: {
    title: "Import leases",
    lede: "Bring current leases in from a spreadsheet. Each lease's state comes from its dates, and its renewal milestones are scheduled at once. Importing the same file again skips rows that are already in.",
    columns: LEASE_COLUMNS,
    note: "Running leases become active, or in renewal from five months before their end. Leases imported after their 90-day notice deadline get a same-rent renewal task. Leases that already ended are refused.",
  },
  companies: {
    title: "Import companies",
    lede: "Bring in the companies that are landlords, with their legal details. A company that already exists (same slug or name) only has the details the file provides updated.",
    columns: COMPANY_COLUMNS,
    note: (
      <>
        Admins only. Give all of a company&apos;s required legal details together; empty cells never erase what is
        saved.{" "}
        <a className="text-ink! underline" href="/samples/companies-sample.csv" download>
          Download a sample CSV
        </a>
        .
      </>
    ),
  },
  units: {
    title: "Import units",
    lede: "Bring your portfolio in from a spreadsheet. Units start in Preparation with the same checks as the unit form. Codes that already exist are skipped, never overwritten.",
    columns: UNIT_COLUMNS,
    note: (
      <>
        Add photos and a virtual tour link later from each unit&apos;s edit page.{" "}
        <a className="text-ink! underline" href="/samples/units-sample.csv" download>
          Download a sample CSV
        </a>
        .
      </>
    ),
  },
};

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind: raw } = await searchParams;
  const kind: ImportKind = raw === "units" || raw === "companies" ? raw : "leases";
  const page = PAGES[kind];
  const companies = (await get<CompanyRow[]>("/api/companies")) ?? [];
  return (
    <SetPage
      title={page.title}
      lede={page.lede}
      actions={<AskAiMenu label="Ask AI" prompts={askPrompts.settingsPage("Import")} />}
    >
      <TabLinks
        label="What to import"
        items={[
          { href: "/settings/import", label: "Leases", current: kind === "leases" },
          { href: "/settings/import?kind=units", label: "Units", current: kind === "units" },
          { href: "/settings/import?kind=companies", label: "Companies", current: kind === "companies" },
        ]}
      />
      <FormGrid
        preview={
          <Preview title="Columns" lede="Name the columns in the first line of your file like this.">
            <dl className="m-0 grid gap-3">
              {page.columns.map(([cols, note]) => (
                <div key={cols} className="grid gap-0.5">
                  <dt className="font-mono text-xs [overflow-wrap:anywhere] text-ink">{cols}</dt>
                  <dd className="m-0 text-[13px] text-muted">{note}</dd>
                </div>
              ))}
            </dl>
            <p className="m-0 border-t border-line pt-3 text-[13px] text-muted">{page.note}</p>
          </Preview>
        }
      >
        <ImportForm key={kind} kind={kind} companies={companies} />
      </FormGrid>
    </SetPage>
  );
}
