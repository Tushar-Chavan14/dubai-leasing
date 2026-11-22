import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Shell } from "../../components/shell";
import { engine, engineGet, read } from "../../lib/engine";
import { loadAlerts, loadSummary } from "../../lib/loaders";
import { webEnv } from "../../lib/env";
import { me } from "../../lib/session";
import { THEME_COOKIE, themeOf } from "../../lib/theme";
import { waitingCount } from "../../lib/work";

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const user = await me();
  const clock = await read(await (await engine()).api.demo.clock.$get());
  const waiting = waitingCount(await loadSummary(engineGet));
  const alerts = (await loadAlerts(engineGet))?.unread ?? 0;
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Shell
        user={user}
        clock={clock}
        theme={theme}
        portalUrl={webEnv().SPA_PORTAL_URL}
        waiting={waiting}
        alerts={alerts}
      >
        {children}
      </Shell>
    </>
  );
}
