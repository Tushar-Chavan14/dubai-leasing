import { maskPiiText } from "@platform/kernel/pii";
import type { SpaRole } from "@spa/core";
import { bankLetters, deals, nocRecords } from "@spa/db";
import { and, asc, eq, ne } from "drizzle-orm";
import type { SpaContext } from "./context.ts";
import { forbidden, notFound } from "./errors.ts";

const READERS: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "admin", "legal", "finance"];

/**
 * A deal's developer NOC and bank letters as a staff member reads them (C36, S68): status, dates and amounts a person
 * confirmed. No document id, file or name printed on a document leaves here. Read only.
 */
export async function nocStatus(ctx: SpaContext, dealId: string, user: { role: SpaRole }) {
  if (!READERS.includes(user.role)) throw forbidden("your role can't read the NOC and bank letters");
  const [d] = await ctx.database.db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  return nocStatusView(ctx, dealId);
}

/** The NOC and bank letters with no role check: the caller (a route or a record section) has made it. */
export async function nocStatusView(ctx: SpaContext, dealId: string) {
  const db = ctx.database.db;
  const [noc] = await db
    .select()
    .from(nocRecords)
    .where(and(eq(nocRecords.dealId, dealId), ne(nocRecords.status, "superseded")));
  const letters = await db
    .select()
    .from(bankLetters)
    .where(and(eq(bankLetters.dealId, dealId), eq(bankLetters.status, "current")))
    .orderBy(asc(bankLetters.enteredAt), asc(bankLetters.id));
  return {
    noc: noc
      ? {
          status: noc.status,
          issuedOn: noc.issuedOn,
          expiresOn: noc.expiresOn,
          serviceChargesCleared: noc.serviceChargesCleared,
          paidFils: noc.paidFils,
          paidConfirmed: noc.paidConfirmedBy !== null,
          mismatches: noc.mismatches.map((m) => maskPiiText(m)),
        }
      : null,
    bankLetters: letters.map((l) => ({
      side: l.side,
      kind: l.kind,
      issuedOn: l.issuedOn,
      validUntil: l.validUntil,
      amountFils: l.amountFils,
      confirmed: l.confirmedBy !== null,
    })),
  };
}
