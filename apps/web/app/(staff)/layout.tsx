import Link from "next/link";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { CopilotPanel } from "../../components/copilot/panel";
import { Nav } from "../../components/nav";
import { ThemeSwitch } from "../../components/theme-switch";
import { initials } from "../../components/ui";
import { engine } from "../../lib/engine";
import { TENANCY_OPS } from "../../lib/env";
import { roleLabel, weekdayDate } from "../../lib/format";
import { BrandMark, IconExit } from "../../lib/icons";
import { THEME_COOKIE, themeOf } from "../../lib/theme";
import type { Me } from "../../lib/types";
import { logout } from "../login/actions";

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const [me, clock, home] = await Promise.all([
    engine<Me>("/api/me"),
    engine<{ today: string; offsetDays: number }>("/api/demo/clock"),
    engine<{ waitingForYou: number }>("/api/home"),
  ]);
  const waiting = home.ok ? home.data.waitingForYou : 0;
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand" aria-label="Dubai Leasing, overview">
            <BrandMark />
            Dubai Leasing Contract AI
          </Link>
          <Nav waitingCount={waiting} maintenance={TENANCY_OPS} />
          <div className="session">
            {clock.ok && (
              <div className="today-chip" title="All legal dates use Asia/Dubai calendar days">
                <strong>{weekdayDate(clock.data.today)}</strong>
                {clock.data.offsetDays ? (
                  <Link href="/settings/demo" className="demo">
                    Demo clock, {clock.data.offsetDays} days ahead
                  </Link>
                ) : (
                  <Link href="/settings/demo">Dubai, demo clock</Link>
                )}
              </div>
            )}
            <CopilotPanel />
            <ThemeSwitch current={theme} />
            {me.ok && (
              <div className="user-chip">
                <span className="avatar" aria-hidden="true">
                  {initials(me.data.name)}
                </span>
                <span className="who">
                  <b>{me.data.name}</b>
                  <span>{roleLabel(me.data.role)}</span>
                </span>
                <form action={logout}>
                  <button className="btn ghost icon" type="submit" title="Sign out" aria-label="Sign out">
                    <IconExit size={17} />
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="page">
        {children}
      </main>
    </>
  );
}
