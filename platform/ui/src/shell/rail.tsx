"use client";

import { CommandIcon } from "@phosphor-icons/react";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

export type ShellIcon = ComponentType<{ size?: number; "aria-hidden"?: boolean }>;

export interface ShellRailItem {
  href: string;
  label: string;
  /** Matches `current` and `icons`. */
  key: string;
  count?: number;
  /** Replaces `label` as the link's tooltip. */
  title?: string;
}

/** Opens the docked agent and focuses its composer (the dock listens for Ctrl/Cmd+K). */
const openAgent = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));

/**
 * The left rail: a 76px navy column. Brand mark on top, one icon-over-label button per screen, then the ⌘K hint and the
 * account avatar (its menu holds the date, demo clock, theme and sign out). Shared by every module's staff shell.
 */
export function Rail({
  items,
  current,
  icons,
  brand,
  extra,
  agentHint = "Search or ask the agent (Ctrl+K)",
  footer,
}: {
  items: ShellRailItem[];
  current: string;
  icons: Record<string, ShellIcon>;
  brand: { mark: string; label: string; title: string };
  /** Rendered between the nav and the ⌘K button. */
  extra?: ReactNode;
  agentHint?: string;
  footer: ReactNode;
}) {
  return (
    <aside
      aria-label="Staff navigation"
      className="[position:sticky] top-0 z-40 flex h-screen w-[76px] flex-none flex-col items-center gap-1.5 bg-rail px-0 pb-16 pt-4 font-sans text-rail-ink"
    >
      <Link
        href="/"
        aria-label={brand.label}
        title={brand.title}
        className="mb-4 grid size-9 place-items-center rounded-[11px] bg-white/10 text-[14px] font-bold tracking-[-0.04em] !text-white no-underline ring-1 ring-white/15"
      >
        {brand.mark}
      </Link>
      <nav aria-label="Main" className="min-h-0 flex-1">
        <ul className="m-0 flex list-none flex-col items-center gap-1.5 p-0">
          {items.map((i) => {
            const Icon = icons[i.key]!;
            const active = i.key === current;
            return (
              <li key={i.href} className="m-0 p-0">
                <Link
                  href={i.href}
                  aria-current={active ? "page" : undefined}
                  title={i.title ?? i.label}
                  className={`relative flex w-[60px] flex-col items-center gap-1 rounded-[14px] pb-1.5 pt-2 text-[11px] font-medium leading-none no-underline transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white ${
                    active
                      ? "bg-rail-active !text-white shadow-[0_6px_16px_-6px_rgb(70_119_238/0.7)]"
                      : "!text-rail-ink hover:bg-white/8 hover:!text-white"
                  }`}
                >
                  <Icon size={20} aria-hidden />
                  <span>{i.label}</span>
                  {i.count ? (
                    <span
                      role="img"
                      aria-label={`${i.count} waiting for you`}
                      className="absolute left-[calc(50%+3px)] top-[1px] grid h-4 min-w-4 place-items-center rounded-full border-2 border-rail bg-white px-1 text-[10px] font-bold leading-none text-rail box-content"
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
      {extra}
      <button
        type="button"
        onClick={openAgent}
        title={agentHint}
        className="flex w-[60px] cursor-pointer flex-col items-center gap-1 rounded-[14px] border-0 bg-transparent pb-1.5 pt-2 text-[11px] leading-none text-rail-ink hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
      >
        <CommandIcon size={20} aria-hidden />
        <span aria-hidden="true">⌘K</span>
        <span className="sr-only">Ask the agent</span>
      </button>
      {footer}
    </aside>
  );
}
