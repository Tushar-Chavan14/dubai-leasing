import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { StaffShell } from "../../components/shell/staff-shell";
import { engine } from "../../lib/engine";
import { TENANCY_OPS } from "../../lib/env";
import { THEME_COOKIE, themeOf } from "../../lib/theme";
import type { Me } from "../../lib/types";

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
      <StaffShell
        me={me.ok ? me.data : null}
        waiting={waiting}
        clock={clock.ok ? clock.data : null}
        theme={theme}
        tenancyOps={TENANCY_OPS}
      >
        {children}
      </StaffShell>
    </>
  );
}
