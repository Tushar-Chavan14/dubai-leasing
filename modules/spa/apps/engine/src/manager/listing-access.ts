import type { CompanyKind, SpaRole } from "@spa/core";
import type { SpaDb } from "@spa/db";
import { forbidden } from "./errors.ts";
import { CATALOGUE_READERS } from "./inventory.ts";
import { companyKind } from "./parties.ts";
import { hasAnyRole } from "@spa/core";

type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };
const SALES_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin"];

/**
 * Reads: the catalogue readers. Writes (a draft, an offer): the three sales roles. A developer company has no listings,
 * whoever asks. Its own small module (M6) so the offers code can use it without importing the listing screens.
 */
export async function requireListings(db: SpaDb, user: Person, mode: "read" | "write"): Promise<CompanyKind> {
  const kind = await companyKind(db);
  if (kind === "developer") throw forbidden("this company keeps inventory, not listings");
  const roles = mode === "write" ? SALES_ROLES : CATALOGUE_READERS;
  if (!hasAnyRole(user, roles))
    throw forbidden(mode === "write" ? "only sales roles add a listing" : "you can't read the listings");
  return kind;
}
