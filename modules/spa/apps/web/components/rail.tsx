"use client";

import {
  BuildingsIcon,
  CommandIcon,
  GearSixIcon,
  HouseSimpleIcon,
  ShieldCheckIcon,
  StackIcon,
  TagIcon,
} from "@phosphor-icons/react";
import { type RailItem, type RailScreen, screenOf } from "@spa/core/roles";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";

type IconType = ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
const ICONS: Record<RailScreen, IconType> = {
  home: HouseSimpleIcon,
  work: StackIcon,
  inventory: BuildingsIcon,
  listings: TagIcon,
  compliance: ShieldCheckIcon,
  settings: GearSixIcon,
};

/** Focuses the copilot dock (⌘K / Ctrl+K). */
const openCopilot = () => document.getElementById("copilot-dock")?.focus();

/** The 72px rail (design.md §2): brand mark, one icon-over-label item per screen, ⌘K, then the avatar menu. */
export function Rail({
  items,
  footer,
  badges = {},
}: {
  items: RailItem[];
  footer: ReactNode;
  /** "Waiting for you" counts only (design §2): shown on the item when above zero. */
  badges?: Partial<Record<RailScreen, number>>;
}) {
  const current = screenOf(usePathname());
  return (
    <aside
      aria-label="Staff navigation"
      className="sticky top-0 z-40 flex h-screen w-[72px] flex-none flex-col items-center gap-1.5 border-r border-line bg-page pb-16 pt-3.5 font-sans text-ink"
    >
      <Link
        href="/"
        aria-label="Sales, home"
        className="mb-3.5 grid size-[34px] place-items-center rounded-[10px] bg-primary text-[14px] font-bold tracking-[-0.04em] !text-on-primary no-underline"
      >
        S
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
                  title={i.readOnly ? `${i.label} (view only)` : i.label}
                  className={`relative flex w-[58px] flex-col items-center gap-1 rounded-xl pb-1.5 pt-2 text-[11px] leading-none no-underline transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                    active ? "bg-accent !text-on-accent" : "!text-muted hover:bg-raised hover:!text-ink"
                  }`}
                >
                  <Icon size={20} aria-hidden />
                  <span>{i.label}</span>
                  {(badges[i.screen] ?? 0) > 0 && (
                    <>
                      <span
                        aria-hidden="true"
                        className="absolute right-1 top-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-on-primary"
                      >
                        {badges[i.screen]}
                      </span>
                      <span className="sr-only">, {badges[i.screen]} waiting for you</span>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <button
        type="button"
        onClick={openCopilot}
        title="Ask the copilot (Ctrl+K)"
        className="flex w-[58px] cursor-pointer flex-col items-center gap-1 rounded-xl border-0 bg-transparent pb-1.5 pt-2 text-[11px] leading-none text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <CommandIcon size={20} aria-hidden />
        <span aria-hidden="true">⌘K</span>
        <span className="sr-only">Ask the copilot</span>
      </button>
      {footer}
    </aside>
  );
}
