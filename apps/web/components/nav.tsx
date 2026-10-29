"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { IconBook, IconBuilding, IconChecklist, IconHome, IconKey } from "../lib/icons";

interface Item {
  href: string;
  label: string;
  icon: ReactNode;
  count?: number;
}

export function Nav({ waitingCount, maintenance = false }: { waitingCount: number; maintenance?: boolean }) {
  const path = usePathname();
  const items: Item[] = [
    { href: "/", label: "Home", icon: <IconHome size={17} /> },
    { href: "/work", label: "Workspace", icon: <IconChecklist size={17} />, count: waitingCount },
    { href: "/units", label: "Units", icon: <IconBuilding size={17} /> },
    ...(maintenance ? [{ href: "/maintenance", label: "Maintenance", icon: <IconKey size={17} /> }] : []),
    { href: "/settings", label: "Settings", icon: <IconBook size={17} /> },
  ];
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  return (
    <nav className="nav" aria-label="Main">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={isActive(i.href) ? "page" : undefined}>
          {i.icon}
          {i.label}
          {i.count ? (
            <span className="count" aria-label={`${i.count} waiting for you`}>
              {i.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
