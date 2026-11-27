import Link from "next/link";
import type { ReactNode } from "react";
import { CopilotDock } from "../copilot/dock";
import { ThemeButtons } from "../theme-switch";
import { initials } from "../ui";
import { roleLabel, weekdayDate } from "../../lib/format";
import { CalendarBlankIcon, SignOutIcon as IconExit } from "@phosphor-icons/react/dist/ssr";
import { navItems } from "../../lib/shell/nav";
import type { Theme } from "../../lib/theme";
import type { Me } from "../../lib/types";
import { logout } from "../../app/login/actions";
import { AvatarMenu } from "./avatar-menu";
import { PortalLink } from "./portal-link";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import type { StaffRole } from "@leasing/core";

export interface ShellClock {
  today: string;
  offsetDays: number;
}

/**
 * Sidebar, then the page column (sticky top bar over the page) and the agent dock. The dock lives here so it survives
 * navigation.
 */
export function StaffShell({
  me,
  waiting,
  clock,
  theme,
  tenancyOps,
  portalUrl,
  children,
}: {
  me: Me | null;
  waiting: number;
  clock: ShellClock | null;
  theme: Theme;
  tenancyOps: boolean;
  /** `LEASING_PORTAL_URL`: the "Portal" link in the avatar menu. */
  portalUrl: string;
  children: ReactNode;
}) {
  // Without a user (engine down) show the safest set: no Units.
  const role = (me?.role ?? "finance") as StaffRole;
  const items = navItems(role, { tenancyOps, waiting });
  const signOut = me && (
    <form action={logout}>
      <button
        type="submit"
        className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-line bg-transparent font-sans text-sm font-semibold text-ink"
      >
        <IconExit size={16} aria-hidden />
        Sign out
      </button>
    </form>
  );
  const account = (
    <AvatarMenu placement="top" initials={me ? initials(me.name) : "?"} name={me?.name ?? "Not signed in"}>
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
      <PortalLink href={portalUrl} />
      {signOut}
    </AvatarMenu>
  );
  const context = clock && (
    <Link
      href="/settings/demo"
      className={`ls-ctx${clock.offsetDays ? " ls-ctx-warn" : ""}`}
      title="All legal dates use Asia/Dubai calendar days"
    >
      <CalendarBlankIcon size={15} aria-hidden />
      <span>
        {weekdayDate(clock.today)} · {clock.offsetDays ? `Demo clock, ${clock.offsetDays} days ahead` : "UAE time"}
      </span>
    </Link>
  );
  const user = (
    <div className="ls-suser">
      <span className="ls-avatar" aria-hidden="true">
        {me ? initials(me.name) : "?"}
      </span>
      <div>
        <b>{me?.name ?? "Not signed in"}</b>
        {me && <small>{roleLabel(me.role)}</small>}
      </div>
      {me && (
        <form action={logout}>
          <button type="submit" className="ls-slog" aria-label="Sign out" title="Sign out">
            <IconExit size={17} aria-hidden />
          </button>
        </form>
      )}
    </div>
  );
  return (
    <div className="ls-shell flex min-h-screen bg-canvas text-ink">
      <Sidebar items={items} roleLabel={me ? roleLabel(me.role) : "Staff"} user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar items={items} context={context} account={account} />
        <main id="main" className="ls-main has-[[data-wk]]:p-0">
          {children}
        </main>
      </div>
      <CopilotDock today={clock?.today ?? ""} />
    </div>
  );
}
