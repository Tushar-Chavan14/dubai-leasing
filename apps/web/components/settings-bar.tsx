import { engine } from "../lib/engine";
import { SettingsTabs } from "./settings-tabs";

/** Server wrapper: shows the Demo tab only when the engine runs in demo mode. */
export async function SettingsBar() {
  const clock = await engine("/api/demo/clock");
  return <SettingsTabs demo={clock.ok} />;
}
