import { z } from "zod";

/** SPA staff roles (decision S3), stored in the SPA database's `spa_users`. Never leasing's roles. */
export const SpaRole = z.enum([
  "sales_officer",
  "sales_manager",
  "sales_admin",
  "legal",
  "compliance_officer",
  "mlro",
  "finance",
  "admin",
]);
export type SpaRole = z.infer<typeof SpaRole>;

export const SPA_ROLE_LABELS: Readonly<Record<SpaRole, string>> = Object.freeze({
  sales_officer: "Sales officer",
  sales_manager: "Sales manager",
  sales_admin: "Sales admin",
  legal: "Legal",
  compliance_officer: "Compliance officer",
  mlro: "MLRO",
  finance: "Finance",
  admin: "Admin",
});

/** What the company does (S12): `developer` has inventory, `brokerage` has listings, `both` has both. */
export const CompanyKind = z.enum(["developer", "brokerage", "both"]);
export type CompanyKind = z.infer<typeof CompanyKind>;
/** Until companies exist (P4b), every install is `both` (decision S33). */
export const DEFAULT_COMPANY_KIND: CompanyKind = "both";

export type RailScreen = "home" | "work" | "inventory" | "listings" | "compliance" | "settings";
export interface RailItem {
  screen: RailScreen;
  label: string;
  href: string;
  /** Settings for a sales manager: can look, can't change (enforced by the engine, not the rail). */
  readOnly?: boolean;
}

const SALES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin"];

/**
 * The rail items a role sees (design.md §2–3, S33). A hidden item is only a convenience: the engine still refuses
 * what a role may not do.
 */
export function railItems(role: SpaRole, kind: CompanyKind = DEFAULT_COMPANY_KIND): RailItem[] {
  const items: RailItem[] = [{ screen: "home", label: "Home", href: "/" }];
  if ([...SALES, "legal", "finance"].includes(role)) items.push({ screen: "work", label: "Work", href: "/work" });
  const sellsOrAdmin = [...SALES, "admin"].includes(role);
  if (sellsOrAdmin && kind !== "brokerage") items.push({ screen: "inventory", label: "Inventory", href: "/inventory" });
  if (sellsOrAdmin && kind !== "developer") items.push({ screen: "listings", label: "Listings", href: "/listings" });
  if (role === "compliance_officer" || role === "mlro")
    items.push({ screen: "compliance", label: "Compliance", href: "/compliance" });
  if (role === "admin") items.push({ screen: "settings", label: "Settings", href: "/settings" });
  if (role === "sales_manager")
    items.push({ screen: "settings", label: "Settings", href: "/settings", readOnly: true });
  return items;
}

/** The rail screen a path belongs to. */
export function screenOf(path: string): RailScreen {
  const first = path.split("/")[1] ?? "";
  const known: RailScreen[] = ["work", "inventory", "listings", "compliance", "settings"];
  return (known as string[]).includes(first) ? (first as RailScreen) : "home";
}
