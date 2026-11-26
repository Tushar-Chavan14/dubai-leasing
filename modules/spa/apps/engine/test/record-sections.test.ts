/* oxlint-disable no-explicit-any -- section bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SpaRole } from "@spa/core";
import type { SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { getDealRecord } from "../src/manager/reads.ts";
import { RECORD_SECTIONS, settlementBalance } from "../src/manager/views.ts";
import { eq } from "drizzle-orm";
import { deals } from "@spa/db";
import { COMPLIANCE_WORDS, EID, PASSPORT, PHONE } from "./reads-fixture.ts";
import { buildLateWorld, FILE_FACTS, IBAN, type LateWorld } from "./record-late-fixture.ts";

const url = spaTestDatabaseUrl();
const ROLES = SpaRole.options;
const NEW_KEYS = ["documents", "aml", "agreement", "signing", "noc", "finance", "settlement", "registration"];
const isCompliance = (r: string) => r === "compliance_officer" || r === "mlro";

/** The new sections each role may read on a deal that reached every step (each follows the section's own route). */
const STAFF = ["documents", "agreement", "signing", "noc", "finance", "registration"];
const EXPECT_LATE: Record<string, string[]> = {
  sales_officer: [...STAFF, "settlement"],
  sales_manager: [...STAFF, "settlement"],
  sales_admin: [...STAFF, "settlement"],
  admin: STAFF,
  legal: [...STAFF, "settlement"],
  finance: [...STAFF, "settlement"],
  compliance_officer: ["documents", "aml"],
  mlro: ["documents", "aml"],
};

describe.skipIf(!url)("C39: deal record sections (S71)", () => {
  let database: SpaDatabase;
  let w: LateWorld;
  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    w = await buildLateWorld(database);
  });
  afterAll(async () => {
    await database?.close();
  });
  const viewer = (role: string) => {
    const u = Object.values(w.users).find((x) => x.role === role)!;
    return { id: u.id, role: u.role };
  };
  const record = (role: string, dealId: string) => getDealRecord(w.ctx, viewer(role), dealId);
  const keys = async (role: string, dealId: string) =>
    Object.keys((await record(role, dealId)).sections).filter((k) => NEW_KEYS.includes(k));

  test("role matrix: all eight roles, every new section key, on a deal that reached every step", async () => {
    for (const role of ROLES)
      expect((await keys(role, w.late.dealId)).toSorted()).toEqual(EXPECT_LATE[role]!.toSorted());
  });

  test("a section a role may not read has no key at all (absent, not empty)", async () => {
    const s = (await record("sales_officer", w.late.dealId)).sections;
    expect("aml" in s).toBe(false);
    expect(JSON.stringify(s)).not.toContain('"aml"');
    const c = (await record("compliance_officer", w.late.dealId)).sections;
    for (const k of ["signing", "noc", "finance", "settlement", "registration", "agreement"])
      expect(k in c).toBe(false);
  });

  test("the compliance-only section: case status, risk level, case count; admin does not read it", async () => {
    for (const role of ["compliance_officer", "mlro"]) {
      const a = (await record(role, w.held.dealId)).sections.aml as any;
      expect(a.caseCount).toBe(1);
      expect(a.riskLevel).toBe("high");
      expect(a.cases).toHaveLength(1);
      expect(a.cases[0].status).toBe("open");
      expect(typeof a.cases[0].id).toBe("string");
    }
    expect("aml" in (await record("admin", w.held.dealId)).sections).toBe(false);
  });

  test("AML word scan: nothing in a record reads like a compliance matter for any other role", async () => {
    for (const role of ROLES.filter((r) => !isCompliance(r)))
      for (const id of [w.held.dealId, w.late.dealId, w.early.dealId, w.noBank.dealId, w.reg.dealId, w.plain.dealId]) {
        const text = JSON.stringify((await record(role, id)).sections);
        expect(text).not.toMatch(COMPLIANCE_WORDS);
      }
  });

  test("planted ID, passport, phone and account numbers never leave, for any role, on any deal", async () => {
    for (const role of ROLES)
      for (const id of [w.held.dealId, w.late.dealId, w.reg.dealId]) {
        const text = JSON.stringify(await record(role, id));
        for (const raw of [PASSPORT, EID, PHONE, IBAN]) expect(text).not.toContain(raw);
      }
    // The free text is still there, masked (so the test is not passing because the data went missing).
    const late = JSON.stringify((await record("finance", w.late.dealId)).sections);
    expect(late).toContain("Passport");
  });

  test("no file name, storage key, hash, mime type, link token or address in any section", async () => {
    for (const role of ROLES) {
      const text = JSON.stringify((await record(role, w.late.dealId)).sections);
      for (const f of FILE_FACTS) expect(text).not.toContain(f);
    }
  });

  test("documents: kind, masked party name, uploaded date, read state; Read, not confirmed when unconfirmed", async () => {
    const docs = (await record("sales_officer", w.late.dealId)).sections.documents as any[];
    expect(docs).toHaveLength(4);
    for (const d of docs)
      expect(Object.keys(d).toSorted()).toEqual(["confirmed", "kind", "partyName", "readState", "uploadedOn"]);
    const by = (k: string) => docs.find((d) => d.kind === k);
    expect(by("passport").partyName).toContain("Buyer Late");
    expect(by("passport").partyName).not.toContain(PASSPORT);
    expect(by("noc").partyName).toBeNull();
    expect(by("passport").uploadedOn).toBe("2026-11-19");
    expect(by("passport").readState).toBe("read");
    expect(by("passport").confirmed).toBe(false);
    expect(by("noc").confirmed).toBe(true);
    expect(by("pre_approval").readState).toBe("not_read");
    expect(by("pre_approval").confirmed).toBe(true);
  });

  test("signing: signers by name, role, order and state with link expiry; no link, token or address", async () => {
    const s = (await record("legal", w.late.dealId)).sections.signing as any;
    expect(s.signers.map((x: any) => [x.seq, x.role, x.state])).toEqual([
      [1, "seller", "signed"],
      [2, "purchaser", "link_expired"],
    ]);
    expect(s.signers[1].linkExpiresOn).toBe("2026-11-18");
    expect(Object.keys(s.signers[0]).toSorted()).toEqual(["linkExpiresOn", "name", "role", "seq", "state"]);
  });

  test("agreement: version, status, template name and version, prepared date (a Dubai calendar day)", async () => {
    const a = (await record("sales_manager", w.late.dealId)).sections.agreement as any;
    expect(a).toMatchObject({
      version: 2,
      status: "approved",
      kind: "assignment",
      templateVersion: 3,
      preparedOn: "2026-11-19",
    });
    expect(a.templateName).toContain("Assignment form");
  });

  test("noc and finance reuse the NOC status; finance adds bank letters and payments without compliance fields", async () => {
    const r = (await record("finance", w.late.dealId)).sections as any;
    expect(r.noc).toMatchObject({ status: "review", paidFils: 5_000_000, paidConfirmed: true });
    expect(r.finance.bankLetters).toEqual([
      {
        side: "buyer",
        kind: "pre_approval",
        issuedOn: "2026-11-02",
        validUntil: "2027-01-02",
        amountFils: 120_000_000,
        confirmed: true,
      },
    ]);
    expect(r.finance.payments).toHaveLength(1);
    expect(r.finance.payments[0].note).toBe("Payer name needs review");
    expect(Object.keys(r.finance.payments[0]).toSorted()).toEqual(
      ["account", "amountFils", "amountReadFils", "intoEscrow", "method", "note", "paidOn", "seq", "status"].toSorted(),
    );
    // Legal may read the bank letters but not the payments (the payments route's own role list).
    const legal = (await record("legal", w.late.dealId)).sections.finance as any;
    expect(legal.bankLetters).toHaveLength(1);
    expect(legal.payments).toEqual([]);
    for (const k of ["payerName", "payerIsBuyer", "reasonCode"]) expect(k in r.finance.payments[0]).toBe(false);
  });

  test("settlement (resale only): lines and sources in fils; the engine says whether it balances to zero", async () => {
    const s = (await record("finance", w.late.dealId)).sections.settlement as any;
    expect(s.statement.lines).toHaveLength(3);
    expect(s.statement.lines[0]).toMatchObject({ amountFils: 50_000_000, source: "letter" });
    expect(s.statement.balancesToZero).toBe(true);
    expect(s.statement.differenceFils).toBe(0);
    expect(s.statement.priceFils).toBe(200_000_000);
    expect("settlement" in (await record("finance", w.reg.dealId)).sections).toBe(false);
  });

  test("registration: Oqood and transfer attempts with the reasons masked", async () => {
    const t = (await record("sales_admin", w.late.dealId)).sections.registration as any;
    expect(t.attempts[0]).toMatchObject({ kind: "trustee_transfer", attempt: 1, status: "rejected" });
    expect(t.attempts[0].reasons[0].message).toContain("Passport");
    const o = (await record("sales_admin", w.reg.dealId)).sections.registration as any;
    expect(o.attempts[0].kind).toBe("oqood_register");
  });

  test("a section appears only when its step applies to the deal type and the deal has reached it", async () => {
    // primary: no NOC, banks or settlement; registration yes
    expect((await keys("finance", w.reg.dealId)).toSorted()).toEqual([
      "agreement",
      "documents",
      "registration",
      "signing",
    ]);
    // resale in NOC: NOC yes; banks, settlement, transfer not reached yet
    expect((await keys("finance", w.early.dealId)).toSorted()).toEqual(["agreement", "documents", "noc", "signing"]);
    // resale without a mortgage: no banks
    expect((await keys("finance", w.noBank.dealId)).toSorted()).toEqual([
      "agreement",
      "documents",
      "noc",
      "registration",
      "settlement",
      "signing",
    ]);
    // the held deal (parties step): nothing past it
    expect(await keys("finance", w.held.dealId)).toEqual(["documents"]);
    const [late] = await database.db.select().from(deals).where(eq(deals.id, w.reg.dealId));
    const noc = RECORD_SECTIONS.find((s) => s.key === "noc")!;
    expect(noc.appliesTo(late!)).toBe(false);
  });

  test("a section's own role rule is a property of the section", () => {
    const by = (k: string) => RECORD_SECTIONS.find((s) => s.key === k)!;
    expect(ROLES.filter((r) => by("aml").visibleTo!(r))).toEqual(["compliance_officer", "mlro"]);
    expect(ROLES.filter((r) => by("settlement").visibleTo!(r)).includes("admin")).toBe(false);
    expect(by("documents").visibleTo?.("admin") ?? true).toBe(true);
  });

  test("loading a record writes no row and no event", async () => {
    const tables = (
      await database.pool.query("select tablename from pg_tables where schemaname = current_schema()")
    ).rows.map((r) => r.tablename as string);
    const count = async () => {
      const out: Record<string, number> = {};
      for (const t of tables) out[t] = Number((await database.pool.query(`select count(*) from "${t}"`)).rows[0].count);
      return out;
    };
    const before = await count();
    for (const role of ROLES)
      for (const id of [w.held.dealId, w.late.dealId, w.reg.dealId, w.early.dealId]) await record(role, id);
    expect(await count()).toEqual(before);
  });

  test("balances to zero is computed from the price lines, not read from a flag", () => {
    const lines = [
      { code: "price:payoff", amountFils: 40_000_000 },
      { code: "price:balance_to_seller", amountFils: 159_999_999 },
      { code: "fee:dld", amountFils: 8_000_000 },
    ];
    expect(settlementBalance(lines, 200_000_000, 200_000_000)).toEqual({ differenceFils: 1, balancesToZero: false });
    expect(
      settlementBalance([...lines.slice(0, 2), { code: "price:x", amountFils: 1 }], 200_000_000, 200_000_000),
    ).toEqual({
      differenceFils: 0,
      balancesToZero: true,
    });
    // the statement's price must be the deal's price
    expect(settlementBalance([{ code: "price:x", amountFils: 5 }], 5, 6).balancesToZero).toBe(false);
  });
});
