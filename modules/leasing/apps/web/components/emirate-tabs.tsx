import { EMIRATE_LABELS, type Emirate } from "@leasing/core";
import Link from "next/link";

/** The emirate tab a page shows: an operating emirate, or `any` for rules without an emirate. */
export type EmirateTab = Emirate | "any";

/** Picks the tab from the URL: one of the company's emirates or `any`, else its first emirate. */
export function pickEmirateTab(operated: Emirate[], raw: string | undefined): EmirateTab {
  if (raw === "any") return "any";
  return operated.find((e) => e === raw) ?? operated[0] ?? "any";
}

/** One tab per operating emirate plus "All emirates", under the company tabs. Keeps the other URL params. */
export function EmirateTabs({
  emirates,
  selected,
  base,
  params = {},
}: {
  emirates: Emirate[];
  selected: EmirateTab;
  base: string;
  params?: Record<string, string>;
}) {
  const href = (tab: EmirateTab) => `${base}?${new URLSearchParams({ ...params, emirate: tab }).toString()}`;
  const tabs: { id: EmirateTab; label: string }[] = [
    ...emirates.map((e) => ({ id: e, label: EMIRATE_LABELS[e] })),
    { id: "any", label: "All emirates" },
  ];
  return (
    <nav aria-label="Emirates" className="min-w-0">
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {tabs.map((t) => (
          <li key={t.id} className="m-0 p-0">
            <Link
              href={href(t.id)}
              aria-current={t.id === selected ? "true" : undefined}
              className="block rounded-xl border border-line bg-page px-3 py-1.5 text-sm font-semibold text-ink! no-underline hover:border-ink aria-[current=true]:border-transparent aria-[current=true]:bg-accent aria-[current=true]:text-on-accent! focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
