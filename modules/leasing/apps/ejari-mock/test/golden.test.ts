import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CalendarDate, DEMO_COMPANY_LEGAL, type EjariPayload, FixedClock, luhnCheckDigit } from "@leasing/core";
import { sql } from "drizzle-orm";
import { createEjariMock } from "../src/app.ts";
import { certificatePdf } from "../src/certificate.ts";
import { bootstrap, createMockDatabase, type MockDb, reset } from "../src/db.ts";
import { page } from "../src/ui.ts";

/**
 * Golden record of the simulated Ejari and Tawtheeq (C27, S53). The shell they share moved to
 * `@platform/adapters`; these files were recorded BEFORE the move and the leasing mock must stay byte-identical.
 * `UPDATE_GOLDEN=1 bun test .../golden.test.ts` rewrites them (only to be used on unchanged behaviour).
 */
const DIR = join(import.meta.dir, "golden");
const update = process.env.UPDATE_GOLDEN === "1";
const check = (name: string, actual: string | Uint8Array) => {
  const file = join(DIR, name);
  if (update) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  expect(existsSync(file)).toBe(true);
  const want = readFileSync(file);
  const got = typeof actual === "string" ? Buffer.from(actual) : Buffer.from(actual);
  expect(got.equals(want)).toBe(true);
};

const DB_URL = process.env.TEST_DATABASE_URL;
const noDb = !DB_URL;
let db: MockDb;
const clock = new FixedClock(new Date("2026-11-01T04:00:00Z"));
const d = (s: string) => s as CalendarDate;
const eid = (year: string, serial: string) => `784-${year}-${serial}-${luhnCheckDigit(`784${year}${serial}`)}`;
const priya = (over: Partial<EjariPayload> = {}): EjariPayload => ({
  tenantNameEn: "Priya Example Rao",
  tenantIdType: "emirates_id",
  tenantIdNo: eid("1991", "4820193"),
  tenantIdExpiresOn: d("2029-08-14"),
  tenantNationality: "IND",
  landlordNameEn: DEMO_COMPANY_LEGAL.silverline!.legalNameEn,
  landlordIdNo: null,
  propertyUsage: "residential",
  dldPropertyNo: "DEMO-DLD-000412",
  unitNo: "412",
  makaniNo: "2222233333",
  plotNo: null,
  startOn: d("2026-12-01"),
  endOn: d("2027-11-30"),
  annualRentFils: 7_400_000,
  cheques: 4,
  depositFils: 370_000,
  ...over,
});

/** pdf-lib stamps the current time into the file: freeze it for the bytes (the golden is of everything else). */
async function withFrozenDate<T>(run: () => Promise<T>): Promise<T> {
  const Real = Date;
  const FROZEN = Real.parse("2026-11-01T04:00:00Z");
  class Frozen extends Real {
    constructor(...a: unknown[]) {
      super(...((a.length ? a : [FROZEN]) as [number]));
    }
    static override now() {
      return FROZEN;
    }
  }
  globalThis.Date = Frozen as unknown as DateConstructor;
  try {
    return await run();
  } finally {
    globalThis.Date = Real;
  }
}

const TS = /\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/g;

describe.skipIf(noDb)("golden: simulated Ejari and Tawtheeq", () => {
  beforeAll(async () => {
    if (!/test/.test(new URL(DB_URL!).pathname)) throw new Error("TEST_DATABASE_URL must name a *test* database");
    db = createMockDatabase(DB_URL!, { max: 3 }).db;
    await db.execute(sql`SET client_min_messages = warning; DROP SCHEMA IF EXISTS ejari_mock CASCADE`);
    await bootstrap(db);
  });
  beforeEach(async () => {
    await reset(db);
  });

  const post = (app: ReturnType<typeof createEjariMock>, path: string, body: unknown) =>
    app.fetch(new Request(`http://ejari.test${path}`, { method: "POST", body: JSON.stringify(body) }));

  test("201, 422 and 503 bodies and the console page, per system", async () => {
    const out: Record<string, unknown> = {};
    for (const [system, prefix] of [
      ["ejari", ""],
      ["tawtheeq", "/tawtheeq"],
    ] as const) {
      await reset(db);
      const ok = createEjariMock({ db, clock, failureRate: 0, random: () => 0.5, demoMode: true });
      const issued = await post(ok, `${prefix}/api/v1/registrations`, {
        requestId: `golden-ok-${system}`,
        contract: priya(),
      });
      const rejected = await post(ok, `${prefix}/api/v1/registrations`, {
        requestId: `golden-no-${system}`,
        contract: priya({ tenantNameEn: "priya example rao", dldPropertyNo: "DEMO-DLD-000413" }),
      });
      const invalid = await post(ok, `${prefix}/api/v1/registrations`, { requestId: "x" });
      const down = createEjariMock({ db, clock, failureRate: 1, random: () => 0.5, demoMode: true });
      const unavailable = await post(down, `${prefix}/api/v1/registrations`, {
        requestId: `golden-503-${system}`,
        contract: priya(),
      });
      out[system] = {
        issued: [issued.status, await issued.json()],
        rejected: [rejected.status, await rejected.json()],
        invalid: [invalid.status, await invalid.json()],
        unavailable: [unavailable.status, await unavailable.json()],
      };
      const html = await (await ok.fetch(new Request("http://ejari.test/"))).text();
      check(`index-${system}.html`, html.replace(TS, "<time>"));
    }
    check("bodies.json", `${JSON.stringify(out, null, 2)}\n`);
  });

  test("the empty console page", async () => {
    const app = createEjariMock({ db, clock, failureRate: 0, random: () => 0.5, demoMode: true });
    check("index-empty.html", await (await app.fetch(new Request("http://ejari.test/"))).text());
  });

  test("the console page for fixed rows", () => {
    const html = page(
      [
        {
          ejariNo: "SIM-2026-0000001",
          dldPropertyNo: "P-1",
          tenantIdNo: "x",
          tenantName: "A <b>&\"'",
          landlordName: "L",
          startOn: "2026-12-01",
          endOn: "2027-11-30",
          annualRentFils: 1,
          system: "ejari",
          state: "active",
          payload: { prior: true },
          issuedOn: "2026-11-01",
          cancelledOn: null,
          cancelReason: null,
          createdAt: new Date("2026-11-01T00:00:00Z"),
        },
        {
          ejariNo: "SIM-TWQ-2026-0000001",
          dldPropertyNo: "P-2",
          tenantIdNo: "y",
          tenantName: "B",
          landlordName: "L",
          startOn: "2026-12-01",
          endOn: "2027-11-30",
          annualRentFils: 1,
          system: "tawtheeq",
          state: "cancelled",
          payload: { prior: true },
          issuedOn: "2026-11-01",
          cancelledOn: null,
          cancelReason: null,
          createdAt: new Date("2026-11-01T00:00:00Z"),
        },
      ],
      [
        {
          id: 1,
          requestId: "r",
          system: "ejari",
          kind: "register",
          outcome: "rejected",
          ejariNo: null,
          reasons: [{ code: "NAME_MISMATCH", field: null, message: "m <i>" }],
          payload: priya(),
          receivedAt: new Date("2026-11-01T01:02:03Z"),
        },
        {
          id: 2,
          requestId: null,
          system: "tawtheeq",
          kind: "register",
          outcome: "issued",
          ejariNo: "SIM-TWQ-2026-0000001",
          reasons: [],
          payload: priya(),
          receivedAt: new Date("2026-11-01T01:02:04Z"),
        },
      ],
    );
    check("index-rows.html", html);
  });

  test("the certificate PDF bytes, both systems", async () => {
    for (const system of ["ejari", "tawtheeq"] as const) {
      const make = () =>
        withFrozenDate(() =>
          certificatePdf({
            system,
            ejariNo: system === "ejari" ? "SIM-2026-0000001" : "SIM-TWQ-2026-0000001",
            issuedOn: "2026-11-01",
            dldPropertyNo: "DEMO-DLD-000412",
            unitNo: "412",
            makaniNo: "2222233333",
            tenantName: "Priya Example Rao",
            landlordName: "Silverline Example LLC",
            startOn: "2026-12-01",
            endOn: "2027-11-30",
            annualRent: "AED 74,000.00",
          }),
        );
      const a = await make();
      expect(Buffer.from(await make()).equals(Buffer.from(a))).toBe(true); // deterministic, so a golden is meaningful
      check(`certificate-${system}.pdf`, a);
    }
  });
});
