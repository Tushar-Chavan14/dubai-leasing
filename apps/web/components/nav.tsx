"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  IconArea,
  IconBook,
  IconBuilding,
  IconChart,
  IconChat,
  IconChecklist,
  IconHome,
  IconInbox,
  IconKey,
  IconPeople,
  IconSpark,
  IconUpload,
} from "../lib/icons";

interface Item {
  href: string;
  label: string;
  icon: ReactNode;
  count?: number;
}

export function Nav({ inboxCount }: { inboxCount: number }) {
  const path = usePathname();
  const items: Item[] = [
    { href: "/", label: "Overview", icon: <IconHome size={17} /> },
    { href: "/inbox", label: "Approvals", icon: <IconInbox size={17} />, count: inboxCount },
    { href: "/conversations", label: "Enquiries", icon: <IconChat size={17} /> },
    { href: "/applications", label: "Applicants", icon: <IconPeople size={17} /> },
    { href: "/leases", label: "Leases", icon: <IconKey size={17} /> },
    { href: "/units", label: "Units", icon: <IconBuilding size={17} /> },
    { href: "/tasks", label: "Tasks", icon: <IconChecklist size={17} /> },
    { href: "/maintenance", label: "Maintenance", icon: <IconKey size={17} /> },
    { href: "/metrics", label: "Metrics", icon: <IconChart size={17} /> },
    { href: "/sri", label: "Rent index", icon: <IconArea size={17} /> },
    { href: "/rules", label: "Rules", icon: <IconBook size={17} /> },
    { href: "/copilot", label: "Copilot", icon: <IconSpark size={17} /> },
    { href: "/import", label: "Import", icon: <IconUpload size={17} /> },
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
