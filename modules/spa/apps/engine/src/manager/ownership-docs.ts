import { dealParties, documents, parties, type SpaDb } from "@spa/db";
import { and, desc, eq, notExists, sql } from "drizzle-orm";
import { currentCompanyDocuments } from "./company-facts.ts";
import { docsHashOf } from "./kyc-facts.ts";

/** The deal's current ownership document: the title deed (ready) or the Oqood (off-plan); the latest upload. */
export async function currentDeed(db: SpaDb, deal: { id: string; dealType: string }) {
  const later = db
    .select({ one: sql`1` })
    .from(sql`${documents} as d2`)
    .where(sql`d2.supersedes_id = ${documents.id}`);
  const [doc] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.dealId, deal.id),
        eq(documents.kind, deal.dealType === "resale_offplan" ? "oqood" : "title_deed"),
        notExists(later),
      ),
    )
    .orderBy(desc(documents.uploadedAt), desc(documents.id))
    .limit(1);
  return doc;
}

/** Each company seller's current trade licence document (its name is read to match a company owner). */
export async function sellerLicences(db: SpaDb, dealId: string) {
  const sellers = await db
    .select({ id: parties.id, name: parties.fullNameEn, kind: parties.kind })
    .from(dealParties)
    .innerJoin(parties, eq(parties.id, dealParties.partyId))
    .where(and(eq(dealParties.dealId, dealId), eq(dealParties.role, "seller")))
    .orderBy(dealParties.order);
  const out = [];
  for (const s of sellers) {
    const doc =
      s.kind === "company"
        ? (await currentCompanyDocuments(db, dealId, s.id)).find((d) => d.kind === "trade_licence")
        : undefined;
    out.push({ ...s, licence: doc });
  }
  return out;
}

/** The ownership documents on file now and their hash, or null while no deed is uploaded. */
export async function currentOwnershipDocs(db: SpaDb, deal: { id: string; dealType: string }) {
  const deed = await currentDeed(db, deal);
  if (!deed) return null;
  const licences = (await sellerLicences(db, deal.id)).flatMap((s) => (s.licence ? [s.licence] : []));
  return { deed, licences, hash: docsHashOf([deed, ...licences]) };
}
