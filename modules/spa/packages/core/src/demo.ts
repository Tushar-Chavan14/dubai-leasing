import type { SpaRole } from "./roles.ts";

/**
 * The demo cast (S80): the four people a presenter needs for most of a sale, in the order the sign-in page shows them.
 * Only how the demo is presented; roles, gates and approvers are not touched. `email` is the seeded demo user who is the
 * cast member for the role (a second user with the same role is never the cast).
 */
export const DEMO_CAST: readonly { role: SpaRole; email: string; hint: string }[] = Object.freeze([
  {
    role: "sales_officer",
    email: "officer@spa-demo.test",
    hint: "Listings, leads, viewings, deals, documents",
  },
  {
    role: "sales_manager",
    email: "manager@spa-demo.test",
    hint: "Verifies sellers, approves price, KYC and cancellations",
  },
  { role: "legal", email: "legal@spa-demo.test", hint: "Approves templates and agreements" },
  { role: "admin", email: "admin@spa-demo.test", hint: "Settings, inventory, demo clock" },
]);

/** What each back-office role does when a step needs it; shown in the sign-in disclosure. */
const BACK_OFFICE_HINT: Readonly<Partial<Record<SpaRole, string>>> = Object.freeze({
  sales_admin: "NOC, Oqood and transfer submissions",
  finance: "Settlement and refunds",
  compliance_officer: "AML review",
  mlro: "Reports",
});

/** The short label after a demo person's first name: "Rania (Agent)". */
export const DEMO_SHORT_ROLE: Readonly<Record<SpaRole, string>> = Object.freeze({
  sales_officer: "Agent",
  sales_manager: "Manager",
  sales_admin: "Sales admin",
  legal: "Legal",
  compliance_officer: "Compliance",
  mlro: "MLRO",
  finance: "Finance",
  admin: "Admin",
});

/** The one-line "what you'll show" for a role, or an empty string for a role with none. */
export function castHint(role: SpaRole): string {
  return DEMO_CAST.find((c) => c.role === role)?.hint ?? BACK_OFFICE_HINT[role] ?? "";
}

/** True for the four people shown up front. */
export const isCastEmail = (email: string): boolean => DEMO_CAST.some((c) => c.email === email);

/** A same-site path or "/": anything else (another host, a protocol-relative address, a backslash trick) is "/". */
export function safeReturnTo(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 0x20) return "/";
  return value;
}
