import { newId } from "@platform/kernel/ids";
import {
  BeneficialOwner,
  type CompanyKind,
  CompanyKind as CompanyKindSchema,
  DEFAULT_COMPANY_KIND,
  Party,
  Signatory,
  type SpaActor,
} from "@spa/core";
import {
  beneficialOwners,
  companies,
  companyDetails,
  parties,
  signatories,
  type SpaDb,
  type SpaTx,
  withSpaTx,
} from "@spa/db";
import { and, eq, sum } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { normaliseName } from "./names.ts";

const invalid = (code: string, e: z.ZodError) =>
  unprocessable(
    code,
    "the input isn't valid",
    e.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  );

/** A person or company party (S14). ID numbers are stored; the event masks them. */
export async function createParty(ctx: SpaContext, input: unknown, actor: SpaActor): Promise<{ id: string }> {
  const parsed = Party.safeParse(input);
  if (!parsed.success) throw invalid("invalid_party", parsed.error);
  const p = parsed.data;
  if (normaliseName(p.kind === "person" ? p.fullNameEn : p.details.tradeName) === "")
    throw unprocessable("invalid_party", "the name has no letters");
  return withSpaTx(ctx.database, async (tx) => {
    const id = newId();
    await tx.db.insert(parties).values({
      id,
      kind: p.kind,
      fullNameEn: p.kind === "person" ? p.fullNameEn : p.details.tradeName,
      nationality: p.kind === "person" ? p.nationality : null,
      birthOn: p.kind === "person" ? (p.birthOn ?? null) : null,
      passportNo: p.kind === "person" ? (p.passportNo ?? null) : null,
      emiratesIdNo: p.kind === "person" ? (p.emiratesIdNo ?? null) : null,
      email: p.email,
      phone: p.kind === "person" ? (p.phone ?? null) : null,
      createdAt: ctx.clock.now(),
    });
    if (p.kind === "company") await tx.db.insert(companyDetails).values({ partyId: id, ...p.details });
    // The party row holds the personal data; the append-only log never does (review #4).
    await appendDealEvent(tx, ctx, {
      entity: { kind: "party", id },
      type: "PARTY_CREATED",
      actor,
      payload: { kind: p.kind },
    });
    return { id };
  });
}

async function kindOf(db: SpaDb, id: string): Promise<"person" | "company" | null> {
  const [row] = await db.select({ kind: parties.kind }).from(parties).where(eq(parties.id, id));
  return row?.kind ?? null;
}

/** Records who signs for a company and the document that lets them. */
export async function addSignatory(ctx: SpaContext, input: unknown, actor: SpaActor): Promise<{ id: string }> {
  const parsed = Signatory.safeParse(input);
  if (!parsed.success) throw invalid("invalid_signatory", parsed.error);
  const s = parsed.data;
  return withSpaTx(ctx.database, async (tx) => {
    if ((await kindOf(tx.db, s.companyPartyId)) !== "company")
      throw unprocessable("signatory_not_company", "the signatory's company isn't a company party");
    if ((await kindOf(tx.db, s.personPartyId)) !== "person")
      throw unprocessable("signatory_not_person", "a signatory is a person");
    const id = newId();
    await tx.db.insert(signatories).values({ id, ...s });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "party", id: s.companyPartyId },
      type: "SIGNATORY_ADDED",
      actor,
      payload: { signatoryId: id, personPartyId: s.personPartyId, authority: s.authority },
    });
    return { id };
  });
}

/** Records a beneficial owner of a company (S14); a company's owners never add up to more than 100%. */
export async function addBeneficialOwner(
  ctx: SpaContext,
  input: unknown,
  actor: SpaActor,
  /** Join the caller's transaction (the company check adds owners inside its own, C20). */
  opts: { tx?: SpaTx } = {},
): Promise<void> {
  const parsed = BeneficialOwner.safeParse(input);
  if (!parsed.success) throw invalid("invalid_beneficial_owner", parsed.error);
  const o = parsed.data;
  const run = async (tx: SpaTx) => {
    if ((await kindOf(tx.db, o.companyPartyId)) !== "company")
      throw unprocessable("owner_of_non_company", "beneficial owners belong to a company party");
    if ((await kindOf(tx.db, o.personPartyId)) !== "person")
      throw unprocessable("owner_not_person", "a beneficial owner is a person");
    // Lock the company's party row so two owners added at once can't both pass the 100% check.
    await tx.db.select().from(parties).where(eq(parties.id, o.companyPartyId)).for("update");
    const [{ total } = { total: "0" }] = await tx.db
      .select({ total: sum(beneficialOwners.shareBps) })
      .from(beneficialOwners)
      .where(eq(beneficialOwners.companyPartyId, o.companyPartyId));
    const [dup] = await tx.db
      .select()
      .from(beneficialOwners)
      .where(
        and(eq(beneficialOwners.companyPartyId, o.companyPartyId), eq(beneficialOwners.personPartyId, o.personPartyId)),
      );
    if (dup) throw unprocessable("owner_exists", "this person is already an owner of the company");
    if (Number(total ?? 0) + o.shareBps > 10_000)
      throw unprocessable("owners_over_100", "the company's owners would add up to more than 100%");
    await tx.db.insert(beneficialOwners).values(o);
    await appendDealEvent(tx, ctx, {
      entity: { kind: "party", id: o.companyPartyId },
      type: "BENEFICIAL_OWNER_ADDED",
      actor,
      payload: { personPartyId: o.personPartyId, shareBps: o.shareBps },
    });
  };
  await (opts.tx ? run(opts.tx) : withSpaTx(ctx.database, run));
}

const COMPANY_ID = "00000000-0000-7000-8000-0000000000c0";
const CompanyInput = z.object({ name: z.string().trim().min(1).max(200), kind: CompanyKindSchema });

/** Sets the client company's name and kind (S12): one row per install. */
export async function setCompany(ctx: SpaContext, input: unknown, actor: SpaActor): Promise<void> {
  const parsed = CompanyInput.safeParse(input);
  if (!parsed.success) throw invalid("invalid_company", parsed.error);
  await withSpaTx(ctx.database, async (tx) => {
    // One row per install, under a fixed id: concurrent calls update it instead of adding a second row.
    await tx.db
      .insert(companies)
      .values({ id: COMPANY_ID, ...parsed.data, createdAt: ctx.clock.now() })
      .onConflictDoUpdate({ target: companies.id, set: parsed.data });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "settings", id: "00000000-0000-7000-8000-000000000002" },
      type: "COMPANY_SET",
      actor,
      payload: parsed.data,
    });
  });
}

/** The client company's kind; `both` until one is set (S12). */
export async function companyKind(db: SpaDb): Promise<CompanyKind> {
  const [row] = await db.select({ kind: companies.kind }).from(companies).limit(1);
  return row?.kind ?? DEFAULT_COMPANY_KIND;
}
