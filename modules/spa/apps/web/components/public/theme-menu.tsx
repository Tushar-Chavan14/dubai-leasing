import { ThemeMenu as PlatformThemeMenu } from "@platform/ui/catalogue/theme-menu";
import type { Theme } from "../../lib/theme";
import { ThemeButtons } from "../theme-buttons";

/** The theme switch for the public pages: an icon button that opens a small popover. Plain `details`, so it works without JavaScript. */
export function ThemeMenu({ current }: { current: Theme }) {
  return <PlatformThemeMenu buttons={<ThemeButtons current={current} />} />;
}
