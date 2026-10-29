import { type Actor, type CalendarDate, newId, type StaffRole } from "@leasing/core";
import { companies, leases, parties, type Tx, units } from "@leasing/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { notFound, unprocessable } from "../errors.ts";
import { appendEvent } from "./events.ts";

/**
 * The company is the landlord (D44). Its legal record is a `parties` row of kind `company` (name EN/AR, email, phone,
 * trade licence number and expiry), linked by `companies.party_id`; the fields a party has no column for (authority,
 * RERA ORN, address, cheque payee, authorised signatory) are columns on `companies`. Leases, signing and the Ejari
 * payload read the party like any other party, so nothing downstream changed shape.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use a date like 2027-03-31");
const optDate = calendarDate
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const EID_FORMAT = /^784-\d{4}-\d{7}-\d$/;

/** The legal (landlord) details. Cross-field and clock checks (expiry in the future) run in `updateCompanyLegal`. */
export const CompanyLegalInput = z
  .object({
    legalNameEn: text(200),
    legalNameAr: optText(200),
    tradeLicenceNo: text(60),
    tradeLicenceAuthority: text(120),
    tradeLicenceExpiresOn: calendarDate,
    reraOrn: optText(60),
    registeredAddress: text(400),
    email: z.string().trim().email().max(200),
    phone: optText(40),
    chequePayeeName: optText(200),
    signatoryName: text(200),
    signatoryTitle: text(120),
    signatoryEmail: z.string().trim().email().max(200),
    signatoryIdKind: z.enum(["emirates_id", "passport"]),
    signatoryIdNo: text(40),
    signatoryIdExpiresOn: optDate,
  })
  .superRefine((v, c) => {
    if (v.signatoryIdKind === "emirates_id" && !EID_FORMAT.test(v.signatoryIdNo))
      c.addIssue({ code: "custom", path: ["signatoryIdNo"], message: "use the format 784-YYYY-NNNNNNN-N" });
    if (v.signatoryIdKind === "passport" && !/^[A-Za-z0-9]{6,12}$/.test(v.signatoryIdNo))
      c.addIssue({
        code: "custom",
        path: ["signatoryIdNo"],
        message: "enter the passport number (6 to 12 letters or digits)",
      });
  });
export type CompanyLegalInput = z.infer<typeof CompanyLegalInput>;

export type CompanyLegal = {
  [K in keyof CompanyLegalInput]: CompanyLegalInput[K] | null;
};

const FIELDS = Object.keys(CompanyLegalInput.shape) as (keyof CompanyLegalInput)[];
/** Fields that hold an identity number: never written to an event, shown masked outside the leasing roles. */
const ID_FIELDS = new Set<string>(["signatoryIdNo"]);

type CompanyRow = typeof companies.$inferSelect;
type PartyRow = typeof parties.$inferSelect;

/** The company's party, created from its name (and licence number, email) the first time it is needed. */
export async function ensureCompanyParty(tx: Tx, company: CompanyRow): Promise<PartyRow> {
  if (company.partyId) {
    const [p] = await tx.db.select().from(parties).where(eq(parties.id, company.partyId));
    if (p) return p;
  }
  // Lock the company row so two writers can't both create a party; re-check under the lock.
  const [locked] = await tx.db.select().from(companies).where(eq(companies.id, company.id)).for("update");
  if (locked?.partyId) {
    const [p] = await tx.db.select().from(parties).where(eq(parties.id, locked.partyId));
    if (p) return p;
  }
  const id = newId();
  const [p] = await tx.db
    .insert(parties)
    .values({
      id,
      kind: "company",
      fullNameEn: company.name,
      email: company.email,
      tradeLicenceNo: company.tradeLicenceNo,
    })
    .returning();
  await tx.db.update(companies).set({ partyId: id }).where(eq(companies.id, company.id));
  return p!;
}

/**
 * Read-only lookup for read routes (D44): never inserts. A company with no party yet gets a stand-in built from its
 * name, licence number and email, so gaps are reported the same way.
 */
export async function lookupCompanyLandlord(tx: Tx, companyId: string) {
  const [company] = await tx.db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw notFound("company");
  const [found] = company.partyId ? await tx.db.select().from(parties).where(eq(parties.id, company.partyId)) : [];
  const party: PartyRow = found ?? {
    id: company.id,
    kind: "company",
    fullNameEn: company.name,
    fullNameAr: null,
    email: company.email,
    phone: null,
    nationality: null,
    emiratesIdNo: null,
    passportNo: null,
    tradeLicenceNo: company.tradeLicenceNo,
    birthDate: null,
    idExpiresOn: null,
    passportExpiresOn: null,
    visaNo: null,
    visaExpiresOn: null,
    tradeLicenceExpiresOn: null,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
  return { company, party };
}

/** The unit's landlord: its company, its party and the legal fields, merged. */
export async function companyLandlord(tx: Tx, companyId: string) {
  const [company] = await tx.db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw notFound("company");
  const party = await ensureCompanyParty(tx, company);
  return { company: { ...company, partyId: party.id }, party };
}

export function legalView(company: CompanyRow, party: PartyRow): CompanyLegal {
  return {
    legalNameEn: party.fullNameEn,
    legalNameAr: party.fullNameAr,
    tradeLicenceNo: party.tradeLicenceNo,
    tradeLicenceAuthority: company.tradeLicenceAuthority,
    tradeLicenceExpiresOn: party.tradeLicenceExpiresOn,
    reraOrn: company.reraOrn,
    registeredAddress: company.registeredAddress,
    email: party.email,
    phone: party.phone,
    chequePayeeName: company.chequePayeeName,
    signatoryName: company.signatoryName,
    signatoryTitle: company.signatoryTitle,
    signatoryEmail: company.signatoryEmail,
    signatoryIdKind: company.signatoryIdKind,
    signatoryIdNo: company.signatoryIdNo,
    signatoryIdExpiresOn: company.signatoryIdExpiresOn,
  };
}

const LABEL: Record<string, string> = {
  legalNameEn: "legal name",
  tradeLicenceNo: "trade licence number",
  tradeLicenceAuthority: "licence issuing authority",
  tradeLicenceExpiresOn: "trade licence expiry",
  registeredAddress: "registered address",
  email: "email",
  signatoryName: "authorised signatory name",
  signatoryTitle: "signatory title",
  signatoryEmail: "signatory email",
  signatoryIdNo: "signatory Emirates ID or passport number",
};

/**
 * What a contract can't be prepared without: the legal details and the signatory. Empty list means complete. The
 * trade licence must also be unexpired on `today`.
 */
export function landlordGaps(company: CompanyRow, party: PartyRow, today: CalendarDate): string[] {
  const v = legalView(company, party);
  const gaps = Object.keys(LABEL)
    .filter((k) => k !== "tradeLicenceExpiresOn")
    .filter((k) => !String(v[k as keyof CompanyLegal] ?? "").trim())
    .map((k) => LABEL[k]!);
  if (!v.tradeLicenceExpiresOn) gaps.push(LABEL.tradeLicenceExpiresOn!);
  else if (v.tradeLicenceExpiresOn < today) gaps.push("a trade licence that has not expired");
  return gaps;
}

/** The message staff see when a contract is blocked by missing landlord details. */
export function landlordGapMessage(companyName: string, gaps: string[]): string {
  return `Complete ${companyName}'s legal details in Settings → Companies (missing: ${gaps.join(", ")}).`;
}

const maskTail = (v: string, keep = 3) =>
  v.length <= keep ? "*".repeat(v.length) : "*".repeat(v.length - keep) + v.slice(-keep);

/** Legal details for the staff form: the signatory's ID number and the licence number are masked for finance only. */
export function legalForRole(company: CompanyRow, party: PartyRow, role: StaffRole): CompanyLegal {
  const v = legalView(company, party);
  if (role !== "finance") return v;
  return {
    ...v,
    signatoryIdNo: v.signatoryIdNo ? maskTail(v.signatoryIdNo) : null,
    tradeLicenceNo: v.tradeLicenceNo ? maskTail(v.tradeLicenceNo) : null,
  };
}

/** What a landlord signer types, and the capacity printed beside it (D44). Null until a signatory is on record. */
export function landlordSigner(company: CompanyRow, party: PartyRow) {
  if (!company.signatoryName) return null;
  return {
    name: company.signatoryName,
    capacity: `${company.signatoryTitle ?? "Authorised signatory"}, for and on behalf of ${party.fullNameEn}`,
    email: company.signatoryEmail ?? party.email,
  };
}

/**
 * Saves the legal details: company columns plus the company's party row, in one transaction. The audit event holds
 * the actor and the names of the changed fields only, never their values.
 */
export async function updateCompanyLegal(
  ctx: EngineContext,
  tx: Tx,
  companyId: string,
  input: CompanyLegalInput,
  actor: Actor,
) {
  const today = ctx.clock.today();
  const problems: string[] = [];
  if (input.tradeLicenceExpiresOn <= today)
    problems.push("tradeLicenceExpiresOn: the trade licence must expire in the future");
  if (input.signatoryIdExpiresOn && input.signatoryIdExpiresOn <= today)
    problems.push("signatoryIdExpiresOn: the signatory's ID has expired");
  if (problems.length) throw unprocessable("company legal details can't be saved this way", problems, "invalid_legal");

  const [row] = await tx.db.select().from(companies).where(eq(companies.id, companyId)).for("update");
  if (!row) throw notFound("company");
  const party = await ensureCompanyParty(tx, row);
  const before = legalView(row, party);
  const changed = FIELDS.filter((k) => (before[k] ?? null) !== (input[k] ?? null));

  await tx.db
    .update(parties)
    .set({
      fullNameEn: input.legalNameEn,
      fullNameAr: input.legalNameAr,
      email: input.email,
      phone: input.phone,
      tradeLicenceNo: input.tradeLicenceNo,
      tradeLicenceExpiresOn: input.tradeLicenceExpiresOn as CalendarDate,
      updatedAt: ctx.clock.now(),
    })
    .where(eq(parties.id, party.id));
  await tx.db
    .update(companies)
    .set({
      tradeLicenceNo: input.tradeLicenceNo,
      email: input.email,
      tradeLicenceAuthority: input.tradeLicenceAuthority,
      reraOrn: input.reraOrn,
      registeredAddress: input.registeredAddress,
      chequePayeeName: input.chequePayeeName,
      signatoryName: input.signatoryName,
      signatoryTitle: input.signatoryTitle,
      signatoryEmail: input.signatoryEmail,
      signatoryIdKind: input.signatoryIdKind,
      signatoryIdNo: input.signatoryIdNo,
      signatoryIdExpiresOn: input.signatoryIdExpiresOn as CalendarDate | null,
      updatedAt: ctx.clock.now(),
    })
    .where(eq(companies.id, companyId));
  if (changed.length) {
    await appendEvent(tx, ctx, {
      entity: { kind: "company", id: companyId },
      type: "COMPANY_LEGAL_UPDATED",
      actor,
      payload: { changedFields: changed, idChanged: changed.some((k) => ID_FIELDS.has(k)) },
      rulesVersion: ctx.rulesVersion,
    });
  }
  return { changedFields: changed };
}

/** Legal name of the lease's landlord: the unit's company (D44). Used in notices and emails. */
export async function landlordNameForLease(tx: Tx, leaseId: string): Promise<string> {
  const [row] = await tx.db
    .select({ name: parties.fullNameEn, companyName: companies.name })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(companies, eq(companies.id, units.companyId))
    .leftJoin(parties, eq(parties.id, companies.partyId))
    .where(eq(leases.id, leaseId));
  return row?.name ?? row?.companyName ?? "The landlord";
}
