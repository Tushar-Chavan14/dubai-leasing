import { SignOutIcon, SquaresFourIcon } from "@phosphor-icons/react/dist/ssr";
import { railItems, type SpaRole } from "@spa/core/roles";
import type { ReactNode } from "react";
import { signOut } from "../app/sign-in/actions";
import { initials, weekdayDate } from "../lib/format";
import type { Theme } from "../lib/theme";
import { AvatarMenu } from "./avatar-menu";
import { CopilotDock } from "./copilot-dock";
import { Rail } from "./rail";
import { ThemeButtons } from "./theme-buttons";

export interface ShellUser {
  name: string;
  role: SpaRole;
  roleLabel: string;
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
  children,
}: {
  user: ShellUser;
  clock: { today: string; offsetDays: number; demo: boolean } | null;
  theme: Theme;
  portalUrl: string;
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
      <ThemeButtons current={theme} />
      <a href={portalUrl} className={MENU_BUTTON}>
        <SquaresFourIcon size={16} aria-hidden />
        Portal
      </a>
      <form action={signOut}>
        <button type="submit" className={MENU_BUTTON}>
          <SignOutIcon size={16} aria-hidden />
          Sign out
        </button>
      </form>
    </AvatarMenu>
  );
  return (
    <div className="flex min-h-screen bg-page text-ink">
      <Rail items={railItems(user.role)} footer={footer} />
      <main id="main" className="mx-auto w-full min-w-0 max-w-[1240px] flex-1 px-6 pb-24 pt-9 max-sm:px-4 max-sm:pt-6">
        {children}
      </main>
      <CopilotDock />
    </div>
  );
}
