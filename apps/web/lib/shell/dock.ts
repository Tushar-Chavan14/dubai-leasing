import type { Screen } from "./nav";

export const DOCK_KEY = (s: Screen) => `dock:${s}`;

/** Below this width the dock is an overlay sheet, closed by default. */
export const DOCK_MIN_WIDTH = 1200;

/** Open by default on every screen except Units, and never on narrow viewports. */
export function dockDefault(screen: Screen, viewportWidth: number): boolean {
  return screen !== "units" && viewportWidth >= DOCK_MIN_WIDTH;
}
