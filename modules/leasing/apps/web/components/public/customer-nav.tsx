"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const LINKS = [
  { href: "/customer/properties", label: "Rent" },
  { href: "/customer/chat", label: "Chat" },
  { href: "/customer/chat?check=1", label: "Check my application" },
];

/** The customer section's nav. The current section is marked with `aria-current="page"`. */
export function CustomerNav() {
  const pathname = usePathname();
  const checking = useSearchParams().has("check");
  return (
    <nav aria-label="Main" className="flex items-center gap-1 md:gap-2">
      {LINKS.map((l) => {
        const [path] = l.href.split("?");
        const isCheck = l.href.includes("check=");
        const on = (pathname === path || pathname.startsWith(`${path}/`)) && (isCheck ? checking : !checking);
        return (
          <Link
            key={l.href}
            href={l.href}
            {...(on ? { "aria-current": "page" as const } : {})}
            className={`rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 ease-out motion-reduce:transition-none hover:bg-raised focus-visible:outline-2 focus-visible:outline-ink ${on ? "bg-accent text-on-accent!" : "text-muted!"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
