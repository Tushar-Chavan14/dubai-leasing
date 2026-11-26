import type { SpaRole } from "@spa/core";

/** The roles that add and change listings (the engine's `requireListings(..., "write")`); the others only read. */
export const LISTING_WRITERS: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin"];
export const canWriteListings = (role: SpaRole): boolean => LISTING_WRITERS.includes(role);
