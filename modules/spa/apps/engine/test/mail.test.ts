import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { FakeMailer } from "@platform/adapters";
import { FixedClock, newId } from "@platform/kernel";
import { type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { signLinkMail } from "@spa/helpers";
import { failClosedFacts } from "../src/manager/facts.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { sendSpaMail } from "../src/manager/mail.ts";

const url = spaTestDatabaseUrl();
const sha = (d: string | Uint8Array) => createHash("sha256").update(d).digest("hex");

describe.skipIf(!url)("sendSpaMail (C28)", () => {
  let database: SpaDatabase;
  const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
  const mk = (mailer: FakeMailer): SpaContext => ({
    database,
    clock,
    facts: failClosedFacts,
    mail: { mailer, webBaseUrl: "https://spa.example.test" },
  });
  const rows = async () => (await database.pool.query("select * from outbound_messages order by created_at")).rows;
  const input = (entityId: string, o: { milestone?: string; to?: string } = {}) => ({
    entityKind: "signature",
    entityId,
    purpose: "link" as const,
    milestone: o.milestone ?? "link:1",
    to: o.to ?? "amal@example.test",
    parts: signLinkMail({
      name: "Amal",
      document: "MOU",
      property: "Unit 1",
      link: "https://spa.example.test/b/SECRETTOKEN/sign",
      expiresOn: "2026-12-03",
    }),
  });
  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await database?.close();
  });

  test("sends once and stores the evidence; the raw link is only in the email", async () => {
    const mailer = new FakeMailer();
    const id = newId();
    const pdf = new Uint8Array([1, 2, 3]);
    const r = await sendSpaMail(mk(mailer), {
      ...input(id),
      attachments: [{ filename: "a.pdf", content: pdf, contentType: "application/pdf" }],
    });
    expect(r.status).toBe("sent");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.text).toContain("SECRETTOKEN");
    const [row] = (await rows()).filter((x) => x.entity_id === id);
    expect(row.status).toBe("sent");
    expect(row.body_sha256).toBe(sha(`${mailer.sent[0]!.text}\n${mailer.sent[0]!.html}`));
    expect(row.attachment_sha256s).toEqual([sha(pdf)]);
    expect(row.message_id).toBe("<fake-1@test>");
    expect(row.smtp_response).toBe("250 2.0.0 OK fake");
    expect(row.sent_at.toISOString()).toBe("2026-11-19T06:00:00.000Z");
    expect(row.template).toBe("sign_link");
    expect(row.template_version).toBe(1);
    expect(JSON.stringify(await rows())).not.toContain("SECRETTOKEN");
  });

  describe("a claim that never finished (S54 amendment)", () => {
    const seed = async (
      entityId: string,
      o: { status: string; claimedMinutesAgo: number | null; createdMinutesAgo?: number },
    ) => {
      const at = (min: number) => new Date(clock.now().getTime() - min * 60_000);
      const parts = input(entityId).parts;
      await database.pool.query(
        `insert into outbound_messages (id, entity_kind, entity_id, purpose, milestone, to_email, intended_to, template, template_version, subject, status, created_at, claimed_at)
         values ($1, 'signature', $2, 'link', 'link:1', 'amal@example.test', 'amal@example.test', $3, $4, $5, $6, $7, $8)`,
        [
          newId(),
          entityId,
          parts.template,
          parts.version,
          parts.subject,
          o.status,
          at(o.createdMinutesAgo ?? 600),
          o.claimedMinutesAgo === null ? null : at(o.claimedMinutesAgo),
        ],
      );
    };

    test("a sending row older than the timeout is claimed again and sent; a recent one is left alone", async () => {
      const mailer = new FakeMailer();
      const stale = newId();
      await seed(stale, { status: "sending", claimedMinutesAgo: 16 });
      expect((await sendSpaMail(mk(mailer), input(stale))).status).toBe("sent");
      expect(mailer.sent).toHaveLength(1);
      const fresh = newId();
      await seed(fresh, { status: "sending", claimedMinutesAgo: 5 });
      expect((await sendSpaMail(mk(mailer), input(fresh))).status).toBe("skipped");
      expect(mailer.sent).toHaveLength(1);
      // The claim's own clock, not the row's age: an old row whose retry was just claimed is not stale.
      const retried = newId();
      await seed(retried, { status: "sending", claimedMinutesAgo: 1, createdMinutesAgo: 900 });
      expect((await sendSpaMail(mk(mailer), input(retried))).status).toBe("skipped");
      // No claim time at all (a row from before the column): the row's age decides.
      const old = newId();
      await seed(old, { status: "sending", claimedMinutesAgo: null, createdMinutesAgo: 60 });
      expect((await sendSpaMail(mk(mailer), input(old))).status).toBe("sent");
    });

    test("a sent row is final however old it is", async () => {
      const mailer = new FakeMailer();
      const id = newId();
      await seed(id, { status: "sent", claimedMinutesAgo: 5000 });
      expect((await sendSpaMail(mk(mailer), input(id))).status).toBe("skipped");
      expect(mailer.sent).toHaveLength(0);
    });

    test("two workers re-claiming one stale row send once", async () => {
      const mailer = new FakeMailer();
      const id = newId();
      await seed(id, { status: "sending", claimedMinutesAgo: 30 });
      const r = await Promise.all([sendSpaMail(mk(mailer), input(id)), sendSpaMail(mk(mailer), input(id))]);
      expect(r.map((x) => x.status).toSorted()).toEqual(["sent", "skipped"]);
      expect(mailer.sent).toHaveLength(1);
    });
  });

  test("a mail already sent is never sent twice", async () => {
    const mailer = new FakeMailer();
    const id = newId();
    expect((await sendSpaMail(mk(mailer), input(id))).status).toBe("sent");
    expect((await sendSpaMail(mk(mailer), input(id))).status).toBe("skipped");
    expect(mailer.sent).toHaveLength(1);
    expect((await sendSpaMail(mk(mailer), input(id, { milestone: "link:2" }))).status).toBe("sent");
    expect(mailer.sent).toHaveLength(2);
  });

  test("a failed send is recorded with a masked error and can be sent again", async () => {
    const mailer = new FakeMailer();
    const id = newId();
    mailer.failNext = new Error("connect failed for amal@example.test");
    const r = await sendSpaMail(mk(mailer), input(id));
    expect(r.status).toBe("failed");
    const [row] = (await rows()).filter((x) => x.entity_id === id);
    expect(row.status).toBe("failed");
    expect(row.error).not.toContain("amal@example.test");
    expect((await sendSpaMail(mk(mailer), input(id))).status).toBe("sent");
    expect(mailer.sent).toHaveLength(1);
  });

  test("a recipient the server rejects is a failure", async () => {
    const mailer = new FakeMailer();
    mailer.rejectNext = true;
    const id = newId();
    expect((await sendSpaMail(mk(mailer), input(id))).status).toBe("failed");
    const [row] = (await rows()).filter((x) => x.entity_id === id);
    expect(row.smtp_response).toContain("550");
  });

  test("a demo redirect keeps who it was meant for", async () => {
    const mailer = new FakeMailer("demo-inbox@example.test");
    const id = newId();
    await sendSpaMail(mk(mailer), input(id));
    const [row] = (await rows()).filter((x) => x.entity_id === id);
    expect(row.to_email).toBe("demo-inbox@example.test");
    expect(row.intended_to).toBe("amal@example.test");
  });

  test("without a mail configuration it refuses (503) and stores nothing", async () => {
    const id = newId();
    const e = await sendSpaMail({ database, clock, facts: failClosedFacts }, input(id)).catch((x) => x);
    expect(e.status).toBe(503);
    expect(e.code).toBe("mail_unavailable");
    expect((await rows()).filter((x) => x.entity_id === id)).toHaveLength(0);
  });
});
