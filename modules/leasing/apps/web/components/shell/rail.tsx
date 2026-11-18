"use client";

import { BuildingsIcon, CommandIcon, GearSixIcon, HouseSimpleIcon, StackIcon, WrenchIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { screenOf, type NavItem, type Screen } from "../../lib/shell/nav";

type IconType = ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
const ICONS: Record<Screen, IconType> = {
  home: HouseSimpleIcon,
  work: StackIcon,
  units: BuildingsIcon,
  maintenance: WrenchIcon,
  settings: GearSixIcon,
  other: HouseSimpleIcon,
};

/** Opens the docked agent and focuses its composer (the dock listens for Ctrl/Cmd+K). */
const openAgent = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));

/**
 * The left rail: a 72px column. Brand mark on top, one icon-over-label button per screen, then the ⌘K hint and the
 * account avatar (its menu holds the date, demo clock, theme and sign out).
 */
export function Rail({ items, footer }: { items: NavItem[]; footer: ReactNode }) {
  const current = screenOf(usePathname());
  return (
    <aside
      aria-label="Staff navigation"
      className="[position:sticky] top-0 z-40 flex h-screen w-[72px] flex-none flex-col items-center gap-1.5 border-r border-line bg-page px-0 pb-16 pt-3.5 font-sans text-ink"
    >
      <Link
        href="/"
        aria-label="UAE Leasing, overview"
        title="UAE Leasing Contract AI"
        className="mb-3.5 grid size-[34px] place-items-center rounded-[10px] bg-primary text-[14px] font-bold tracking-[-0.04em] !text-on-primary no-underline"
      >
        DL
      </Link>
      <nav aria-label="Main" className="min-h-0 flex-1">
        <ul className="m-0 flex list-none flex-col items-center gap-1.5 p-0">
          {items.map((i) => {
            const Icon = ICONS[i.screen];
            const active = i.screen === current;
            return (
              <li key={i.href} className="m-0 p-0">
                <Link
                  href={i.href}
                  aria-current={active ? "page" : undefined}
                  title={i.label}
                  className={`relative flex w-[58px] flex-col items-center gap-1 rounded-xl pb-1.5 pt-2 text-[11px] leading-none no-underline transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${
                    active ? "bg-accent !text-on-accent" : "!text-muted hover:bg-raised hover:!text-ink"
                  }`}
                >
                  <Icon size={20} aria-hidden />
                  <span>{i.label}</span>
                  {i.count ? (
                    <span
                      role="img"
                      aria-label={`${i.count} waiting for you`}
                      className="absolute left-[calc(50%+3px)] top-[1px] grid h-4 min-w-4 place-items-center rounded-full border-2 border-page bg-primary px-1 text-[10px] font-semibold leading-none text-on-primary box-content"
                    >
                      {i.count}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <button
        type="button"
        onClick={openAgent}
        title="Search or ask the agent (Ctrl+K)"
        className="flex w-[58px] cursor-pointer flex-col items-center gap-1 rounded-xl border-0 bg-transparent pb-1.5 pt-2 text-[11px] leading-none text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
      >
        <CommandIcon size={20} aria-hidden />
        <span aria-hidden="true">⌘K</span>
        <span className="sr-only">Ask the agent</span>
      </button>
      {footer}
    </aside>
  );
}
