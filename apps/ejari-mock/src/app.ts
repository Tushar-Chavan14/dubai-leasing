import { type Clock, EjariPayload, formatAed } from "@leasing/core";
import { Hono } from "hono";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { certificatePdf } from "./certificate.ts";
import { reset } from "./db.ts";
import { registrationRejections } from "./rules.ts";
import { page } from "./ui.ts";

export interface MockOptions {
  pool: Pool;
  clock: Clock;
  /** 0..1: share of requests answered "temporarily unavailable" (503), to show retries in demos. */
  failureRate?: number;
  random?: () => number;
  demoMode?: boolean;
}

const Submit = z.object({ requestId: z.string().min(8).max(100), contract: EjariPayload });

async function inTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

type Answer =
  | { http: 201; body: { status: "issued"; ejariNo: string; issuedOn: string } }
  | { http: 422; body: { status: "rejected"; reasons: unknown[] } };

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
      await o.pool.query(
        "INSERT INTO ejari_mock.submissions (request_id, kind, outcome, payload) VALUES (NULL, $1, 'unavailable', $2)",
        [kind, p],
      );
      return null;
    }
    return inTx(o.pool, async (c) => {
      // One registration decision per property at a time, so two requests can't both pass the overlap check.
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [p.dldPropertyNo]);
      const prev = await c.query<{
        outcome: string;
        ejari_no: string | null;
        reasons: unknown[];
        issued_on: string | null;
      }>(
        `SELECT s.outcome, s.ejari_no, s.reasons, r.issued_on::text AS issued_on
           FROM ejari_mock.submissions s LEFT JOIN ejari_mock.registrations r ON r.ejari_no = s.ejari_no
          WHERE s.request_id = $1`,
        [requestId],
      );
      const replay = prev.rows[0];
      if (replay) {
        return replay.outcome === "issued"
          ? { http: 201, body: { status: "issued", ejariNo: replay.ejari_no!, issuedOn: replay.issued_on! } }
          : { http: 422, body: { status: "rejected", reasons: replay.reasons } };
      }
      const property = (
        await c.query<{ unit_no: string; makani_no: string; usage: string; owner_name: string }>(
          "SELECT unit_no, makani_no, usage, owner_name FROM ejari_mock.properties WHERE dld_property_no = $1",
          [p.dldPropertyNo],
        )
      ).rows[0];
      const person = (
        await c.query<{ id_type: string; name_en: string; expires_on: string }>(
          "SELECT id_type, name_en, expires_on::text AS expires_on FROM ejari_mock.icp_people WHERE id_no = $1",
          [p.tenantIdNo],
        )
      ).rows[0];
      const overlap = (
        await c.query<{ ejari_no: string }>(
          `SELECT ejari_no FROM ejari_mock.registrations
            WHERE dld_property_no = $1 AND state = 'active' AND start_on <= $3::date AND end_on >= $2::date
              AND ($4::text IS NULL OR ejari_no <> $4)
            LIMIT 1`,
          [p.dldPropertyNo, p.startOn, p.endOn, renewOf],
        )
      ).rows[0];
      const forced = rejectNext;
      rejectNext = false;
      const found = registrationRejections(p, {
        property: property
          ? {
              unitNo: property.unit_no,
              makaniNo: property.makani_no,
              usage: property.usage,
              ownerName: property.owner_name,
            }
          : null,
        person: person ? { idType: person.id_type, nameEn: person.name_en, expiresOn: person.expires_on } : null,
        overlapping: overlap?.ejari_no ?? null,
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
        await c.query(
          "INSERT INTO ejari_mock.submissions (request_id, kind, outcome, reasons, payload) VALUES ($1, $2, 'rejected', $3, $4)",
          [requestId, kind, JSON.stringify(reasons), p],
        );
        return { http: 422, body: { status: "rejected", reasons } };
      }
      const today = o.clock.today();
      const seq = (await c.query<{ n: string }>("SELECT nextval('ejari_mock.ejari_seq')::text AS n")).rows[0]!.n;
      const ejariNo = `SIM-${today.slice(0, 4)}-${seq.padStart(7, "0")}`;
      await c.query(
        `INSERT INTO ejari_mock.registrations
           (ejari_no, dld_property_no, tenant_id_no, tenant_name, landlord_name, start_on, end_on, annual_rent_fils, payload, issued_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          ejariNo,
          p.dldPropertyNo,
          p.tenantIdNo,
          p.tenantNameEn,
          p.landlordNameEn,
          p.startOn,
          p.endOn,
          p.annualRentFils,
          p,
          today,
        ],
      );
      if (renewOf) {
        await c.query(
          "UPDATE ejari_mock.registrations SET state = 'cancelled', cancelled_on = $2, cancel_reason = 'renewed' WHERE ejari_no = $1",
          [renewOf, today],
        );
      }
      await c.query(
        "INSERT INTO ejari_mock.submissions (request_id, kind, outcome, ejari_no, payload) VALUES ($1, $2, 'issued', $3, $4)",
        [requestId, kind, ejariNo, p],
      );
      return { http: 201, body: { status: "issued", ejariNo, issuedOn: today } };
    });
  }

  app.post("/api/v1/registrations", (c) => reply(c, async () => submit("register", await c.req.json(), null)));

  app.post("/api/v1/registrations/:no/renew", async (c) => {
    const no = c.req.param("no");
    const r = await o.pool.query("SELECT state FROM ejari_mock.registrations WHERE ejari_no = $1", [no]);
    if (r.rows[0]?.state !== "active") return c.json({ error: "no active registration with this number" }, 404);
    return reply(c, async () => submit("renew", await c.req.json(), no));
  });

  app.post("/api/v1/registrations/:no/cancel", async (c) => {
    const body = z.object({ reason: z.string().min(2).max(300) }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "a reason is required" }, 400);
    const r = await o.pool.query(
      "UPDATE ejari_mock.registrations SET state = 'cancelled', cancelled_on = $2, cancel_reason = $3 WHERE ejari_no = $1 AND state = 'active'",
      [c.req.param("no"), o.clock.today(), body.data.reason],
    );
    return r.rowCount ? c.json({ ok: true }) : c.json({ error: "no active registration with this number" }, 404);
  });

  app.get("/api/v1/registrations/:no", async (c) => {
    const r = await o.pool.query(
      "SELECT ejari_no, state, start_on::text, end_on::text, issued_on::text FROM ejari_mock.registrations WHERE ejari_no = $1",
      [c.req.param("no")],
    );
    const row = r.rows[0];
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({
      ejariNo: row.ejari_no,
      state: row.state,
      startOn: row.start_on,
      endOn: row.end_on,
      issuedOn: row.issued_on,
    });
  });

  app.get("/api/v1/registrations/:no/certificate.pdf", async (c) => {
    const r = await o.pool.query(
      `SELECT ejari_no, dld_property_no, tenant_name, landlord_name, start_on::text, end_on::text, annual_rent_fils::text,
              issued_on::text, payload FROM ejari_mock.registrations WHERE ejari_no = $1`,
      [c.req.param("no")],
    );
    const row = r.rows[0];
    if (!row) return c.json({ error: "not found" }, 404);
    const pdf = await certificatePdf({
      ejariNo: row.ejari_no,
      issuedOn: row.issued_on,
      dldPropertyNo: row.dld_property_no,
      unitNo: row.payload.unitNo,
      makaniNo: row.payload.makaniNo,
      tenantName: row.tenant_name,
      landlordName: row.landlord_name,
      startOn: row.start_on,
      endOn: row.end_on,
      annualRent: formatAed(Number(row.annual_rent_fils)),
    });
    return c.body(new Uint8Array(pdf), 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="simulated-ejari-${row.ejari_no}.pdf"`,
    });
  });

  app.post("/api/v1/demo/reject-next", (c) => {
    if (!o.demoMode) return c.json({ error: "only in demo mode" }, 403);
    rejectNext = true;
    return c.json({ ok: true, rejectNext });
  });

  app.post("/api/v1/demo/reset", async (c) => {
    if (!o.demoMode) return c.json({ error: "only in demo mode" }, 403);
    await reset(o.pool);
    return c.json({ ok: true });
  });

  app.get("/", async (c) => {
    const regs = await o.pool.query(
      `SELECT ejari_no, dld_property_no, tenant_name, start_on::text, end_on::text, state, issued_on::text
         FROM ejari_mock.registrations ORDER BY created_at DESC LIMIT 50`,
    );
    const subs = await o.pool.query(
      `SELECT kind, outcome, ejari_no, reasons, payload->>'dldPropertyNo' AS property, payload->>'tenantNameEn' AS tenant,
              received_at FROM ejari_mock.submissions ORDER BY id DESC LIMIT 50`,
    );
    return c.html(page(regs.rows, subs.rows));
  });

  return app;
}
