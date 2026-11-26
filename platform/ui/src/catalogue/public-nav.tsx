"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type NavLink, isCurrent } from "./nav-match";

/** A public section's nav. The current link is marked with `aria-current="page"`. */
export function PublicNav({ links, label = "Main" }: { links: NavLink[]; label?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <nav aria-label={label} className="flex items-center gap-1 md:gap-2">
      {links.map((l) => {
        const on = isCurrent(l, pathname, params, links);
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
