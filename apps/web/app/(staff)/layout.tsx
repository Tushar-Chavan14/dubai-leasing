import Link from "next/link";
import type { ReactNode } from "react";
import { CopilotPanel } from "../../components/copilot/panel";
import { Nav } from "../../components/nav";
import { initials } from "../../components/ui";
import { engine } from "../../lib/engine";
import { canDecideApproval, roleLabel, weekdayDate } from "../../lib/format";
import { BrandMark, IconExit } from "../../lib/icons";
import type { ApprovalRow, Me } from "../../lib/types";
import { logout } from "../login/actions";

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const [me, clock, pending] = await Promise.all([
    engine<Me>("/api/me"),
    engine<{ today: string; offsetDays: number }>("/api/demo/clock"),
    engine<ApprovalRow[]>("/api/approvals?status=pending"),
  ]);
  const mine = me.ok && pending.ok ? pending.data.filter((a) => canDecideApproval(a, me.data)).length : 0;

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand" aria-label="Dubai Leasing, overview">
            <BrandMark />
            Dubai Leasing
          </Link>
          <Nav inboxCount={mine} />
          <div className="session">
            {clock.ok && (
              <div className="today-chip" title="All legal dates use Asia/Dubai calendar days">
                <strong>{weekdayDate(clock.data.today)}</strong>
                {clock.data.offsetDays ? (
                  <Link href="/demo" className="demo">
                    Demo clock, {clock.data.offsetDays} days ahead
                  </Link>
                ) : (
                  <Link href="/demo">Dubai, demo clock</Link>
                )}
              </div>
            )}
            <CopilotPanel />
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
