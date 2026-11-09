import Link from "next/link";
import type { ReactNode } from "react";
import type { CompanyRow } from "../lib/types";

/** Picks the company a settings page shows: the one in the URL, else the first active one. */
export function pickCompany(companies: CompanyRow[], id: string | undefined): CompanyRow | undefined {
  const list = companies.filter((c) => c.active);
  return list.find((c) => c.id === id) ?? list[0];
}

/** A row of company pills above the selected company's settings. Keeps other URL params. */
export function CompanySplit({
  companies,
  selected,
  base,
  params = {},
  counts = {},
  countLabel = "rules",
  children,
}: {
  companies: CompanyRow[];
  selected: CompanyRow | undefined;
  base: string;
  params?: Record<string, string>;
  /** Company id to the number of items it has on this page. */
  counts?: Record<string, number>;
  countLabel?: string;
  children: ReactNode;
}) {
  const active = companies.filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name));
  const href = (id: string) => `${base}?${new URLSearchParams({ ...params, company: id }).toString()}`;
  return (
    <div className="grid gap-5">
      <nav aria-label="Companies" className="min-w-0">
        {active.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">
            No active companies.{" "}
            <Link href="/settings/companies" className="text-ink! underline">
              Add one
            </Link>
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {active.map((c) => (
              <li key={c.id} className="m-0 p-0">
                <Link
                  href={href(c.id)}
                  aria-current={c.id === selected?.id ? "true" : undefined}
                  className="grid gap-0.5 rounded-xl border border-line bg-page px-3 py-2 text-ink! no-underline hover:border-ink aria-[current=true]:border-transparent aria-[current=true]:bg-accent aria-[current=true]:text-on-accent! focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
                >
                  <span className="text-sm font-semibold">{c.name}</span>
                  <span className="text-xs opacity-75">
                    {counts[c.id] ?? 0} {(counts[c.id] ?? 0) === 1 ? countLabel.replace(/s$/, "") : countLabel} ·{" "}
                    {c.unitCount} {c.unitCount === 1 ? "unit" : "units"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className="grid min-w-0 gap-5">{children}</div>
    </div>
  );
}
