import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { FakeLlm } from "@leasing/llm";
import {
  addDays,
  addMonths,
  addYears,
  type CalendarDate,
  defaultCompanyPolicy,
  DEMO_COMPANIES,
  DEMO_COMPANY_LEGAL,
  DEMO_CONTRACT_RULES,
  DEMO_LISTED_UNITS,
  DEMO_RENT_RULES,
  DEMO_SRI,
  DEMO_MRN_1502_MAKANI,
  demoDldNo,
  loadEnv,
  luhnCheckDigit,
  newId,
  type StaffUser,
} from "@leasing/core";
import {
  actionLinks,
  applications,
  companies,
  contractSigners,
  contracts,
  contractRules,
  companyPolicy,
  createDatabase,
  type Database,
  leaseParties,
  leases,
  parties,
  rentRules,
  sriAverages,
  staffUsers,
  units,
  withTx,
} from "@leasing/db";
import { activeRulesVersion } from "@leasing/rulebook";
import { and, eq, isNull } from "drizzle-orm";
import { createEngineClock } from "../clock.ts";
import type { EngineContext, Scheduler } from "../context.ts";
import { advance } from "../manager/advance.ts";
import { requestApproval, decideApproval } from "../manager/approvals.ts";
import { DEFAULT_ADDENDUM, finishContract, prepareContract, signContract } from "../manager/contracts.ts";
import { receiveInbound, processInbound } from "../manager/inbound.ts";
import { createLink } from "../manager/links.ts";
import { bookViewing, createApplication, recordReservation, recordViewingOutcome } from "../manager/applications.ts";
import { appendEvent } from "../manager/events.ts";
import { importLeasesCsv } from "../manager/import.ts";
import { companyLandlord, updateCompanyLegal } from "../manager/company-legal.ts";
import { syncRulebooks } from "../manager/rulebooks.ts";

/**
 * Demo data: 4 staff users, company policy v1, 6 units (3 let, 3 not), 3 fictional tenants and
 * one lease 10 days before its T−5 months renewal milestone. All people and IDs are fictional.
 */

const STAFF = [
  { email: "officer@demo.example", name: "Demo Officer", role: "leasing_officer" },
  { email: "manager@demo.example", name: "Demo Manager", role: "leasing_manager" },
  { email: "finance@demo.example", name: "Demo Finance", role: "finance" },
  { email: "admin@demo.example", name: "Demo Admin", role: "admin" },
] as const;

const DESCRIPTIONS: Record<string, string> = {
  "MRN-1502":
    "One-bedroom on the 15th floor facing the marina walk. Open kitchen, built-in wardrobes, balcony. Floor-plan and photos still to come.",
  "MRN-1608":
    "Two-bedroom corner unit with a full marina view from both bedrooms. Maid's room converted to a study, one covered parking space.",
  "JVC-0412":
    "Quiet one-bedroom overlooking the community park. Recently repainted, new kitchen appliances, pool and gym in the building.",
};

const LET_UNIT_DETAILS: Record<
  string,
  { floor: number; bathrooms: number; parkingSpaces: number; description: string }
> = {
  "MRN-1204": {
    floor: 12,
    bathrooms: 2,
    parkingSpaces: 1,
    description: "One-bedroom with a partial marina view, open kitchen and a balcony.",
  },
  "MRN-0807": {
    floor: 8,
    bathrooms: 3,
    parkingSpaces: 2,
    description: "Furnished two-bedroom with a large living room and two balconies.",
  },
  "JLT-2205": {
    floor: 22,
    bathrooms: 1,
    parkingSpaces: 1,
    description: "One-bedroom with a lake view; the tenancy ends soon (move-out demo).",
  },
  "JVC-0310": {
    floor: 3,
    bathrooms: 1,
    parkingSpaces: 1,
    description: "Compact studio near the community retail strip, fitted kitchen.",
  },
};

/** Fictional Emirates ID with a valid check digit. */
function fictionalEid(serial: number): string {
  // Birth year 1900 keeps these clearly fictional; no real holder can have it.
  const year = 1900;
  const body = `784${year}${String(serial).padStart(7, "0")}`;
  return `784-${year}-${String(serial).padStart(7, "0")}-${luhnCheckDigit(body)}`;
}

function leaseTerm(endOn: CalendarDate) {
  return { start: addDays(addYears(endOn, -1), 1), end: endOn };
}

export function demoLeasesCsv(today: CalendarDate): string {
  const near = leaseTerm(addDays(addMonths(today, 5), 10));
  const mid = leaseTerm(addMonths(today, 8));
  const far = leaseTerm(addMonths(today, 11));
  // Step 10 demo: ends in 40 days, inside the notice window (give notice from the demo console).
  const ending = leaseTerm(addDays(today, 40));
  const header =
    "unit_code,building,community,unit_no,dld_property_no,makani_no,dewa_premise_no,bedrooms,area_sqft,furnished,tenant_name,tenant_email,tenant_phone,tenant_emirates_id,tenant_nationality,start_on,end_on,annual_rent_aed,cheques,deposit_aed,ejari_no";
  const rows = [
    [
      "MRN-1204",
      "Demo Marina Tower",
      "Dubai Marina",
      "1204",
      "DEMO-DLD-001204",
      "1111122222",
      "DEMO-DEWA-1204",
      "1",
      "820",
      "no",
      "Sara Example Khan",
      "sara.tenant@demo.example",
      "+971 50 000 0001",
      fictionalEid(1000001),
      "Fictionland",
      near.start,
      near.end,
      "85000",
      "4",
      "4250",
      "DEMO-EJ-0001204",
    ],
    [
      "MRN-0807",
      "Demo Marina Tower",
      "Dubai Marina",
      "807",
      "DEMO-DLD-000807",
      "1111133333",
      "DEMO-DEWA-0807",
      "2",
      "1250",
      "yes",
      "Rami Sample Nasser",
      "rami.tenant@demo.example",
      "+971 50 000 0002",
      fictionalEid(1000002),
      "Fictionland",
      mid.start,
      mid.end,
      "140000",
      "2",
      "14000",
      "DEMO-EJ-0000807",
    ],
    [
      "JVC-0310",
      "Demo Circle Residence",
      "Jumeirah Village Circle",
      "310",
      "DEMO-DLD-000310",
      "2222211111",
      "DEMO-DEWA-0310",
      "0",
      "450",
      "no",
      "Mina Test Varghese",
      "mina.tenant@demo.example",
      "+971 50 000 0003",
      fictionalEid(1000003),
      "Fictionland",
      far.start,
      far.end,
      "48000",
      "6",
      "2400",
      "DEMO-EJ-0000310",
    ],
    [
      "JLT-2205",
      "Demo Lakes Tower",
      "Jumeirah Lake Towers",
      "2205",
      "DEMO-DLD-002205",
      "3333311111",
      "DEMO-DEWA-2205",
      "1",
      "760",
      "no",
      "Noor Demo Haddad",
      "noor.tenant@demo.example",
      "+971 50 000 0004",
      fictionalEid(1000004),
      "Fictionland",
      ending.start,
      ending.end,
      "78000",
      "4",
      "3900",
      "DEMO-EJ-0002205",
    ],
  ];
  return [header, ...rows.map((r) => r.join(","))].join("\n");
}

const unused = () => Promise.reject(new Error("the demo seed doesn't call Ejari"));
const noEjari: EngineContext["ejari"] = {
  register: unused,
  renew: unused,
  cancel: unused,
  status: unused,
  certificate: unused,
};

async function demoCompanyIds(database: Database): Promise<Map<string, string>> {
  const rows = await database.db.select({ id: companies.id, slug: companies.slug }).from(companies);
  const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
  for (const c of DEMO_COMPANIES)
    if (!bySlug.has(c.slug)) throw new Error("the demo companies are missing; run the seed first");
  return bySlug;
}

/** Demo lease CSV rows split by company: the units of Silverline Properties and of Al Noor Family Holdings. */
const AL_NOOR_LEASE_UNITS = new Set(["JVC-0310", "JLT-2205"]);
function leasesCsvFor(today: CalendarDate, company: "silverline" | "al-noor-holdings"): string {
  const [header, ...rows] = demoLeasesCsv(today).split("\n");
  const mine = rows.filter((r) => AL_NOOR_LEASE_UNITS.has(r.split(",")[0]!) === (company === "al-noor-holdings"));
  return [header!, ...mine].join("\n");
}

/** The unit code to company slug of the let and in-progress units. */
const LET_UNIT_COMPANY = (code: string) =>
  AL_NOOR_LEASE_UNITS.has(code) || code === "JVC-0412" ? "al-noor-holdings" : "silverline";

export async function seedDemo(database: Database): Promise<void> {
  // Store the base version and load published ones, so seeded leases get the version in force.
  await syncRulebooks(database);
  const clock = await createEngineClock(database, true);
  const noJobs: Scheduler = {
    send: () => Promise.reject(new Error("demo seed runs in demo mode; deadlines are fired by the sweep")),
  };
  // The seed never sends mail, renders documents or calls a model.
  const ctx: EngineContext = {
    database,
    clock,
    scheduler: noJobs,
    get rulesVersion() {
      return activeRulesVersion(clock.today()) ?? "dubai-2025-01";
    },
    demoMode: true,
    // Same truthy parsing as core's env (`true` or `1`).
    tenancyOps: ["true", "1"].includes((process.env.TENANCY_OPS ?? "").trim().toLowerCase()),
    mailer: { send: () => Promise.reject(new Error("the demo seed doesn't send email")) },
    documents: new LocalDiskStore(join(tmpdir(), "leasing-seed-documents")),
    uploads: new LocalDiskStore(join(tmpdir(), "leasing-seed-uploads")),
    ejari: noEjari,
    llm: new FakeLlm(() => new Error("the demo seed doesn't call models")),
    webUrl: "http://localhost:3000",
    serverSecret: "demo-only-session-secret",
  };
  const today = clock.today();

  await database.db
    .insert(staffUsers)
    .values(STAFF.map((s) => ({ id: newId(), ...s })))
    .onConflictDoNothing({ target: staffUsers.email });
  await database.db
    .insert(companyPolicy)
    .values({
      id: newId(),
      version: 1,
      effectiveFrom: "2025-01-01" as CalendarDate,
      values: defaultCompanyPolicy,
      createdBy: "demo",
    })
    .onConflictDoNothing({ target: companyPolicy.version });

  // Three fictional companies, each with its own rent and contract rules.
  await database.db
    .insert(companies)
    .values(DEMO_COMPANIES.map((c) => ({ id: newId(), ...c, createdBy: "demo" })))
    .onConflictDoNothing({ target: companies.slug });
  const companyIds = await demoCompanyIds(database);
  const companyOf = (slug: string) => companyIds.get(slug)!;
  // Each company is the landlord of its units (D44): full fictional legal and signatory details.
  await withTx(database, async (tx) => {
    for (const c of DEMO_COMPANIES) {
      const legal = DEMO_COMPANY_LEGAL[c.slug]!;
      const [row] = await tx.db
        .select()
        .from(companies)
        .where(eq(companies.id, companyOf(c.slug)));
      if (row?.signatoryName) continue;
      await updateCompanyLegal(
        ctx,
        tx,
        row!.id,
        {
          ...legal,
          signatoryIdKind: "emirates_id",
          signatoryIdNo: fictionalEid(Number(legal.signatoryEidSerial)),
        },
        "demo",
      );
    }
  });
  const [hasRule] = await database.db.select({ id: rentRules.id }).from(rentRules).limit(1);
  if (!hasRule) {
    await database.db.insert(rentRules).values(
      DEMO_RENT_RULES.map((r) => ({
        id: newId(),
        companyId: companyOf(r.company),
        category: r.category,
        emirate: "dubai",
        community: r.community ?? null,
        minPctBp: r.minPctBp,
        maxPctBp: r.maxPctBp,
        minRentFils: r.minRentAed === undefined ? null : r.minRentAed * 100,
        maxRentFils: r.maxRentAed === undefined ? null : r.maxRentAed * 100,
        createdBy: "demo",
      })),
    );
    await database.db.insert(contractRules).values(
      DEMO_CONTRACT_RULES.map((r) => ({
        id: newId(),
        companyId: companyOf(r.company),
        category: r.category,
        tenures: r.tenures,
        minCheques: r.minCheques,
        maxCheques: r.maxCheques,
        createdBy: "demo",
      })),
    );
  }

  // Mock Smart Rental Index averages for the demo communities (annual, AED). Fictional values.
  await database.db
    .insert(sriAverages)
    .values(
      DEMO_SRI.map((r) => ({
        id: newId(),
        community: r.community,
        category: r.category,
        bedrooms: r.bedrooms,
        avgAnnualRentFils: r.avgAnnualRentAed === undefined ? null : r.avgAnnualRentAed * 100,
        avgAnnualRentPerSqftFils: r.avgAnnualRentPerSqftAed === undefined ? null : r.avgAnnualRentPerSqftAed * 100,
        source: "mock" as const,
        effectiveFrom: "2025-01-01" as CalendarDate,
        createdBy: "demo",
      })),
    )
    .onConflictDoNothing();

  for (const slug of ["silverline", "al-noor-holdings"] as const) {
    const results = await importLeasesCsv(ctx, leasesCsvFor(today, slug), "demo", companyOf(slug));
    for (const r of results)
      console.log(`  lease row ${r.row}: ${r.status} ${r.ref ?? ""} ${r.state ?? ""} ${r.reasons.join("; ")}`);
  }

  // Listing details for the let units (the CSV import carries only lease columns).
  for (const [code, d] of Object.entries(LET_UNIT_DETAILS)) {
    await database.db.update(units).set(d).where(eq(units.code, code));
  }

  // Three units without leases, walked through the Manager so their events are real.
  const empty = [
    { code: "MRN-1502", unitNo: "1502", bedrooms: 1, makaniNo: DEMO_MRN_1502_MAKANI, target: "PREP" },
    { code: "MRN-1608", unitNo: "1608", bedrooms: 2, makaniNo: "1111144444", target: "READY" },
    { code: "JVC-0412", unitNo: "412", bedrooms: 1, makaniNo: "2222233333", target: "LISTED" },
  ] as const;
  let listedId: string | null = null;
  const newlyListed = new Set<string>();
  for (const u of empty) {
    const id = newId();
    const inserted = await database.db
      .insert(units)
      .values({
        id,
        code: u.code,
        building: u.code.startsWith("MRN") ? "Demo Marina Tower" : "Demo Circle Residence",
        community: u.code.startsWith("MRN") ? "Dubai Marina" : "Jumeirah Village Circle",
        companyId: companyOf(LET_UNIT_COMPANY(u.code)),
        unitNo: u.unitNo,
        dldPropertyNo: demoDldNo(u.unitNo),
        makaniNo: u.makaniNo,
        dewaPremiseNo: `DEMO-DEWA-${u.unitNo}`,
        areaSqft: u.bedrooms === 2 ? 1180 : 790,
        bedrooms: u.bedrooms,
        furnished: false,
        askingRentFils: u.code === "MRN-1502" ? 10_000_000 : u.bedrooms === 2 ? 16_000_000 : 7_400_000,
        floor: Number(u.unitNo.slice(0, -2)) || 4,
        bathrooms: u.bedrooms + 1,
        parkingSpaces: 1,
        description: DESCRIPTIONS[u.code] ?? null,
      })
      .onConflictDoNothing({ target: units.code })
      .returning({ id: units.id });
    if (!inserted.length) continue;
    if (u.target !== "PREP") await advance(ctx, { kind: "unit", id }, "MARK_READY", { actor: "demo" });
    if (u.target === "LISTED") {
      await advance(ctx, { kind: "unit", id }, "PUBLISH", { actor: "demo" });
      listedId = id;
    }
    console.log(`  unit ${u.code}: ${u.target}`);
  }

  // More fictional homes for the public site: listed, no leases, so they are bookable. Same
  // Manager walk as JVC-0412 (MARK_READY, then PUBLISH).
  for (const u of DEMO_LISTED_UNITS) {
    const id = newId();
    const inserted = await database.db
      .insert(units)
      .values({
        id,
        code: u.code,
        building: u.building,
        community: u.community,
        companyId: companyOf(u.company),
        category: u.category,
        subtype: u.subtype,
        unitNo: u.unitNo,
        dldPropertyNo: demoDldNo(u.unitNo),
        makaniNo: u.makaniNo,
        dewaPremiseNo: `DEMO-DEWA-${u.unitNo}`,
        areaSqft: u.areaSqft,
        bedrooms: u.bedrooms,
        furnished: u.furnished,
        askingRentFils: u.askingRentFils,
        floor: u.category === "retail" ? 0 : Number(u.unitNo.slice(0, -2)) || 2,
        bathrooms: Math.max(1, u.bedrooms ?? 1),
        parkingSpaces: u.bedrooms === 0 ? 0 : 1,
        description: u.description,
      })
      .onConflictDoNothing({ target: units.code })
      .returning({ id: units.id });
    if (!inserted.length) continue;
    await advance(ctx, { kind: "unit", id }, "MARK_READY", { actor: "demo" });
    await advance(ctx, { kind: "unit", id }, "PUBLISH", { actor: "demo" });
    newlyListed.add(u.code);
    console.log(`  unit ${u.code}: LISTED`);
  }

  // Steps 5–6: a lease waiting for its contract on MRN-1608. The tenant applied with a passport
  // only, so the KYC-verified name is in capitals as the passport's machine-readable zone prints
  // it; the simulated Ejari holds "Lena Testova" (title case): the demo name-case rejection.
  const [readyUnit] = await database.db.select().from(units).where(eq(units.code, "MRN-1608"));
  const [existingLease] = readyUnit
    ? await database.db.select({ id: leases.id }).from(leases).where(eq(leases.unitId, readyUnit.id))
    : [];
  if (readyUnit && !existingLease) {
    const start = addDays(today, 21);
    const end = addDays(addYears(start, 1), -1);
    const rent = readyUnit.askingRentFils ?? 13_500_000;
    await withTx(database, async (tx) => {
      const { party: landlord } = await companyLandlord(tx, readyUnit.companyId);
      const tenantId = newId();
      await tx.db.insert(parties).values({
        id: tenantId,
        kind: "individual",
        fullNameEn: "LENA TESTOVA",
        email: "lena.applicant@demo.example",
        nationality: "UTO",
        passportNo: "UT2048611",
        passportExpiresOn: addYears(today, 5),
        birthDate: "1995-06-30" as CalendarDate,
      });
      const appId = newId();
      await tx.db.insert(applications).values({
        id: appId,
        unitId: readyUnit.id,
        partyId: tenantId,
        state: "CONVERTED",
        source: "staff",
        ref: "A-DEMO16",
        requestedMoveInOn: start,
        kycVerifiedAt: clock.now(),
        offerAcceptedAt: clock.now(),
        reservationPaidOn: today,
        reservationFils: Math.floor(rent / 20),
        reservationRef: "DEMO-RES-1608",
        offer: {
          revision: 1,
          annualRentFils: rent,
          askingRentFils: rent,
          cheques: 4,
          depositFils: Math.floor(rent / 20),
          rentFreeDays: 0,
          moveInOn: start,
          startOn: start,
          endOn: end,
          reservationFils: Math.floor(rent / 20),
          expiresOn: addDays(today, 7),
        },
      });
      const leaseId = newId();
      await tx.db.insert(leases).values({
        id: leaseId,
        ref: `MRN-1608/${start.slice(0, 7)}`,
        unitId: readyUnit.id,
        applicationId: appId,
        state: "CONTRACT",
        startOn: start,
        endOn: end,
        annualRentFils: rent,
        cheques: 4,
        depositFils: Math.floor(rent / 20),
        rulesVersion: ctx.rulesVersion,
        source: "demo",
      });
      await tx.db.insert(leaseParties).values([
        { leaseId, partyId: tenantId, role: "tenant" },
        { leaseId, partyId: landlord.id, role: "landlord" },
      ]);
      await appendEvent(tx, ctx, {
        entity: { kind: "lease", id: leaseId },
        type: "LEASE_CREATED",
        actor: "demo",
        toState: "CONTRACT",
        payload: { applicationId: appId, note: "demo: passport-only tenant, ready for the contract" },
        rulesVersion: ctx.rulesVersion,
      });
    });
    console.log("  lease MRN-1608: CONTRACT (prepare the contract from the lease page)");
  }

  // An applicant for the listed unit, named like the fictional ID specimens so the demo
  // can upload `priya-eid-front.png` / `priya-eid-back.png`. Left at ENQUIRY: the seed sends no
  // email, so "Book viewing" on the application page sends the invitation live, then
  // "Showed up" sends the upload link.
  if (listedId) {
    const a = await createApplication(
      ctx,
      {
        unitId: listedId,
        nameEn: "Priya Example Rao",
        email: "priya.applicant@demo.example",
        kind: "individual",
        requestedMoveInOn: addDays(today, 30),
      },
      "demo",
    );
    console.log(`  application ${a.ref}: ENQUIRY (book a viewing from the application page) (JVC-0412)`);

    // A second applicant already at SCREENING with an open upload link, for the portal
    // document-upload demo (open the upload link from the application page).
    const o = await createApplication(
      ctx,
      {
        unitId: listedId,
        nameEn: "Omar Example",
        email: "omar.applicant@demo.example",
        kind: "individual",
        requestedMoveInOn: addDays(today, 30),
      },
      "demo",
    );
    // Through the Manager like the staff flow, but the application emails are not queued (the seed
    // sends none): the upload link is created here instead, as the "docs" email job would.
    const quiet: EngineContext = { ...ctx, scheduler: { send: async () => null } };
    await bookViewing(quiet, o.id, new Date(clock.now().getTime() + 86_400_000), "demo");
    await recordViewingOutcome(quiet, o.id, "attended", "demo seed", "demo");
    await withTx(database, (tx) =>
      createLink(ctx, tx, {
        purpose: "kyc_upload",
        entity: { kind: "application", id: o.id },
        partyId: o.partyId,
        ttlDays: 7,
      }),
    );
    console.log(
      `  application ${o.ref}: SCREENING with an open upload link (portal document-upload demo: open the link from the application page) (JVC-0412)`,
    );
  }

  await seedWorkspaceStages(ctx, newlyListed);
}

type Stop = "viewing" | "offer_sent" | "offer_held" | "contract_sent" | "ejari_pending";

/**
 * One fictional applicant per remaining Workspace stage, all through the Manager. KYC rests on a
 * `kyc_review` approval that the demo officer decides (the seed has no model to read documents).
 * No email is sent: jobs are dropped, like the SCREENING demo above.
 */
async function seedWorkspaceStages(ctx: EngineContext, newlyListed: Set<string>) {
  const { database, clock } = ctx;
  const today = clock.today();
  const quiet: EngineContext = { ...ctx, scheduler: { send: async () => null } };
  const [officer] = await database.db.select().from(staffUsers).where(eq(staffUsers.email, "officer@demo.example"));
  if (!officer) return;
  const plan: { unit: string; name: string; email: string; serial: number; stop: Stop; note: string }[] = [
    {
      unit: "BBY-0903",
      name: "Karim Example Saleh",
      email: "karim.applicant@demo.example",
      serial: 2000001,
      stop: "viewing",
      note: "VIEWING booked for tomorrow",
    },
    {
      unit: "BBY-1710",
      name: "Hana Sample Ibrahim",
      email: "hana.applicant@demo.example",
      serial: 2000002,
      stop: "offer_sent",
      note: "OFFER sent (waiting for the applicant)",
    },
    {
      unit: "JVC-0221",
      name: "Tariq Demo Mansoor",
      email: "tariq.applicant@demo.example",
      serial: 2000003,
      stop: "offer_held",
      note: "OFFER held (send it from the Workspace)",
    },
    {
      unit: "ARR-0017",
      name: "Leila Example Farouk",
      email: "leila.applicant@demo.example",
      serial: 2000004,
      stop: "contract_sent",
      note: "lease in CONTRACT, awaiting signatures",
    },
    {
      unit: "MRN-0709",
      name: "Yusuf Sample Karim",
      email: "yusuf.applicant@demo.example",
      serial: 2000005,
      stop: "ejari_pending",
      note: "lease in REGISTRATION, Ejari submission pending approval",
    },
  ];
  for (const p of plan) {
    if (!newlyListed.has(p.unit)) continue;
    const [unit] = await database.db.select().from(units).where(eq(units.code, p.unit));
    if (!unit) continue;
    const a = await createApplication(
      quiet,
      {
        unitId: unit.id,
        nameEn: p.name,
        email: p.email,
        kind: "individual",
        requestedMoveInOn: addDays(today, 30),
      },
      "demo",
    );
    await bookViewing(quiet, a.id, new Date(clock.now().getTime() + 86_400_000), "demo");
    if (p.stop === "viewing") {
      console.log(`  application ${a.ref}: ${p.note} (${p.unit})`);
      continue;
    }
    await recordViewingOutcome(quiet, a.id, "attended", "demo seed", "demo");
    await verifyKyc(quiet, officer, a, fictionalEid(p.serial), p.stop === "offer_held");
    if (p.stop === "offer_sent" || p.stop === "offer_held") {
      console.log(`  application ${a.ref}: ${p.note} (${p.unit})`);
      continue;
    }
    await walkToContract(quiet, officer, a.id, p.stop === "ejari_pending");
    console.log(`  application ${a.ref}: ${p.note} (${p.unit})`);
  }
}

/** SCREENING → OFFER: the officer approves a KYC review for a fictional identity; the offer is made by the Manager. */
async function verifyKyc(
  ctx: EngineContext,
  officer: StaffUser,
  a: { id: string; partyId: string },
  emiratesIdNo: string,
  holdOffer: boolean,
) {
  const [party] = await ctx.database.db.select().from(parties).where(eq(parties.id, a.partyId));
  const today = ctx.clock.today();
  const proposal = {
    applicationId: a.id,
    helperRunId: "demo-seed",
    identity: {
      fullNameEn: party!.fullNameEn,
      nationality: "Fictionland",
      birthDate: "1900-01-01" as CalendarDate,
      emiratesIdNo,
      idExpiresOn: addYears(today, 5),
      passportNo: null,
      passportExpiresOn: null,
      visaNo: null,
      visaExpiresOn: null,
      companyName: null,
      tradeLicenceNo: null,
      tradeLicenceExpiresOn: null,
    },
    flags: [
      {
        kind: "manual_review" as const,
        message: "Demo seed: documents were not read by a model; fictional identity.",
        docId: null,
        blocking: false,
      },
    ],
    documentIds: [],
    applicantKind: "individual" as const,
    policyVersion: null,
  };
  const { id } = await withTx(ctx.database, (tx) =>
    requestApproval(ctx, tx, {
      gate: "kyc_review",
      entity: { kind: "application", id: a.id },
      dedupeKey: `${a.id}:kyc_review:demo-seed`,
      title: `KYC review: ${party!.fullNameEn} (demo seed)`,
      proposal,
      reasons: proposal.flags.map((f) => f.message),
      sources: [],
      rulesVersion: ctx.rulesVersion,
      proposedBy: "demo",
    }),
  );
  await decideApproval(ctx, id, officer, { decision: "approve" });
  // The approval is decided by a person; KYC_VERIFIED then goes through the Manager like the approval route does.
  await advance(ctx, { kind: "application", id: a.id }, "KYC_VERIFIED", {
    actor: `user:${officer.id}`,
    approvalId: id,
    payload: proposal,
    ...(holdOffer ? { offerEntry: { autopilot: { auto_send_offer: false } } } : {}),
  });
}

/**
 * OFFER → accepted → reservation → lease in CONTRACT → contract prepared and approved (sent to both
 * signers) and, if asked, signed by both → REGISTRATION with the Ejari submission awaiting approval.
 */
async function walkToContract(ctx: EngineContext, officer: StaffUser, applicationId: string, signed: boolean) {
  const { database, clock } = ctx;
  const inbound = await withTx(database, (tx) =>
    receiveInbound(ctx, tx, {
      type: "OFFER_RESPONDED",
      payload: { revision: 1, choice: "accept" },
      channel: "staff",
      actor: "demo",
      entity: { kind: "application", id: applicationId },
    }),
  );
  await processInbound(ctx, inbound.id);
  await recordReservation(ctx, applicationId, { paidOn: clock.today(), reference: `DEMO-RES-${inbound.ref}` }, "demo");
  const [lease] = await database.db.select().from(leases).where(eq(leases.applicationId, applicationId));
  const prepared = await prepareContract(ctx, lease!.id, { addendum: DEFAULT_ADDENDUM, actor: "system" });
  if (prepared.status !== "prepared") throw new Error(`demo seed: contract for ${lease!.ref} was not prepared`);
  const [c] = await database.db.select().from(contracts).where(eq(contracts.leaseId, lease!.id));
  await decideApproval(ctx, c!.approvalId!, officer, { decision: "approve" });
  if (!signed) return;
  // The signing links normally travel by email; the seed makes them itself and signs as each party.
  const signers = await database.db.select().from(contractSigners).where(eq(contractSigners.contractId, c!.id));
  for (const s of signers) {
    const link = await withTx(database, async (tx) => {
      const l = await createLink(ctx, tx, {
        purpose: "sign",
        entity: { kind: "lease", id: lease!.id },
        partyId: s.partyId,
        ttlDays: 7,
      });
      await tx.db.update(contractSigners).set({ linkId: l.id }).where(eq(contractSigners.id, s.id));
      const [row] = await tx.db.select().from(actionLinks).where(eq(actionLinks.id, l.id));
      return row!;
    });
    await signContract(ctx, link, { typedName: s.nameEn, consent: true }, { ip: null, userAgent: "demo seed" });
  }
  await finishContract(ctx, c!.id);
}

if (import.meta.main) {
  const env = loadEnv();
  if (!env.DEMO_MODE) throw new Error("demo:seed needs DEMO_MODE=true");
  const database = createDatabase(env.DATABASE_URL, { max: 2 });
  await seedDemo(database);
  await database.close();
  console.log("demo data seeded");
}

/**
 * Demo console: imports the demo leases that are missing, next to whatever data exists (nothing
 * is deleted or changed). A unit that already has a live lease is reported, not touched; the
 * import's own duplicate check makes this safe to run twice.
 */
export async function seedMissingDemoLeases(ctx: EngineContext) {
  const companyIds = await demoCompanyIds(ctx.database);
  const results = [];
  for (const slug of ["silverline", "al-noor-holdings"] as const)
    results.push(...(await importLeasesCsv(ctx, leasesCsvFor(ctx.clock.today(), slug), "demo", companyIds.get(slug)!)));
  for (const [code, d] of Object.entries(LET_UNIT_DETAILS)) {
    await ctx.database.db
      .update(units)
      .set(d)
      .where(and(eq(units.code, code), isNull(units.description)));
  }
  return results.map((r) => ({
    row: r.row,
    status: r.status,
    ref: r.ref ?? null,
    state: r.state ?? null,
    reasons: r.reasons,
  }));
}
