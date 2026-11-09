import type { ReactNode } from "react";
import { engine } from "../../../lib/engine";
import { SettingsNav } from "./settings-nav";

/** Every settings page. On a wide screen a Settings menu sits to the left, as in the mockup. */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const clock = await engine("/api/demo/clock");
  return (
    <div className="@container">
      <div className="grid gap-8 @[1180px]:grid-cols-[210px_minmax(0,1fr)]">
        <SettingsNav demo={clock.ok} />
        <div className="@container min-w-0">{children}</div>
      </div>
    </div>
  );
}
