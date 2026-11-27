"use client";

import {
  BuildingsIcon,
  CommandIcon,
  GearSixIcon,
  HouseSimpleIcon,
  StackIcon,
  UserCircleIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import type { ShellIcon } from "@platform/ui/shell/rail";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { screenOf, type NavItem, type Screen } from "../../lib/shell/nav";

export const SCREEN_ICONS: Record<Screen, ShellIcon> = {
  home: HouseSimpleIcon,
  work: StackIcon,
  units: BuildingsIcon,
  maintenance: WrenchIcon,
  settings: GearSixIcon,
  other: HouseSimpleIcon,
};

/** Opens the docked agent and focuses its composer (the dock listens for Ctrl/Cmd+K). */
const openAgent = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));

/** The building mark in a blue tile, used by the sidebar brand. */
export function BrandMark() {
  return (
    <span className="ls-mark" aria-hidden="true">
      <BuildingsIcon size={22} weight="bold" />
    </span>
  );
}

/**
 * The navy side navigation: brand, the signed-in role, one row per screen (icon, label, count), then the agent shortcut
 * and the user card. Collapses to icons below 1100px and becomes a bottom bar on phones (globals.css, "staff shell").
 */
export function Sidebar({
  items,
  roleLabel,
  user,
}: {
  items: NavItem[];
  roleLabel: string;
  /** The user card at the foot: avatar, name, role and the sign-out button. */
  user: ReactNode;
}) {
  const current = screenOf(usePathname());
  return (
    <aside className="ls-sidenav" aria-label="Staff navigation">
      <Link href="/" className="ls-sbrand" aria-label="UAE Leasing, home" title="UAE Leasing Contract AI">
        <BrandMark />
        <div>
          <b>UAE Leasing</b>
          <small>Contract AI</small>
        </div>
      </Link>
      <div className="ls-sportal">
        <UserCircleIcon size={14} aria-hidden />
        <span>{roleLabel}</span>
      </div>
      <nav aria-label="Main" className="ls-snav">
        {items.map((i) => {
          const Icon = SCREEN_ICONS[i.screen];
          const active = i.screen === current;
          return (
            <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} title={i.label}>
              <span className="ls-ni">
                <Icon size={19} aria-hidden />
              </span>
              <span className="ls-nl">{i.label}</span>
              {i.count ? (
                <span className="ls-count" role="img" aria-label={`${i.count} waiting for you`}>
                  {i.count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="ls-sfoot">
        <button type="button" className="ls-sagent" onClick={openAgent} title="Search or ask the agent (Ctrl+K)">
          <CommandIcon size={18} aria-hidden />
          <span>Ask the agent</span>
          <kbd>⌘K</kbd>
        </button>
        {user}
      </div>
    </aside>
  );
}
