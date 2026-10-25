import { type Clock, EjariPayload, type EjariRejection, formatAed } from "@leasing/core";
import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { certificatePdf } from "./certificate.ts";
import { type MockDb, reset } from "./db.ts";
import { icpPeople, properties, registrations, submissions } from "./schema.ts";
import { registrationRejections } from "./rules.ts";
import { page } from "./ui.ts";

export interface MockOptions {
  db: MockDb;
  clock: Clock;
  /** 0..1: share of requests answered "temporarily unavailable" (503), to show retries in demos. */
  failureRate?: number;
  random?: () => number;
  demoMode?: boolean;
}

const Submit = z.object({ requestId: z.string().min(8).max(100), contract: EjariPayload });

type Answer =
  | { http: 201; body: { status: "issued"; ejariNo: string; issuedOn: string } }
  | { http: 422; body: { status: "rejected"; reasons: EjariRejection[] } };

/** A submission's answer as HTTP: 201 issued, 422 rejected, 503 unavailable, 400 invalid. */
const reply = async (
  c: { json: (b: unknown, s: 201 | 400 | 422 | 503) => Response },
  run: () => Promise<Answer | null>,
) => {
  try {
    const a = await run();
    if (!a) return c.json({ error: "The service is temporarily unavailable. Try again later." }, 503);
    return c.json(a.body, a.http);
  } catch (e) {
    if (e instanceof z.ZodError)
      return c.json({ error: "invalid request", issues: e.issues.map((i) => i.message) }, 400);
    throw e;
  }
};

/**
 * Simulated Ejari (demo). Register, renew, cancel, status and a certificate, over HTTP, with the
 * checks a registry makes. Every request is kept in `ejari_mock.submissions`; a repeated
 * `requestId` gets the first answer again, so a retry never registers twice.
 */
export function createEjariMock(o: MockOptions): Hono {
  const app = new Hono();
  const random = o.random ?? Math.random;
  const failureRate = o.failureRate ?? 0;
  /** Demo console: the next new register/renew request is rejected for a name mismatch, once. */
  let rejectNext = false;

  app.get("/health", (c) => c.json({ ok: true, simulated: true }));

  async function submit(kind: "register" | "renew", body: unknown, renewOf: string | null): Promise<Answer | null> {
    const { requestId, contract: p } = Submit.parse(body);
    if (random() < failureRate) {
      await o.db.insert(submissions).values({ requestId: null, kind, outcome: "unavailable", payload: p });
      return null;
    }
    return o.db.transaction(async (tx) => {
      // One registration decision per property at a time, so two requests can't both pass the overlap check.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${p.dldPropertyNo}))`);
      const [replay] = await tx
        .select({
          outcome: submissions.outcome,
          ejariNo: submissions.ejariNo,
          reasons: submissions.reasons,
          issuedOn: registrations.issuedOn,
        })
        .from(submissions)
        .leftJoin(registrations, eq(registrations.ejariNo, submissions.ejariNo))
        .where(eq(submissions.requestId, requestId));
      if (replay) {
        return replay.outcome === "issued"
          ? { http: 201, body: { status: "issued", ejariNo: replay.ejariNo!, issuedOn: replay.issuedOn! } }
          : { http: 422, body: { status: "rejected", reasons: replay.reasons } };
      }
      const [property] = await tx.select().from(properties).where(eq(properties.dldPropertyNo, p.dldPropertyNo));
      const [person] = await tx.select().from(icpPeople).where(eq(icpPeople.idNo, p.tenantIdNo));
      const [overlap] = await tx
        .select({ ejariNo: registrations.ejariNo })
        .from(registrations)
        .where(
          and(
            eq(registrations.dldPropertyNo, p.dldPropertyNo),
            eq(registrations.state, "active"),
            lte(registrations.startOn, p.endOn),
            gte(registrations.endOn, p.startOn),
            renewOf ? ne(registrations.ejariNo, renewOf) : undefined,
          ),
        )
        .limit(1);
      const forced = rejectNext;
      rejectNext = false;
      const found = registrationRejections(p, {
        property: property
          ? {
              unitNo: property.unitNo,
              makaniNo: property.makaniNo,
              usage: property.usage,
              ownerName: property.ownerName,
            }
          : null,
        person: person ? { idType: person.idType, nameEn: person.nameEn, expiresOn: person.expiresOn } : null,
        overlapping: overlap?.ejariNo ?? null,
      });
      const reasons = forced
        ? [
            ...found,
            {
              code: "NAME_MISMATCH",
              field: null,
              message:
                "The tenant's name does not match the identity record (simulated rejection from the demo console).",
            },
          ]
        : found;
      if (reasons.length) {
        await tx.insert(submissions).values({ requestId, kind, outcome: "rejected", reasons, payload: p });
        return { http: 422, body: { status: "rejected", reasons } };
      }
      const today = o.clock.today();
      const seq = (await tx.execute<{ seq: string }>(sql`SELECT nextval('ejari_mock.ejari_seq')::text AS seq`)).rows[0]!
        .seq;
      const ejariNo = `SIM-${today.slice(0, 4)}-${seq.padStart(7, "0")}`;
      await tx.insert(registrations).values({
        ejariNo,
        dldPropertyNo: p.dldPropertyNo,
        tenantIdNo: p.tenantIdNo,
        tenantName: p.tenantNameEn,
        landlordName: p.landlordNameEn,
        startOn: p.startOn,
        endOn: p.endOn,
        annualRentFils: p.annualRentFils,
        payload: p,
        issuedOn: today,
      });
      if (renewOf) {
        await tx
          .update(registrations)
          .set({ state: "cancelled", cancelledOn: today, cancelReason: "renewed" })
          .where(eq(registrations.ejariNo, renewOf));
      }
      await tx.insert(submissions).values({ requestId, kind, outcome: "issued", ejariNo, payload: p });
      return { http: 201, body: { status: "issued", ejariNo, issuedOn: today } };
    });
  }

  app.post("/api/v1/registrations", (c) => reply(c, async () => submit("register", await c.req.json(), null)));

  app.post("/api/v1/registrations/:no/renew", async (c) => {
    const no = c.req.param("no");
    const [r] = await o.db
      .select({ state: registrations.state })
      .from(registrations)
      .where(eq(registrations.ejariNo, no));
    if (r?.state !== "active") return c.json({ error: "no active registration with this number" }, 404);
    return reply(c, async () => submit("renew", await c.req.json(), no));
  });

  app.post("/api/v1/registrations/:no/cancel", async (c) => {
    const body = z.object({ reason: z.string().min(2).max(300) }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "a reason is required" }, 400);
    const cancelled = await o.db
      .update(registrations)
      .set({ state: "cancelled", cancelledOn: o.clock.today(), cancelReason: body.data.reason })
      .where(and(eq(registrations.ejariNo, c.req.param("no")), eq(registrations.state, "active")))
      .returning({ ejariNo: registrations.ejariNo });
    return cancelled.length ? c.json({ ok: true }) : c.json({ error: "no active registration with this number" }, 404);
  });

  app.get("/api/v1/registrations/:no", async (c) => {
    const [row] = await o.db
      .select({
        ejariNo: registrations.ejariNo,
        state: registrations.state,
        startOn: registrations.startOn,
        endOn: registrations.endOn,
        issuedOn: registrations.issuedOn,
      })
      .from(registrations)
      .where(eq(registrations.ejariNo, c.req.param("no")));
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(row);
  });

  app.get("/api/v1/registrations/:no/certificate.pdf", async (c) => {
    const [row] = await o.db
      .select()
      .from(registrations)
      .where(eq(registrations.ejariNo, c.req.param("no")));
    if (!row) return c.json({ error: "not found" }, 404);
    // Seeded prior registrations carry no contract.
    const contract = "prior" in row.payload ? null : row.payload;
    const pdf = await certificatePdf({
      ejariNo: row.ejariNo,
      issuedOn: row.issuedOn,
      dldPropertyNo: row.dldPropertyNo,
      unitNo: contract?.unitNo ?? "",
      makaniNo: contract?.makaniNo ?? "",
      tenantName: row.tenantName,
      landlordName: row.landlordName,
      startOn: row.startOn,
      endOn: row.endOn,
      annualRent: formatAed(row.annualRentFils),
    });
    return c.body(new Uint8Array(pdf), 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="simulated-ejari-${row.ejariNo}.pdf"`,
    });
  });

  app.post("/api/v1/demo/reject-next", (c) => {
    if (!o.demoMode) return c.json({ error: "only in demo mode" }, 403);
    rejectNext = true;
    return c.json({ ok: true, rejectNext });
  });

  app.post("/api/v1/demo/reset", async (c) => {
    if (!o.demoMode) return c.json({ error: "only in demo mode" }, 403);
    await reset(o.db);
    return c.json({ ok: true });
  });

  app.get("/", async (c) => {
    const regs = await o.db.select().from(registrations).orderBy(desc(registrations.createdAt)).limit(50);
    const subs = await o.db.select().from(submissions).orderBy(desc(submissions.id)).limit(50);
    return c.html(page(regs, subs));
  });

  return app;
}
