"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type Category, CATEGORIES } from "../lib/portfolio";

const TABS = [
  { href: "/settings/companies", label: "Companies" },
  { href: "/settings/rent-rules", label: "Rent rules" },
  { href: "/settings/contracts", label: "Contracts" },
  { href: "/settings/rent-index", label: "Rent index" },
  { href: "/settings/rulebook", label: "Rulebook" },
  { href: "/settings/agent", label: "Agent" },
  { href: "/settings/import", label: "Import" },
  { href: "/settings/demo", label: "Demo", demoOnly: true },
];

/** Tab bar shared by Settings and the pages that move under it in slice 2. */
export function SettingsTabs({ demo }: { demo: boolean }) {
  const path = usePathname();
  return (
    <nav className="tabs settings-tabs" aria-label="Settings">
      {TABS.filter((t) => demo || !t.demoOnly).map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={path === t.href || path.startsWith(`${t.href}/`) ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Category switch for the rule lists; keeps the category in the URL so a reload stays put. */
export function CategoryControl({ value, base }: { value: Category; base: string }) {
  const router = useRouter();
  return (
    <div className="segmented" role="radiogroup" aria-label="Category">
      {CATEGORIES.map((c) => (
        <label key={c.value}>
          <input
            type="radio"
            name="category"
            checked={value === c.value}
            onChange={() => router.push(`${base}?category=${c.value}`)}
          />
          <span>{c.label}</span>
        </label>
      ))}
    </div>
  );
}
