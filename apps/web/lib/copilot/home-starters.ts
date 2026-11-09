/**
 * Home's suggestion list for the dock's empty state. The Home page publishes it (it is built from live counts) and
 * the dock, mounted once in the shell, reads it. A tiny store keeps the two independent of mount order.
 */
export const HOME_STARTERS_EVENT = "copilot:home-starters";

let current: string[] | null = null;

export function setHomeStarters(list: string[] | null): void {
  current = list;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(HOME_STARTERS_EVENT));
}

export const getHomeStarters = (): string[] | null => current;
