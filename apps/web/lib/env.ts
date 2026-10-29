/** Server-side only. TENANCY_OPS: move-in through move-out is on (default off). */
export const TENANCY_OPS = process.env.TENANCY_OPS === "true" || process.env.TENANCY_OPS === "1";
