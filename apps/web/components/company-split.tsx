import Link from "next/link";
import type { ReactNode } from "react";
import type { CompanyRow } from "../lib/types";

/** Picks the company a settings page shows: the one in the URL, else the first active one. */
export function pickCompany(companies: CompanyRow[], id: string | undefined): CompanyRow | undefined {
  const list = companies.filter((c) => c.active);
  return list.find((c) => c.id === id) ?? list[0];
}

/** Companies on the left, the selected company's settings on the right. Keeps other URL params. */
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
    <div className="co-split">
      <nav className="co-list" aria-label="Companies">
        {active.length === 0 ? (
          <p className="muted co-empty">
            No active companies. <Link href="/settings/companies">Add one</Link>
          </p>
        ) : (
          <ul>
            {active.map((c) => (
              <li key={c.id}>
                <Link href={href(c.id)} className="co-row" aria-current={c.id === selected?.id ? "true" : undefined}>
                  <span className="co-row-name">{c.name}</span>
                  <span className="co-row-meta">
                    {counts[c.id] ?? 0} {countLabel} · {c.unitCount} units
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className="co-body">{children}</div>
    </div>
  );
}
