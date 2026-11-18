import Link from "next/link";
import type { ReactNode } from "react";
import { CopilotDock } from "../copilot/dock";
import { ThemeButtons } from "../theme-switch";
import { initials } from "../ui";
import { roleLabel, weekdayDate } from "../../lib/format";
import { SignOutIcon as IconExit } from "@phosphor-icons/react/dist/ssr";
import { navItems } from "../../lib/shell/nav";
import type { Theme } from "../../lib/theme";
import type { Me } from "../../lib/types";
import { logout } from "../../app/login/actions";
import { AvatarMenu } from "./avatar-menu";
import { Rail } from "./rail";
import type { StaffRole } from "@leasing/core";

export interface ShellClock {
  today: string;
  offsetDays: number;
}

/** Three columns: rail, main, dock. The agent dock lives here so it survives navigation. */
export function StaffShell({
  me,
  waiting,
  clock,
  theme,
  tenancyOps,
  children,
}: {
  me: Me | null;
  waiting: number;
  clock: ShellClock | null;
  theme: Theme;
  tenancyOps: boolean;
  children: ReactNode;
}) {
  // Without a user (engine down) show the safest set: no Units.
  const role = (me?.role ?? "finance") as StaffRole;
  const footer = (
    <AvatarMenu initials={me ? initials(me.name) : "?"} name={me?.name ?? "Not signed in"}>
      {me && (
        <div className="grid leading-tight">
          <b className="truncate font-semibold">{me.name}</b>
          <span className="text-xs text-muted">{roleLabel(me.role)}</span>
        </div>
      )}
      {clock && (
        <div className="grid gap-0.5 leading-tight" title="All legal dates use Asia/Dubai calendar days">
          <strong className="font-semibold">{weekdayDate(clock.today)}</strong>
          <Link href="/settings/demo" className={`text-xs ${clock.offsetDays ? "!text-warning" : "!text-muted"}`}>
            {clock.offsetDays ? `Demo clock, ${clock.offsetDays} days ahead` : "UAE time, demo clock"}
          </Link>
        </div>
      )}
      <ThemeButtons current={theme} />
      {me && (
        <form action={logout}>
          <button
            type="submit"
            className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-line bg-transparent font-sans text-sm font-semibold text-ink"
          >
            <IconExit size={16} aria-hidden />
            Sign out
          </button>
        </form>
      )}
    </AvatarMenu>
  );
  return (
    <div className="flex min-h-screen bg-page text-ink">
      <Rail items={navItems(role, { tenancyOps, waiting })} footer={footer} />
      <main
        id="main"
        className="min-w-0 flex-1 px-6 pt-9 pb-24 max-sm:px-4 max-sm:pt-6 max-sm:pb-[72px] has-[[data-wk]]:p-0"
      >
        {children}
      </main>
      <CopilotDock today={clock?.today ?? ""} />
    </div>
  );
}
