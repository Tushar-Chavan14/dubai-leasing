"use client";

import { SquaresFourIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HUB } from "../../../lib/settings/hub";
import { SETTINGS_ICONS } from "./settings-icons";

/** Settings menu beside the page, shown only when the screen is wide. Narrower screens use the back link. */
export function SettingsNav({ demo }: { demo: boolean }) {
  const path = usePathname();
  const link = (href: string, label: string, Icon: (typeof SETTINGS_ICONS)[string], on: boolean) => (
    <Link
      key={href}
      href={href}
      aria-current={on ? "page" : undefined}
      className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm text-ink! no-underline hover:bg-raised aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-on-accent! focus-visible:outline-2 focus-visible:outline-ink"
    >
      <Icon size={17} aria-hidden />
      {label}
    </Link>
  );
  return (
    <nav
      aria-label="Settings"
      className="grid content-start gap-0.5 self-start [position:sticky] top-4 @max-[1180px]:hidden"
    >
      <h2 className="m-0 px-2.5 pb-3 font-sans text-base font-semibold tracking-tight text-ink">Settings</h2>
      {link("/settings", "Overview", SquaresFourIcon, path === "/settings")}
      {HUB.map((g) => {
        const items = g.items.filter((i) => demo || !i.demoOnly);
        if (items.length === 0) return null;
        return (
          <div key={g.group} className="grid gap-0.5">
            <span className="px-2.5 pb-1 pt-3.5 text-[11.5px] text-muted">{g.group}</span>
            {items.map((i) =>
              link(i.href, i.title, SETTINGS_ICONS[i.href] ?? SquaresFourIcon, path.startsWith(i.href)),
            )}
          </div>
        );
      })}
    </nav>
  );
}
