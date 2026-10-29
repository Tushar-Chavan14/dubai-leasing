"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/customer/properties", label: "Properties" },
  { href: "/customer/chat", label: "Chat" },
];

/** The customer section's nav. The current section is marked with `aria-current="page"`. */
export function CustomerNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="pub-nav">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          {...(pathname === l.href || pathname.startsWith(`${l.href}/`) ? { "aria-current": "page" as const } : {})}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
