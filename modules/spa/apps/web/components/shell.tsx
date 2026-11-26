import { SignOutIcon } from "@phosphor-icons/react/dist/ssr";
import { type CompanyKind, railItems, type SpaRole } from "@spa/core/roles";
import type { ReactNode } from "react";
import { signOut } from "../app/sign-in/actions";
import { initials, weekdayDate } from "../lib/format";
import type { Theme } from "../lib/theme";
import { AvatarMenu } from "./avatar-menu";
import { CopilotDock } from "./copilot-dock";
import { DemoSwitcher, type DemoUserItem } from "./demo-switcher";
import { PortalLink } from "./portal-link";
import { Rail } from "./rail";
import { ThemeButtons } from "./theme-buttons";

export interface ShellUser {
  name: string;
  email?: string | undefined;
  role: SpaRole;
  roleLabel: string;
  companyKind: CompanyKind;
}

const MENU_BUTTON =
  "inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-line bg-transparent font-sans text-sm font-semibold !text-ink no-underline hover:bg-raised";

/**
 * rail · main · copilot dock (design.md §2). The avatar menu holds name and role, today's date, the demo clock when
 * on, theme, Portal and Sign out. Nothing here names, links or counts another module (S21).
 */
export function Shell({
  user,
  clock,
  theme,
  portalUrl,
  waiting = 0,
  alerts = 0,
  demoUsers = [],
  children,
}: {
  user: ShellUser;
  clock: { today: string; offsetDays: number; demo: boolean } | null;
  theme: Theme;
  portalUrl: string;
  /** Open gates and tasks for this role: the badge on Work. */
  waiting?: number;
  /** Unread alerts for this user (C23, S62): the bell. */
  alerts?: number;
  /** Demo mode only (S80): the demo users for the avatar menu's quick switcher. Empty with demo mode off. */
  demoUsers?: readonly DemoUserItem[];
  children: ReactNode;
}) {
  const footer = (
    <AvatarMenu initials={initials(user.name)} name={user.name}>
      <div className="grid leading-tight">
        <b className="truncate font-semibold">{user.name}</b>
        <span className="text-xs text-muted">{user.roleLabel}</span>
      </div>
      {clock && (
        <div className="grid gap-0.5 leading-tight">
          <strong className="font-semibold">{weekdayDate(clock.today)}</strong>
          <span className={`text-xs ${clock.demo && clock.offsetDays ? "text-warning" : "text-muted"}`}>
            {clock.demo && clock.offsetDays ? `Demo clock, ${clock.offsetDays} days ahead` : "UAE time"}
          </span>
        </div>
      )}
      <DemoSwitcher users={demoUsers} currentEmail={user.email} demo={!!clock?.demo} />
      <ThemeButtons current={theme} />
      <PortalLink href={portalUrl} className={MENU_BUTTON} />
      <form action={signOut}>
        <button type="submit" className={MENU_BUTTON}>
          <SignOutIcon size={16} aria-hidden />
          Sign out
        </button>
      </form>
    </AvatarMenu>
  );
  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <Rail items={railItems(user.role, user.companyKind)} footer={footer} badges={{ work: waiting }} alerts={alerts} />
      <main
        id="main"
        className="min-w-0 flex-1 px-6 pt-9 pb-24 max-sm:px-4 max-sm:pt-6 max-sm:pb-[72px] has-[[data-wk]]:p-0"
      >
        {children}
      </main>
      <CopilotDock role={user.role} />
    </div>
  );
}
