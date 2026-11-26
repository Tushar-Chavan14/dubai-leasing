"use client";

import { BuildingsIcon, GearSixIcon, HouseSimpleIcon, StackIcon, WrenchIcon } from "@phosphor-icons/react";
import { Rail as SharedRail, type ShellIcon } from "@platform/ui/shell/rail";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { screenOf, type NavItem, type Screen } from "../../lib/shell/nav";

const ICONS: Record<Screen, ShellIcon> = {
  home: HouseSimpleIcon,
  work: StackIcon,
  units: BuildingsIcon,
  maintenance: WrenchIcon,
  settings: GearSixIcon,
  other: HouseSimpleIcon,
};

/** The left rail (shared shell): leasing's screens, icons and brand. */
export function Rail({ items, footer }: { items: NavItem[]; footer: ReactNode }) {
  const current = screenOf(usePathname());
  return (
    <SharedRail
      items={items.map((i) => ({
        href: i.href,
        label: i.label,
        key: i.screen,
        ...(i.count ? { count: i.count } : {}),
      }))}
      current={current}
      icons={ICONS}
      brand={{ mark: "DL", label: "UAE Leasing, overview", title: "UAE Leasing Contract AI" }}
      footer={footer}
    />
  );
}
