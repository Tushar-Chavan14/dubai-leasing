"use client";

import {
  BuildingsIcon,
  GearSixIcon,
  HouseSimpleIcon,
  ShieldCheckIcon,
  StackIcon,
  TagIcon,
} from "@phosphor-icons/react";
import { Rail as SharedRail, type ShellIcon } from "@platform/ui/shell/rail";
import { type RailItem, type RailScreen, screenOf } from "@spa/core/roles";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AlertBell } from "./alert-bell";

const ICONS: Record<RailScreen, ShellIcon> = {
  home: HouseSimpleIcon,
  work: StackIcon,
  inventory: BuildingsIcon,
  listings: TagIcon,
  compliance: ShieldCheckIcon,
  settings: GearSixIcon,
};

/** The rail (design.md §2): the shared staff rail with the sales screens, the "Waiting for you" counts and the alerts bell. */
export function Rail({
  items,
  footer,
  badges = {},
  alerts = 0,
}: {
  items: RailItem[];
  footer: ReactNode;
  /** "Waiting for you" counts only (design §2): shown on the item when above zero. */
  badges?: Partial<Record<RailScreen, number>>;
  /** Unread alerts for this user (C23, S62). */
  alerts?: number;
}) {
  const current = screenOf(usePathname());
  return (
    <SharedRail
      items={items.map((i) => ({
        href: i.href,
        label: i.label,
        key: i.screen,
        ...((badges[i.screen] ?? 0) > 0 ? { count: badges[i.screen] as number } : {}),
        ...(i.readOnly ? { title: `${i.label} (view only)` } : {}),
      }))}
      current={current}
      icons={ICONS}
      brand={{ mark: "S", label: "Sales, home", title: "Sales" }}
      extra={<AlertBell unread={alerts} variant="rail" />}
      agentHint="Ask the agent (Ctrl+K)"
      footer={footer}
    />
  );
}
