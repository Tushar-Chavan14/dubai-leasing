import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Shell } from "../../components/shell";
import { engine, read } from "../../lib/engine";
import { webEnv } from "../../lib/env";
import { me } from "../../lib/session";
import { THEME_COOKIE, themeOf } from "../../lib/theme";

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const user = await me();
  const clock = await read(await (await engine()).api.demo.clock.$get());
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Shell user={user} clock={clock} theme={theme} portalUrl={webEnv().SPA_PORTAL_URL}>
        {children}
      </Shell>
    </>
  );
}
