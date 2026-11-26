import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { LocalDiskStore } from "@platform/adapters";
import { DEFAULT_STYLE } from "@platform/readers/structure/look";
import { addDays, type CalendarDate, type Clock, newId, SystemClock } from "@platform/kernel";
import type { DealEvent, DealType, SpaActor } from "@spa/core";
import { databaseName, loadSpaEnv, type SpaEnv } from "@spa/core/env";
import {
  companies,
  companyDetails,
  createSpaDatabase,
  deals,
  listingParties,
  listings,
  parties,
  projects,
  type SpaDatabase,
  spaDemoSettings,
  spaMedia,
  spaTasks,
  spaTemplates,
  spaUsers,
  units,
  withSpaTx,
} from "@spa/db";
import { FakeScreening } from "@spa/helpers";
import { and, eq, isNotNull } from "drizzle-orm";
import { advance } from "./manager/advance.ts";
import type { SpaContext } from "./manager/context.ts";
import { createDeal } from "./manager/deals.ts";
import { recordPartyDefault } from "./manager/default.ts";
import {
  createListing,
  createListingDraft,
  listingStep,
  recordListingSignature,
  recordOwnership,
  uploadListingDocument,
} from "./manager/listings.ts";
import { addMedia } from "./manager/media.ts";
import type { DocumentStore } from "./manager/noc.ts";
import { placeholderPhoto } from "./seed-photos.ts";
import { addBuilding, addUnit, createPriceList, createProject, publishPriceList } from "./manager/inventory.ts";
import { setEscrowAccount } from "./manager/escrow.ts";
import { createParty, setCompany } from "./manager/parties.ts";
import { screenDeal } from "./manager/aml-screening.ts";
import { type FactsLoader, failClosedFacts } from "./manager/facts.ts";
import { setPaymentPlan } from "./manager/sheet.ts";
import { completeTask, openTask } from "./manager/tasks.ts";
import { SpaDemoClock } from "./clock.ts";
import { seedLeadsAndViewings } from "./seed-leads.ts";
import { DEMO_TEMPLATE, DEMO_USERS } from "./seed-data.ts";
import { addTemplateVersion, createTemplate } from "./manager/templates.ts";

/**
 * `bun run spa:demo:seed`: the demo users (one per role), the demo clock row, a little inventory and a mix of deals of
 * each type at different stages (C30, S58). Demo mode only. Demo users have no
 * password: they sign in from the demo picker, like leasing's demo login (S33). Safe to run twice.
 */
export async function seedSpaDemo(
  database: SpaDatabase,
  clock: Clock = new SystemClock(),
  /** Demo mode is checked here, not only by the scripts that call this (review 15). */
  env: Pick<SpaEnv, "SPA_DEMO_MODE">,
  /** Where the demo listings' placeholder files go; without it the listings are seeded with no files. */
  store?: DocumentStore,
  /** Where the demo's placeholder photos go (S78); without it nothing is given a photo. */
  media?: LocalDiskStore,
): Promise<void> {
  requireDemo(env);
  for (const u of DEMO_USERS) {
    await database.db
      .insert(spaUsers)
      .values({ id: newId(), ...u, email: u.email.toLowerCase() })
      .onConflictDoUpdate({ target: spaUsers.email, set: { name: u.name, role: u.role, active: true } });
  }
  await database.db.insert(spaDemoSettings).values({ id: 1, clockOffsetMs: 0 }).onConflictDoNothing();
  await seedInventory(database, clock);
  await seedDealMix(database, clock);
  await seedProjects(database, clock);
  await seedListingStates(database, clock, store);
  await seedPublicSite(database, clock, media);
  await seedLeadsAndViewings(database, clock);
  await seedTemplates(database, clock);
}

/**
 * Fictional inventory for the empty shell (P3): three units, one active listing with a placeholder permit, and one
 * primary deal on U-101 opened by the demo sales officer (so U-101 is held). Skipped when already seeded.
 */
async function seedInventory(database: SpaDatabase, clock: Clock): Promise<void> {
  if ((await database.db.select().from(deals).limit(1)).length) return;
  for (const code of ["U-101", "U-102", "U-103"])
    await database.db.insert(units).values({ id: newId(), code, createdAt: clock.now() }).onConflictDoNothing();
  const [officer] = await database.db.select().from(spaUsers).where(eq(spaUsers.role, "sales_officer"));
  const [unit] = await database.db.select().from(units).where(eq(units.code, "U-101"));
  if (!officer || !unit) return;
  const ctx = { database, clock, facts: failClosedFacts };
  const actor = `user:${officer.id}` as const;
  // Fictional parties: a buyer and the developer as seller.
  const buyer = await createParty(
    ctx,
    {
      kind: "person",
      fullNameEn: "Sample Buyer One",
      nationality: "Testland",
      email: "buyer1@spa-demo.test",
      passportNo: "[PASSPORT NO.]",
    },
    actor,
  );
  const developer = await createParty(
    ctx,
    {
      kind: "company",
      email: "sales@developer.spa-demo.test",
      details: {
        tradeName: "Fictional Developments LLC",
        licenceNo: "[LICENCE NO.]",
        licenceExpiresOn: addDays(clock.today(), 365),
        issuingAuthority: "DED",
      },
    },
    actor,
  );
  // A brokerage listing with two fictional co-owners, matched, signed, verified and active (C5).
  const owners = [];
  for (const [i, name] of ["Sample Owner One", "Sample Owner Two"].entries())
    owners.push(
      await createParty(
        ctx,
        {
          kind: "person",
          fullNameEn: name,
          nationality: "Testland",
          email: `owner${i + 1}@spa-demo.test`,
          passportNo: "[PASSPORT NO.]",
        },
        actor,
      ),
    );
  const listing = await createListing(
    ctx,
    {
      title: "2-bed apartment, Demo Marina Tower",
      community: "Demo Marina District",
      bedrooms: 2,
      bathrooms: 2,
      unitType: "apartment",
      floor: 12,
      view: "Marina",
      parkingSpaces: 1,
      furnished: "semi",
      propertyDescription: "2 bedroom apartment, Demo Marina Tower",
      askingPriceFils: 185_000_000,
      permitNo: "[PERMIT NO.]",
      permitExpiresOn: addDays(clock.today(), 180),
      sellers: owners.map((o, i) => ({ role: "seller" as const, partyId: o.id, order: i + 1, shareBps: 5000 })),
    },
    actor,
  );
  await recordOwnership(
    ctx,
    listing.id,
    { kind: "title_deed", ref: "[TITLE DEED NO.]", ownersAsOnDocument: ["Sample Owner One", "Sample Owner Two"] },
    actor,
  );
  for (const o of owners) await recordListingSignature(ctx, listing.id, o.id, actor);
  await listingStep(ctx, listing.id, "VERIFY", { actor });
  await listingStep(ctx, listing.id, "ACTIVATE", { actor });
  await createDeal(
    ctx,
    {
      dealType: "primary_offplan",
      sellerMortgage: false,
      buyerMortgage: false,
      planTakenOver: false,
      unitId: unit.id,
      priceFils: 150_000_000,
      parties: [
        { role: "buyer", partyId: buyer.id, order: 1, shareBps: 10_000 },
        { role: "seller", partyId: developer.id, order: 1, shareBps: 10_000 },
      ],
    },
    actor,
  );
}

// ---------------------------------------------------------------------------------------------
// C32 (S64): one fictional project through SpaManager, so Inventory has something to show.

const demoPerson = (name: string, n: number) => ({
  kind: "person" as const,
  fullNameEn: name,
  email: `demo-seller${n}@spa-demo.test`,
});
/** A tiny fictional PDF for the demo listings' files: it says so on the page, and no real data is in it. */
const DEMO_PDF = (title: string) =>
  new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Contents 4 0 R >> endobj\n4 0 obj << /Length 72 >> stream\nBT /F1 12 Tf 20 60 Td (${title}: fictional demo file) Tj ET\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`,
  );

/**
 * M3 (S77): one demo listing in each state the record shows, made through the same draft route the form uses (a person and
 * a company seller), so the Listings screen and each record have something to open: a draft missing one signature, verified,
 * active, published with a permit ending in 5 days, and withdrawn. Names are fictional. Skipped when already seeded.
 */
async function seedListingStates(database: SpaDatabase, clock: Clock, store?: DocumentStore): Promise<void> {
  const [officer] = await database.db.select().from(spaUsers).where(eq(spaUsers.role, "sales_officer"));
  if (!officer) return;
  if ((await database.db.select().from(listings).where(eq(listings.title, "Studio, Demo Draft Court"))).length) return;
  const ctx: SpaContext = { database, clock, facts: failClosedFacts };
  const user = { id: officer.id, role: "sales_officer" as const };
  const actor = `user:${officer.id}` as const;
  const today = clock.today();
  const company = (name: string, n: number) => ({
    kind: "company" as const,
    tradeName: name,
    email: `demo-company${n}@spa-demo.test`,
    licenceNo: `[LICENCE NO. ${n}]`,
    licenceExpiresOn: addDays(today, 400),
    issuingAuthority: "DED",
    signatory: { fullNameEn: `${name} Signatory`, email: `demo-signer${n}@spa-demo.test`, authority: "poa" as const },
  });
  const make = async (
    n: number,
    title: string,
    sellers: (ReturnType<typeof demoPerson> | ReturnType<typeof company>)[],
    o: {
      signed: "all" | "all but one";
      steps: ("VERIFY" | "ACTIVATE" | "PUBLISH" | "WITHDRAW")[];
      permitDays: number;
      community?: string;
    },
  ) => {
    const l = await createListingDraft(
      ctx,
      {
        title,
        community: o.community ?? "Demo Marina District",
        // The card shows the title and the facts side by side: the beds come from the title so they agree.
        bedrooms: Number(/^(\d+)-bed/.exec(title)?.[1] ?? 0),
        bathrooms: 1 + (n % 2),
        sizeSqft: 600 + n * 140,
        unitType: "apartment",
        view: "Marina",
        furnished: "semi",
        propertyDescription: `${title}. A fictional listing for the demo.`,
        askingPriceFils: 90_000_000 + n * 21_000_000,
        permitNo: `[PERMIT NO. D${n}]`,
        permitIssuedOn: addDays(today, o.permitDays - 180),
        permitExpiresOn: addDays(today, o.permitDays),
        agentUserId: officer.id,
        sellers,
      },
      user,
    );
    await recordOwnership(
      ctx,
      l.id,
      {
        kind: "title_deed",
        ref: `[TITLE DEED NO. D${n}]`,
        ownersAsOnDocument: sellers.map((s) => (s.kind === "person" ? s.fullNameEn : s.tradeName)),
      },
      actor,
    );
    const links = await database.db.select().from(listingParties).where(eq(listingParties.listingId, l.id));
    for (const link of o.signed === "all" ? links : links.slice(0, -1))
      await recordListingSignature(ctx, l.id, link.partyId, actor);
    if (store) {
      const file = (name: string) => ({ name, bytes: DEMO_PDF(name) });
      await uploadListingDocument(ctx, store, l.id, "title_deed", file("Demo title deed"), user);
      await uploadListingDocument(ctx, store, l.id, "permit", file("Demo advertising permit"), user);
      if (o.signed === "all")
        await uploadListingDocument(ctx, store, l.id, "listing_agreement", file("Demo listing agreement"), user);
    }
    for (const step of o.steps)
      await listingStep(ctx, l.id, step, {
        actor,
        ...(step === "WITHDRAW" ? { payload: { reason: "The seller changed their mind" } } : {}),
      });
    return l;
  };
  await make(
    1,
    "Studio, Demo Draft Court",
    [demoPerson("Sample Seller Draft", 1), company("Fictional Holdings Draft LLC", 1)],
    {
      signed: "all but one",
      steps: [],
      permitDays: 120,
    },
  );
  await make(2, "1-bed apartment, Demo Verified Court", [demoPerson("Sample Seller Verified", 2)], {
    signed: "all",
    steps: ["VERIFY"],
    permitDays: 120,
  });
  await make(
    3,
    "2-bed apartment, Demo Active Court",
    [demoPerson("Sample Seller Active", 3), demoPerson("Sample Seller Active Two", 4)],
    {
      signed: "all",
      steps: ["VERIFY", "ACTIVATE"],
      permitDays: 120,
    },
  );
  await make(4, "2-bed apartment, Demo Published Court", [company("Fictional Holdings Published LLC", 2)], {
    signed: "all",
    steps: ["VERIFY", "ACTIVATE", "PUBLISH"],
    permitDays: 5,
  });
  await make(5, "Studio, Demo Withdrawn Court", [demoPerson("Sample Seller Withdrawn", 5)], {
    signed: "all",
    steps: ["VERIFY", "WITHDRAW"],
    permitDays: 120,
  });
  // S78: three of the demo listings are public (a valid permit), in three communities, so the site has resale homes to show.
  await make(6, "3-bed apartment, Demo Skyline Court", [demoPerson("Sample Seller Skyline", 6)], {
    signed: "all",
    steps: ["VERIFY", "ACTIVATE", "PUBLISH"],
    permitDays: 120,
    community: "Demo Skyline Quarter",
  });
  await make(7, "1-bed apartment, Demo Palm View", [company("Fictional Holdings Palm LLC", 3)], {
    signed: "all",
    steps: ["VERIFY", "ACTIVATE", "PUBLISH"],
    permitDays: 90,
    community: "Demo Palm Shore",
  });
}

/**
 * S78: what the public site needs to look lived in. A second project (so the catalogue shows two developers' worth of
 * homes: units on a published price list), then 2 to 3 placeholder photos for each project, each published listing and each
 * unit on sale. The photos are drawn in code (no stock images, no people, no logos). Demo only; skipped when done.
 */
async function seedPublicSite(database: SpaDatabase, clock: Clock, media?: LocalDiskStore): Promise<void> {
  const db = database.db;
  const [admin] = await db.select().from(spaUsers).where(eq(spaUsers.role, "admin"));
  const [officer] = await db.select().from(spaUsers).where(eq(spaUsers.role, "sales_officer"));
  if (!admin || !officer) return;
  const ctx: SpaContext = { database, clock, facts: failClosedFacts };
  const user = { id: admin.id, role: "admin" as const };
  const [existing] = await db.select().from(projects).where(eq(projects.code, "CH-01"));
  if (!existing && (await db.select().from(companies).limit(1)).length) {
    const project = await createProject(
      ctx,
      {
        code: "CH-01",
        name: "Demo Creek Gardens",
        anticipatedCompletionOn: addDays(clock.today(), 720),
        community: "Demo Creek Harbour",
        location: "Demo creekside district",
        description: "A fictional low-rise residential project beside a creek park, with apartments and townhouses.",
        templateKind: "spa",
      },
      user,
    );
    const tower = await addBuilding(ctx, project.id, { code: "C", name: "Block C" }, user);
    const layout = [
      {
        code: "C-101",
        type: "apartment",
        bedrooms: 1,
        bathrooms: 1,
        internalSqft: 690,
        floor: 1,
        view: "Garden",
        parkingSpaces: 1,
      },
      {
        code: "C-202",
        type: "apartment",
        bedrooms: 2,
        bathrooms: 2,
        internalSqft: 1090,
        floor: 2,
        view: "Creek",
        parkingSpaces: 1,
      },
      {
        code: "C-303",
        type: "apartment",
        bedrooms: 3,
        bathrooms: 3,
        internalSqft: 1580,
        floor: 3,
        view: "Creek",
        parkingSpaces: 2,
      },
      {
        code: "C-T1",
        type: "townhouse",
        bedrooms: 4,
        bathrooms: 4,
        internalSqft: 2650,
        floor: 0,
        view: "Garden",
        parkingSpaces: 2,
      },
    ];
    const ids: string[] = [];
    for (const u of layout) ids.push((await addUnit(ctx, project.id, { buildingId: tower.id, ...u }, user)).id);
    const list = await createPriceList(
      ctx,
      project.id,
      {
        items: ids.map((unitId, i) => ({ unitId, priceFils: [95_000_000, 160_000_000, 235_000_000, 410_000_000][i]! })),
      },
      user,
    );
    await publishPriceList(ctx, list.id, user);
  }
  if (!media) return;
  if ((await db.select({ id: spaMedia.id }).from(spaMedia).limit(1)).length) return;
  let n = 0;
  const photos = async (
    kind: "project" | "unit" | "listing",
    id: string,
    count: number,
    who: typeof user | { id: string; role: "sales_officer" },
  ) => {
    for (let i = 0; i < count; i++) await addMedia(ctx, media, { kind, id }, placeholderPhoto(++n), null, who);
  };
  for (const p of await db.select({ id: projects.id }).from(projects)) await photos("project", p.id, 3, user);
  for (const u of await db.select({ id: units.id }).from(units).where(isNotNull(units.buildingId)))
    await photos("unit", u.id, 2, user);
  for (const l of await db.select({ id: listings.id }).from(listings).where(eq(listings.state, "PUBLISHED")))
    await photos("listing", l.id, 3, { id: officer.id, role: "sales_officer" });
}

/**
 * C34 (S66): one fictional template with a read version waiting for legal, so Settings → Templates and legal's inbox
 * aren't empty. Goes through the manager (checks run, the gate opens). Skipped when a template exists.
 */
async function seedTemplates(database: SpaDatabase, clock: Clock): Promise<void> {
  if ((await database.db.select().from(spaTemplates).limit(1)).length) return;
  const [admin] = await database.db.select().from(spaUsers).where(eq(spaUsers.role, "admin"));
  if (!admin) return;
  const ctx: SpaContext = { database, clock, facts: failClosedFacts };
  const user = { id: admin.id, role: "admin" as const };
  const t = await createTemplate(ctx, { name: DEMO_TEMPLATE.name, documentKind: "spa", projectCodes: [] }, user);
  const data = {
    ...DEMO_TEMPLATE.data,
    style: DEFAULT_STYLE,
    logo: null,
    pages: 1,
    droppedSections: 0,
    unmappedBlanks: 0,
  } as unknown as Parameters<typeof addTemplateVersion>[1]["data"];
  const hash = createHash("sha256").update("demo-template-sample").digest("hex");
  await addTemplateVersion(ctx, { templateId: t.id, docId: "demo-template-sample", docHash: hash, data }, user);
}

/**
 * Sets the company (kind `both`, so both Inventory and Listings open), then one project with two buildings: the demo
 * units U-101 to U-105 are placed in building A, building B gets new available units; two published price lists
 * (the second is the one in use); an escrow account with a made-up number that passes the check. Demo only (the caller
 * checked), skipped when a project exists. The deals above keep the agreed prices they were created with.
 */
async function seedProjects(database: SpaDatabase, clock: Clock): Promise<void> {
  const db = database.db;
  if ((await db.select().from(projects).limit(1)).length) return;
  const [admin] = await db.select().from(spaUsers).where(eq(spaUsers.role, "admin"));
  if (!admin) return;
  const ctx: SpaContext = { database, clock, facts: failClosedFacts };
  const user = { id: admin.id, role: "admin" as const };
  if (!(await db.select().from(companies).limit(1)).length)
    await setCompany(ctx, { name: "Fictional Properties LLC", kind: "both" }, `user:${admin.id}`);
  const project = await createProject(
    ctx,
    {
      code: "MV-01",
      name: "Demo Marina Vista",
      anticipatedCompletionOn: addDays(clock.today(), 540),
      community: "Demo Marina Vista Bay",
      location: "Demo waterfront district",
      description:
        "A fictional waterfront residential project of two towers with studios, apartments and penthouses, a podium pool and landscaped gardens.",
      templateKind: "spa",
    },
    user,
  );
  const a = await addBuilding(ctx, project.id, { code: "A", name: "Tower A" }, user);
  const b = await addBuilding(ctx, project.id, { code: "B", name: "Tower B" }, user);
  // Fictional details: studios and 1 to 3 bedroom apartments, two penthouses (S75).
  const layout: Record<string, Record<string, unknown>> = {
    "U-101": {
      type: "apartment",
      bedrooms: 0,
      bathrooms: 1,
      internalSqft: 480,
      balconySqft: 60,
      floor: 3,
      view: "Marina",
      parkingSpaces: 1,
    },
    "U-102": {
      type: "apartment",
      bedrooms: 1,
      bathrooms: 1,
      internalSqft: 760,
      balconySqft: 90,
      floor: 5,
      view: "Community",
      parkingSpaces: 1,
    },
    "U-103": {
      type: "apartment",
      bedrooms: 1,
      bathrooms: 2,
      internalSqft: 820,
      balconySqft: 100,
      floor: 8,
      view: "Pool",
      parkingSpaces: 1,
    },
    "U-104": {
      type: "apartment",
      bedrooms: 2,
      bathrooms: 2,
      internalSqft: 1180,
      balconySqft: 140,
      floor: 10,
      view: "Marina",
      parkingSpaces: 2,
    },
    "U-105": {
      type: "apartment",
      bedrooms: 2,
      bathrooms: 3,
      internalSqft: 1260,
      balconySqft: 150,
      floor: 12,
      view: "Community",
      parkingSpaces: 2,
    },
    "U-201": {
      type: "apartment",
      bedrooms: 0,
      bathrooms: 1,
      internalSqft: 455,
      balconySqft: 55,
      floor: 2,
      view: "Pool",
      parkingSpaces: 1,
    },
    "U-202": {
      type: "apartment",
      bedrooms: 3,
      bathrooms: 3,
      internalSqft: 1750,
      balconySqft: 210,
      floor: 14,
      view: "Marina",
      parkingSpaces: 2,
    },
    "U-203": {
      type: "penthouse",
      bedrooms: 3,
      bathrooms: 4,
      internalSqft: 2400,
      balconySqft: 420,
      floor: 30,
      view: "Marina",
      parkingSpaces: 3,
      description: "A fictional full-floor penthouse with a private terrace.",
    },
    "U-204": {
      type: "penthouse",
      bedrooms: 4,
      bathrooms: 5,
      internalSqft: 3100,
      balconySqft: 560,
      floor: 31,
      view: "Community",
      parkingSpaces: 3,
      description: "A fictional duplex penthouse with a roof terrace.",
    },
  };
  const unitIds: string[] = [];
  for (const code of ["U-101", "U-102", "U-103", "U-104", "U-105"])
    unitIds.push((await addUnit(ctx, project.id, { buildingId: a.id, code, ...layout[code] }, user)).id);
  for (const code of ["U-201", "U-202", "U-203", "U-204"])
    unitIds.push((await addUnit(ctx, project.id, { buildingId: b.id, code, ...layout[code] }, user)).id);
  const prices = (uplift: number) => ({
    items: unitIds.map((unitId, i) => ({
      unitId,
      priceFils: Math.round(((1_400_000 + i * 25_000) * uplift) / 100) * 100,
    })),
  });
  const v1 = await createPriceList(ctx, project.id, prices(100), user);
  await publishPriceList(ctx, v1.id, user);
  const v2 = await createPriceList(ctx, project.id, prices(103), user);
  await publishPriceList(ctx, v2.id, user);
  await setEscrowAccount(
    ctx,
    {
      projectCode: "MV-01",
      accountHolder: "Demo Escrow Bank",
      iban: "AE070331234567890123456",
      bankName: "Demo National Bank",
    },
    user,
  );
}

// ---------------------------------------------------------------------------------------------
// C30 (S58): deals of each type at different stages, so the Work and record screens aren't empty.

/**
 * Demo only. The evidence steps (KYC documents, an uploaded agreement template and its preparation) can't be faked
 * without files, so a deal moves to the stage the demo needs through `advance()` (the state machine, its events and
 * its cascades), with facts that say those steps are done. Never used by the engine at run time.
 */
const demoFacts: FactsLoader = {
  async deal(tx, row, today, env) {
    return {
      ...(await failClosedFacts.deal(tx, row, today, env)),
      documentsRequested: true,
      kycOk: true,
      companyChecksOk: true,
      ownershipOk: true,
      openAmlFlag: false,
      agreementPrepared: true,
    };
  },
  listing: (tx, row, today) => failClosedFacts.listing(tx, row, today),
};

type Person = { id: string; role: "sales_officer" };
const person = (name: string, email: string) =>
  ({ kind: "person", fullNameEn: name, nationality: "Testland", email, passportNo: "[PASSPORT NO.]" }) as const;

/** An active listing with its owners matched, signed and verified, like the P3 one (C5). */
async function activeListing(ctx: SpaContext, actor: SpaActor, n: number, ownerNames: string[]) {
  const owners = [];
  for (const [i, name] of ownerNames.entries())
    owners.push(await createParty(ctx, person(name, `owner${n}-${i + 1}@spa-demo.test`), actor));
  const listing = await createListing(
    ctx,
    {
      title: `${n % 2 ? "2" : "3"}-bed apartment, Demo Tower ${n}`,
      community: "Demo Marina District",
      bedrooms: n % 2 ? 2 : 3,
      propertyDescription: `Apartment, Demo Tower ${n}`,
      askingPriceFils: 150_000_000 + n * 12_500_000,
      permitNo: `[PERMIT NO. ${n}]`,
      permitExpiresOn: addDays(ctx.clock.today(), 150 + n),
      sellers: owners.map((o, i) => ({
        role: "seller" as const,
        partyId: o.id,
        order: i + 1,
        shareBps: Math.floor(10_000 / owners.length) + (i === 0 ? 10_000 % owners.length : 0),
      })),
    },
    actor,
  );
  await recordOwnership(
    ctx,
    listing.id,
    { kind: "title_deed", ref: "[TITLE DEED NO.]", ownersAsOnDocument: ownerNames },
    actor,
  );
  for (const o of owners) await recordListingSignature(ctx, listing.id, o.id, actor);
  await listingStep(ctx, listing.id, "VERIFY", { actor });
  await listingStep(ctx, listing.id, "ACTIVATE", { actor });
  return { id: listing.id, ownerIds: owners.map((o) => o.id) };
}

const PLAN = (today: CalendarDate) => ({
  instalments: [
    { label: "Booking", shareBps: 2000, dueOn: addDays(today, 7) },
    { label: "First instalment", shareBps: 2000, dueOn: addDays(today, 90) },
    { label: "Second instalment", shareBps: 2000, dueOn: addDays(today, 180) },
    { label: "On handover", shareBps: 4000, milestone: "Handover" },
  ],
});

/**
 * Three kinds of deal at different stages, all fictional, all through SpaManager functions: primary (U-101 to U-105),
 * ready resale and off-plan resale on their own listings. One resale is on hold with a real review (a name from the
 * invented screening list), one deal is in default, and a few tasks are open. Skipped when it was seeded already.
 */
async function seedDealMix(database: SpaDatabase, clock: Clock): Promise<void> {
  const db = database.db;
  if ((await db.select().from(deals).where(eq(deals.dealType, "resale_ready")).limit(1)).length) return;
  const [officer] = await db.select().from(spaUsers).where(eq(spaUsers.role, "sales_officer"));
  const [developer] = await db
    .select({ id: parties.id })
    .from(parties)
    .innerJoin(companyDetails, eq(companyDetails.partyId, parties.id))
    .limit(1);
  const [firstListing] = await db.select().from(listings).where(eq(listings.state, "ACTIVE")).limit(1);
  if (!officer || !developer || !firstListing) return;
  const user: Person = { id: officer.id, role: "sales_officer" };
  const actor: SpaActor = `user:${officer.id}`;
  const real: SpaContext = { database, clock, facts: failClosedFacts };
  const demo: SpaContext = { ...real, facts: demoFacts };
  const move = async (dealId: string, ...events: DealEvent[]) => {
    for (const e of events) await advance(demo, { kind: "deal", id: dealId }, e, { actor });
  };
  const toChecks = (id: string) => move(id, "CHECKS_STARTED");
  const toDraft = (id: string) => move(id, "CHECKS_STARTED", "CHECKS_PASSED");
  const toLegal = (id: string) => move(id, "CHECKS_STARTED", "CHECKS_PASSED", "PREPARED");
  const buyer = async (n: number, name?: string) =>
    (await createParty(real, person(name ?? `Sample Buyer ${n}`, `buyer${n}@spa-demo.test`), actor)).id;
  const plan = (id: string) => setPaymentPlan(real, id, PLAN(clock.today()), user);

  // Primary off-plan: the developer sells units U-101 to U-105 (U-101 is the P3 starter deal, open at OFFER_AGREED).
  for (const code of ["U-104", "U-105"])
    await db.insert(units).values({ id: newId(), code, createdAt: clock.now() }).onConflictDoNothing();
  const unit = async (code: string) => (await db.select().from(units).where(eq(units.code, code)))[0]!.id;
  const primary = async (code: string, n: number, priceFils: number) =>
    (
      await createDeal(
        real,
        {
          dealType: "primary_offplan" as DealType,
          sellerMortgage: false,
          buyerMortgage: false,
          planTakenOver: false,
          unitId: await unit(code),
          priceFils,
          parties: [
            { role: "buyer", partyId: await buyer(n), order: 1, shareBps: 10_000 },
            { role: "seller", partyId: developer.id, order: 1, shareBps: 10_000 },
          ],
        },
        actor,
      )
    ).id;
  const p2 = await primary("U-102", 2, 162_000_000);
  await toDraft(p2);
  await plan(p2);
  const p3 = await primary("U-103", 3, 178_500_000);
  await plan(p3);
  await toLegal(p3);
  const p4 = await primary("U-104", 4, 140_000_000);
  await toChecks(p4);
  await recordPartyDefault(
    real,
    p4,
    { kind: "no_show", note: "The buyer did not come to the booking appointment." },
    user,
  );
  const p5 = await primary("U-105", 5, 155_000_000);
  await move(p5, "CANCEL");

  // Resales: each on its own listing, whose sellers are the deal's sellers (every co-owner).
  const resale = async (
    type: "resale_ready" | "resale_offplan",
    listingId: string,
    sellerIds: string[],
    buyerId: string,
    o: { buyerMortgage?: boolean; priceFils: number },
  ) =>
    (
      await createDeal(
        real,
        {
          dealType: type,
          sellerMortgage: false,
          buyerMortgage: o.buyerMortgage ?? false,
          planTakenOver: type === "resale_offplan",
          listingId,
          priceFils: o.priceFils,
          parties: [
            { role: "buyer", partyId: buyerId, order: 1, shareBps: 10_000 },
            ...sellerIds.map((partyId, i) => ({
              role: "seller" as const,
              partyId,
              order: i + 1,
              shareBps: Math.floor(10_000 / sellerIds.length) + (i === 0 ? 10_000 % sellerIds.length : 0),
            })),
          ],
        },
        actor,
      )
    ).id;
  const firstSellers = (
    await db
      .select({ id: listingParties.partyId })
      .from(listingParties)
      .where(eq(listingParties.listingId, firstListing.id))
  ).map((r) => r.id);
  const r1 = await resale("resale_ready", firstListing.id, firstSellers, await buyer(6), { priceFils: 185_000_000 });
  await toChecks(r1);
  const lb = await activeListing(real, actor, 2, ["Sample Owner Three", "Sample Owner Four"]);
  // "Zorvan Ketterly" is on the invented screening list: the real screening opens a real review and holds the deal.
  const r2 = await resale("resale_ready", lb.id, lb.ownerIds, await buyer(7, "Zorvan Ketterly"), {
    priceFils: 210_000_000,
  });
  await toChecks(r2);
  await screenDeal(real, { screening: new FakeScreening() }, { dealId: r2, trigger: "manual" }, actor);
  const lc = await activeListing(real, actor, 3, ["Sample Owner Five"]);
  const r3 = await resale("resale_ready", lc.id, lc.ownerIds, await buyer(8), {
    priceFils: 172_000_000,
    buyerMortgage: true,
  });
  await toDraft(r3);
  const ld = await activeListing(real, actor, 4, ["Sample Owner Six"]);
  const o1 = await resale("resale_offplan", ld.id, ld.ownerIds, await buyer(9), { priceFils: 195_000_000 });
  await plan(o1);
  await toLegal(o1);
  const le = await activeListing(real, actor, 5, ["Sample Owner Seven", "Sample Owner Eight"]);
  await resale("resale_offplan", le.id, le.ownerIds, await buyer(10), { priceFils: 168_000_000 });

  // A few tasks: one open for sales, one for finance, one already done (the Done tab).
  await withSpaTx(database, async (tx) => {
    await openTask(real, tx, {
      dealId: r3,
      kind: "confirm_amount",
      role: "sales_officer",
      title: "Confirm the bank amount",
      detail: { source: "demo" },
      dedupeKey: `${r3}:confirm_amount:demo`,
    });
    await openTask(real, tx, {
      dealId: p3,
      kind: "payment_review",
      role: "finance",
      title: "Look at this payment",
      detail: { source: "demo" },
      dedupeKey: `${p3}:payment_review:demo`,
    });
    await openTask(real, tx, {
      dealId: p2,
      kind: "milestone_reached",
      role: "sales_officer",
      title: "A payment milestone was reached",
      detail: { source: "demo" },
      dedupeKey: `${p2}:milestone_reached:demo`,
    });
  });
  const [done] = await db
    .select({ id: spaTasks.id })
    .from(spaTasks)
    .where(and(eq(spaTasks.dealId, p2), eq(spaTasks.kind, "milestone_reached")));
  if (done) await completeTask(real, done.id, user);
}

/** Seed and reset touch only a database named like the SPA one, never leasing's. Returns its name. */
export function requireSpaDatabase(url: string): string {
  const name = databaseName(url) ?? "";
  if (!/spa/.test(name) || /leasing/.test(name)) throw new Error(`refusing to use database "${name}": not the SPA one`);
  return name;
}

export function requireDemo(env: Pick<SpaEnv, "SPA_DEMO_MODE">): void {
  if (!env.SPA_DEMO_MODE) throw new Error("SPA_DEMO_MODE must be true to seed or reset demo data");
}

if (import.meta.main) {
  const env = loadSpaEnv();
  requireDemo(env);
  requireSpaDatabase(env.SPA_DATABASE_URL);
  const database = createSpaDatabase(env.SPA_DATABASE_URL, { max: 1 });
  // Dates follow the SPA demo clock (its offset in spa_demo_settings).
  const clock = new SpaDemoClock(database, true);
  await clock.refresh();
  await seedSpaDemo(
    database,
    clock,
    env,
    new LocalDiskStore(resolve(import.meta.dir, "../../../../data/spa-uploads")),
    new LocalDiskStore(resolve(import.meta.dir, "../../../../data/spa-media")),
  );
  await database.close();
  console.log(`seeded ${DEMO_USERS.length} demo users, the demo clock and fictional deals of each type`);
}
