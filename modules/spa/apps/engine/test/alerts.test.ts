/* oxlint-disable no-explicit-any -- rows read loosely in tests */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { FakeMailer } from "@platform/adapters";
import { FixedClock, newId } from "@platform/kernel";
import {
  alertSettings,
  alerts,
  dealEvents,
  deals,
  outboundMessages,
  type SpaDatabase,
  spaApprovals,
  spaUsers,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { ALERTS_JOB, alertsKey, createBoss, startJobs } from "../src/jobs.ts";
import { getAlertSettings, listAlerts, markAlertRead, runAlerts, setAlertSettings } from "../src/manager/alerts.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { dealInDraft, seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const T0 = new Date("2026-11-10T00:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);
const AML_WORDS = /aml|anti-money|sanction|screen|\bpep\b|\bedd\b|risk|launder|suspicious|flag|report|fiu/i;

describe.skipIf(!url)("staff alerts for waiting gates (C23, S30, S62)", () => {
  let database: SpaDatabase;
  let users: Record<string, U>;
  let dealId: string;
  let ref: string;
  const clock = new FixedClock(T0);
  const mailer = new FakeMailer();
  const ctx = (withMail = true): SpaContext => ({
    database,
    clock,
    facts: failClosedFacts,
    ...(withMail ? { mail: { mailer, webBaseUrl: "https://spa.example.test" } } : {}),
  });
  const emailOf = (u: U) => `${Object.entries(users).find(([, v]) => v.id === u.id)![0]}@spa-demo.test`;
  const propose = async (gate: string, role: string, createdHours = 0) => {
    const id = newId();
    await database.db.insert(spaApprovals).values({
      id,
      gate: gate as any,
      entityKind: "deal",
      entityId: dealId,
      dedupeKey: `${dealId}:${gate}:${id}`,
      title: "t",
      proposal: {},
      approverRole: role as any,
      proposedBy: "system",
      createdAt: at(createdHours),
    });
    return id;
  };
  const alertsOf = async (approvalId: string) =>
    (await database.db.select().from(alerts).where(eq(alerts.approvalId, approvalId))).toSorted((a, b) =>
      a.level < b.level ? -1 : 1,
    );
  const named = (rows: { userId: string }[]) =>
    rows.map((r) => Object.entries(users).find(([, v]) => v.id === r.userId)![0]).toSorted();

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    const made = await dealInDraft(ctx(), database, { type: "resale_ready" });
    dealId = made.dealId;
    [{ ref }] = (await database.db.select({ ref: deals.ref }).from(deals).where(eq(deals.id, dealId))) as any;
  });
  afterAll(async () => {
    await database?.close();
  });

  test("an ordinary gate: no alert before its threshold, the approver at it, the sales manager at twice it, each once", async () => {
    const a = await propose("agreement_approval", "legal"); // default 24 hours
    clock.set(at(23));
    await runAlerts(ctx());
    expect(await alertsOf(a)).toEqual([]);
    clock.set(at(24));
    const r1 = await runAlerts(ctx());
    expect(named(await alertsOf(a))).toEqual(["legal"]);
    expect(r1.created).toBeGreaterThanOrEqual(1);
    clock.set(at(47));
    await runAlerts(ctx());
    expect(named(await alertsOf(a))).toEqual(["legal"]);
    clock.set(at(48));
    await runAlerts(ctx());
    const rows = await alertsOf(a);
    expect(named(rows)).toEqual(["legal", "manager"]);
    expect(rows.find((x) => x.userId === users.legal!.id)!.level).toBe("approver");
    expect(rows.find((x) => x.userId === users.manager!.id)!.level).toBe("manager");
    expect(rows.every((x) => x.waitedHours >= 24)).toBe(true);
    // running again changes nothing: no more rows, no more mail
    const mails = mailer.sent.length;
    await runAlerts(ctx());
    clock.set(at(60));
    await runAlerts(ctx());
    expect(await alertsOf(a)).toHaveLength(2);
    expect(mailer.sent.length).toBe(mails);
  });

  test("each alert is an email (through the mail adapter, stored as evidence) and an in-app row; the text is gate, deal and hours only", async () => {
    const a = await propose("agreement_approval", "legal", 100);
    clock.set(at(100 + 25));
    await runAlerts(ctx());
    const [row] = await alertsOf(a);
    expect(row!.outboundMessageId).not.toBeNull();
    const [out] = await database.db
      .select()
      .from(outboundMessages)
      .where(eq(outboundMessages.id, row!.outboundMessageId!));
    expect(out).toMatchObject({
      entityKind: "approval",
      entityId: a,
      purpose: "notice",
      status: "sent",
      template: "gate_alert",
    });
    const mail = mailer.sent.find((m) => m.subject === `Waiting for you · ${ref}` && m.text.includes("25 hours"))!;
    expect(mail.to).toBe(emailOf(users.legal!));
    expect(mail.text).toContain(`Prepared agreement for ${ref} has been waiting 25 hours.`);
    const mine = await listAlerts(ctx(), users.legal!);
    const item = mine.items.find((i) => i.id === row!.id)!;
    expect(item.text).toBe(`Prepared agreement for ${ref} has been waiting 25 hours.`);
    expect(item.level).toBe("approver");
    expect(item.dealRef).toBe(ref);
    expect(Object.keys(item).toSorted()).toEqual(["createdAt", "dealId", "dealRef", "id", "level", "readAt", "text"]);
  });

  test("a compliance gate alerts the compliance officer at its threshold and the MLRO at twice it, with the generic sentence; no other role gets anything", async () => {
    const before = (await database.db.select().from(alerts)).length;
    const a = await propose("aml_flag", "compliance_officer", 200); // default 12 hours
    clock.set(at(200 + 11));
    await runAlerts(ctx());
    expect(await alertsOf(a)).toEqual([]);
    clock.set(at(200 + 12));
    await runAlerts(ctx());
    expect(named(await alertsOf(a))).toEqual(["compliance"]);
    clock.set(at(200 + 24));
    await runAlerts(ctx());
    expect(named(await alertsOf(a))).toEqual(["compliance", "mlro"]);
    const mail = mailer.sent.filter((m) => m.text.includes("A compliance review has been waiting 12 hours."));
    expect(mail.map((m) => m.to)).toEqual([emailOf(users.compliance!)]);
    expect(mail[0]!.subject).toBe("Waiting for you");
    const mlro = mailer.sent.find((m) => m.to === emailOf(users.mlro!) && m.text.includes("24 hours"))!;
    expect(mlro.text).toContain("A compliance review has been waiting 24 hours.");
    // nobody outside compliance has a row for it, in the table or in their list
    for (const who of ["officer", "manager", "salesadmin", "legal", "finance", "admin"] as const)
      expect((await listAlerts(ctx(), users[who]!)).items.every((i) => !i.text.includes("compliance"))).toBe(true);
    expect((await database.db.select().from(alerts)).length).toBeGreaterThan(before);
    const aliens = (await alertsOf(a)).filter((x) => ![users.compliance!.id, users.mlro!.id].includes(x.userId));
    expect(aliens).toEqual([]);
  });

  test("edd_signoff and aml_report are compliance gates too: the same generic sentence, compliance roles only", async () => {
    const e = await propose("edd_signoff", "compliance_officer", 300);
    const r = await propose("aml_report", "mlro", 300);
    clock.set(at(300 + 12));
    await runAlerts(ctx());
    expect(named(await alertsOf(e))).toEqual(["compliance"]);
    expect(named(await alertsOf(r))).toEqual(["mlro"]);
    for (const row of [...(await alertsOf(e)), ...(await alertsOf(r))])
      expect(["compliance", "mlro"]).toContain(named([row])[0]!);
  });

  test("an alert to a sales role carries no AML wording anywhere: in-app, in the mail text, subject and html", async () => {
    for (const who of ["officer", "manager", "salesadmin", "legal", "finance"] as const) {
      const mine = await listAlerts(ctx(), users[who]!);
      for (const i of mine.items) expect(JSON.stringify(i)).not.toMatch(AML_WORDS);
    }
    const nonCompliance = mailer.sent.filter((m) => ![emailOf(users.compliance!), emailOf(users.mlro!)].includes(m.to));
    expect(nonCompliance.length).toBeGreaterThan(0);
    for (const m of nonCompliance) for (const s of [m.subject, m.text, m.html ?? ""]) expect(s).not.toMatch(AML_WORDS);
  });

  test("an approval that is decided stops alerting; an inactive approver is skipped; no mail configured still leaves the in-app row", async () => {
    const decided = await propose("kyc_review", "sales_manager", 400);
    await database.db
      .update(spaApprovals)
      .set({ status: "approved", decidedBy: users.manager!.id, decidedAt: at(400 + 1) })
      .where(eq(spaApprovals.id, decided));
    clock.set(at(400 + 100));
    await runAlerts(ctx());
    expect(await alertsOf(decided)).toEqual([]);

    const gone = await propose("noc_review", "sales_admin", 500);
    await database.db.update(spaUsers).set({ active: false }).where(eq(spaUsers.id, users.salesadmin!.id));
    clock.set(at(500 + 24));
    await runAlerts(ctx());
    expect(await alertsOf(gone)).toEqual([]);
    await database.db.update(spaUsers).set({ active: true }).where(eq(spaUsers.id, users.salesadmin!.id));

    const quiet = await propose("settlement_approval", "finance", 600);
    clock.set(at(600 + 24));
    const sent = mailer.sent.length;
    await runAlerts(ctx(false));
    const rows = await alertsOf(quiet);
    expect(named(rows)).toEqual(["finance"]);
    expect(rows[0]!.outboundMessageId).toBeNull();
    expect(mailer.sent.length).toBe(sent);
  });

  test("a gate that has no user to escalate to (the approver is the manager) alerts that user once, not twice", async () => {
    const a = await propose("price_out_of_range", "sales_manager", 700); // approver and manager are both the sales manager
    clock.set(at(700 + 48));
    await runAlerts(ctx());
    expect(named(await alertsOf(a))).toEqual(["manager"]);
    const m = await propose("aml_report", "mlro", 800);
    clock.set(at(800 + 24));
    await runAlerts(ctx());
    expect(named(await alertsOf(m))).toEqual(["mlro"]);
  });

  test("thresholds come from settings: an admin sets hours per gate, versioned; the new value is used", async () => {
    const before = await getAlertSettings(ctx(), users.admin!);
    const kyc = before.find((x) => x.key === "kyc_review")!;
    expect(kyc).toMatchObject({ hours: 24, isDefault: true, version: 0 });
    // an admin sees the three compliance gates as one entry, never by name
    expect(before.map((x) => x.key)).toContain("compliance_review");
    expect(JSON.stringify(before)).not.toMatch(/aml_|edd_signoff|aml/i);
    const r = await setAlertSettings(ctx(), users.admin!, { kyc_review: 6, compliance_review: 4 });
    expect(r.changed).toBe(2);
    const after = await getAlertSettings(ctx(), users.admin!);
    expect(after.find((x) => x.key === "kyc_review")).toMatchObject({ hours: 6, isDefault: false, version: 1 });
    expect(after.find((x) => x.key === "compliance_review")).toMatchObject({ hours: 4, isDefault: false });
    const rows = await database.db.select().from(alertSettings);
    expect(
      rows.filter((x) => ["aml_flag", "aml_report", "edd_signoff"].includes(x.gate)).map((x) => x.thresholdHours),
    ).toEqual([4, 4, 4]);
    // the same value again writes nothing; a new value is version 2
    expect((await setAlertSettings(ctx(), users.admin!, { kyc_review: 6 })).changed).toBe(0);
    expect((await setAlertSettings(ctx(), users.admin!, { kyc_review: 8 })).changed).toBe(1);
    expect(
      (await database.db.select().from(alertSettings).where(eq(alertSettings.gate, "kyc_review")))
        .map((x) => x.version)
        .toSorted(),
    ).toEqual([1, 2]);
    expect((await database.db.select().from(dealEvents).where(eq(dealEvents.type, "ALERT_SETTINGS_SET"))).length).toBe(
      2 + 0,
    );
    // the threshold in force is used: kyc_review now alerts at 8 hours, not 24
    const a = await propose("kyc_review", "sales_manager", 900);
    clock.set(at(900 + 7));
    await runAlerts(ctx());
    expect(await alertsOf(a)).toEqual([]);
    clock.set(at(900 + 8));
    await runAlerts(ctx());
    expect(named(await alertsOf(a))).toEqual(["manager"]);
    // and a compliance gate now alerts at 4
    const c = await propose("aml_flag", "compliance_officer", 1000);
    clock.set(at(1000 + 4));
    await runAlerts(ctx());
    expect(named(await alertsOf(c))).toEqual(["compliance"]);
  });

  test("only an admin changes settings (everyone else 403); a bad value, a compliance gate's own name or no gate is 422", async () => {
    for (const who of ["officer", "manager", "salesadmin", "legal", "finance", "compliance", "mlro"] as const)
      expect(((await setAlertSettings(ctx(), users[who]!, { kyc_review: 5 }).catch((e) => e)) as any).status).toBe(403);
    for (const bad of [
      { kyc_review: 0 },
      { kyc_review: 721 },
      { kyc_review: 1.5 },
      { aml_flag: 5 },
      { nope: 5 },
      {},
      null,
      "x",
    ])
      expect(((await setAlertSettings(ctx(), users.admin!, bad).catch((e) => e)) as any).status).toBe(422);
    for (const who of ["officer", "manager", "salesadmin", "legal", "finance"] as const)
      expect(((await getAlertSettings(ctx(), users[who]!).catch((e) => e)) as any).status).toBe(403);
    expect((await getAlertSettings(ctx(), users.mlro!)).length).toBeGreaterThan(0);
  });

  test("in-app: you see only your own, newest first; reading marks one once; another user's alert is a 404", async () => {
    const mine = await listAlerts(ctx(), users.legal!);
    expect(mine.items.length).toBeGreaterThan(1);
    expect(mine.unread).toBe(mine.items.filter((i) => !i.readAt).length);
    const times = mine.items.map((i) => i.createdAt);
    expect(times).toEqual(times.toSorted().toReversed());
    const first = mine.items[0]!;
    expect(((await markAlertRead(ctx(), users.officer!, first.id).catch((e) => e)) as any).status).toBe(404);
    expect(((await markAlertRead(ctx(), users.legal!, newId()).catch((e) => e)) as any).status).toBe(404);
    await markAlertRead(ctx(), users.legal!, first.id);
    const readAt = (await database.db.select().from(alerts).where(eq(alerts.id, first.id)))[0]!.readAt!;
    expect(readAt.getTime()).toBe(clock.now().getTime());
    clock.set(new Date(clock.now().getTime() + 3_600_000));
    await markAlertRead(ctx(), users.legal!, first.id); // again: no change, no error
    expect((await database.db.select().from(alerts).where(eq(alerts.id, first.id)))[0]!.readAt!.getTime()).toBe(
      readAt.getTime(),
    );
    const after = await listAlerts(ctx(), users.legal!);
    expect(after.unread).toBe(mine.unread - 1);
  });

  test("a compliance alert never reaches a non-compliance reader even if a row were somehow theirs", async () => {
    const a = await propose("aml_flag", "compliance_officer", 1100);
    await database.db.insert(alerts).values({
      id: newId(),
      approvalId: a,
      level: "approver",
      userId: users.officer!.id,
      waitedHours: 12,
      createdAt: at(1100),
    });
    const mine = await listAlerts(ctx(), users.officer!);
    expect(JSON.stringify(mine)).not.toContain("compliance review");
    expect(mine.items.every((i) => !/compliance/i.test(i.text))).toBe(true);
  });

  test("the hourly job: queued at start once per hour bucket and runs the handler", async () => {
    expect(alertsKey(new Date("2026-11-19T06:42:00Z"))).toBe("alerts:2026-11-19T06");
    let runs = 0;
    const jobs = await startJobs(createBoss(url!), clock, { alerts: async () => void runs++ });
    try {
      for (let i = 0; i < 40 && runs === 0; i++) await Bun.sleep(100);
      await Bun.sleep(300);
      expect(runs).toBe(1);
      const scheduled = await jobs.boss.getSchedules();
      expect(scheduled.some((s: any) => s.name === ALERTS_JOB && s.cron === "0 * * * *")).toBe(true);
      // the same hour's key queues no second job
      await jobs.boss.send(ALERTS_JOB, {}, { singletonKey: alertsKey(clock.now()) });
      await Bun.sleep(400);
      expect(runs).toBe(1);
    } finally {
      await jobs.stop();
    }
  });

  test("a mail error in an alert is logged scrubbed: no address, no ID or account number (rule 8)", async () => {
    const a = await propose("agreement_approval", "legal", 0);
    clock.set(at(25));
    const boom = {
      get mailer(): never {
        throw new Error(
          "smtp down for legal@spa-demo.test, Emirates ID 784-1990-1234567-1, IBAN AE070331234567890123456",
        );
      },
      webBaseUrl: "https://spa.example.test",
    };
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      await runAlerts({ database, clock, facts: failClosedFacts, mail: boom as never });
      expect(spy).toHaveBeenCalled();
      const text = JSON.stringify(spy.mock.calls);
      expect(text).not.toContain("legal@spa-demo.test");
      expect(text).not.toContain("1234567");
      expect(text).not.toContain("AE070331234567890123456");
    } finally {
      spy.mockRestore();
    }
    expect((await alertsOf(a)).length).toBeGreaterThan(0);
  });
});
