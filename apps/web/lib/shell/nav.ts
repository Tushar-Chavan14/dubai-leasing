import type { StaffRole } from "@leasing/core";

export type Screen = "home" | "work" | "units" | "settings" | "maintenance" | "other";

const under = (p: string, base: string) => p === base || p.startsWith(`${base}/`);

/** Which staff screen a path belongs to. The query string is ignored. */
export function screenOf(pathname: string): Screen {
  const p = pathname.split("?")[0]!.split("#")[0]!;
  if (p === "/" || p === "") return "home";
  if (under(p, "/metrics")) return "home";
  if (["/work", "/applications", "/leases", "/tasks", "/conversations"].some((b) => under(p, b))) return "work";
  if (under(p, "/units")) return "units";
  if (under(p, "/settings")) return "settings";
  if (under(p, "/maintenance")) return "maintenance";
  return "other";
}

export function canSeeUnits(role: StaffRole): boolean {
  return role === "admin" || role === "leasing_manager" || role === "leasing_officer";
}

export interface NavItem {
  href: string;
  label: string;
  screen: Screen;
  count?: number;
}

export function navItems(role: StaffRole, opts: { tenancyOps: boolean; waiting: number }): NavItem[] {
  return [
    { href: "/", label: "Home", screen: "home", ...(opts.waiting > 0 ? { count: opts.waiting } : {}) },
    { href: "/work", label: "Workspace", screen: "work" },
    ...(canSeeUnits(role) ? [{ href: "/units", label: "Units", screen: "units" as const }] : []),
    ...(opts.tenancyOps ? [{ href: "/maintenance", label: "Maintenance", screen: "maintenance" as const }] : []),
    { href: "/settings", label: "Settings", screen: "settings" },
  ];
}
