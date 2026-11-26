import { maybeUnavailable, type RegistryAnswer, replayByRequestId, replyWithAnswer } from "@platform/adapters";
import { addDays, type Clock, formatAed } from "@platform/kernel";
import {
  OqoodRegisterPayload,
  OqoodTransferPayload,
  type RegistryKind,
  type RegistryRejection,
  TrusteeTransferPayload,
} from "@spa/core";
import { and, desc, eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { certificatePdf } from "./certificate.ts";
import { type MockDb, reset } from "./db.ts";
import { type DeedRecord, type PersonRecord, registerRejections, transferRejections } from "./rules.ts";
import { personRecords, registrations, submissions, titleDeeds, trusteeBookings, unitRecords } from "./schema.ts";
import { page } from "./ui.ts";

export interface MockOptions {
  db: MockDb;
  /** The mock's own clock (a mock service, not domain code): the issue date and the trustee appointment come from it. */
  clock: Clock;
  /** 0..1: share of requests answered "temporarily unavailable" (503), to show retries in demos. */
  failureRate?: number;
  random?: () => number;
  demoMode?: boolean;
}

const RequestOf = <T extends z.ZodType>(payload: T) => z.object({ requestId: z.string().min(8).max(100), payload });

type Tx = Parameters<Parameters<MockDb["transaction"]>[0]>[0];

/** The trustee appointment: seven days after the booking (a simulated figure, not a registry rule). */
const APPOINTMENT_DAYS = 7;

/** Every JSON body of this service says it is simulated (AGENTS rule 9). */
const sim = (b: unknown): Record<string, unknown> => ({ ...(b as Record<string, unknown>), simulated: true });
const simJson = (c: Context) => (b: unknown, s: 201 | 400 | 422 | 503) => c.json(sim(b), s);

async function personsOf(tx: Tx, idNos: string[]): Promise<Map<string, PersonRecord>> {
  const out = new Map<string, PersonRecord>();
  for (const idNo of idNos) {
    const [p] = await tx.select().from(personRecords).where(eq(personRecords.idNo, idNo));
    if (p) out.set(idNo, { nameEn: p.nameEn, expiresOn: p.expiresOn });
  }
  return out;
}
const nextNo = async (tx: Tx, seq: "oqd_seq" | "trf_seq" | "td_seq", prefix: "OQD" | "TRF" | "TD", today: string) => {
  const n = (await tx.execute<{ seq: string }>(sql`SELECT nextval(${`oqood_mock.${seq}`}::regclass)::text AS seq`))
    .rows[0]!.seq;
  return `SIM-${prefix}-${today.slice(0, 4)}-${n.padStart(7, "0")}`;
};
const forcedMismatch = (): RegistryRejection => ({
  code: "BUYER_NAME_MISMATCH",
  field: null,
  message: "A buyer's name does not match the name on record (simulated rejection from the demo console).",
});

/**
 * Simulated Oqood and trustee registry (demo). Register a primary unit, transfer an off-plan resale, book a trustee
 * transfer, read a record and its certificate, over HTTP, with the checks a registry makes. Every request is kept in
 * `oqood_mock.submissions`; a repeated `requestId` of the same kind gets the first answer again, so a retry never
 * registers twice (S53).
 */
export function createOqoodMock(o: MockOptions): Hono {
  const app = new Hono();
  const random = o.random ?? Math.random;
  const failureRate = o.failureRate ?? 0;
  /** Demo console: the next new request is rejected for a buyer name mismatch, once. */
  let rejectNext = false;

  app.get("/health", (c) => c.json({ ok: true, simulated: true }));

  app.get("/", async (c) => {
    const regs = await o.db.select().from(registrations).orderBy(desc(registrations.createdAt)).limit(50);
    const subs = await o.db.select().from(submissions).orderBy(desc(submissions.id)).limit(50);
    return c.html(page(regs, subs));
  });

  app.post("/api/v1/demo/reset", async (c) => {
    if (!o.demoMode) return c.json(sim({ error: "only in demo mode" }), 403);
    await reset(o.db);
    return c.json(sim({ ok: true }));
  });
  app.post("/api/v1/demo/reject-next", async (c) => {
    if (!o.demoMode) return c.json(sim({ error: "only in demo mode" }), 403);
    rejectNext = true;
    return c.json(sim({ ok: true, rejectNext: true }));
  });

  /** One submission, start to finish. Returns null for an outage (the caller answers 503). */
  async function submit(
    kind: RegistryKind,
    requestId: string,
    p: OqoodRegisterPayload | OqoodTransferPayload | TrusteeTransferPayload,
  ): Promise<RegistryAnswer | null> {
    if (maybeUnavailable({ failureRate, random })) {
      await o.db.insert(submissions).values({ requestId: null, kind, outcome: "unavailable", unitNo: p.unitNo });
      return null;
    }
    return o.db.transaction(async (tx) => {
      // One decision per unit at a time, so two requests can't both register it.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`oqood:${p.unitNo}`}))`);
      const replayed = await replayByRequestId(
        async () =>
          (
            await tx
              .select({
                outcome: submissions.outcome,
                registryNo: submissions.registryNo,
                reasons: submissions.reasons,
                issuedOn: registrations.issuedOn,
              })
              .from(submissions)
              .leftJoin(registrations, eq(registrations.registryNo, submissions.registryNo))
              .where(and(eq(submissions.requestId, requestId), eq(submissions.kind, kind)))
          )[0],
        (r): RegistryAnswer =>
          r.outcome === "issued"
            ? { http: 201, body: sim({ status: "issued", no: r.registryNo!, issuedOn: r.issuedOn! }) }
            : { http: 422, body: sim({ status: "rejected", reasons: r.reasons }) },
      );
      if (replayed) return replayed;

      const today = o.clock.today();
      const [unit] = await tx.select().from(unitRecords).where(eq(unitRecords.unitNo, p.unitNo));
      const persons = await personsOf(
        tx,
        p.buyers.map((b) => b.idNo),
      );
      const [deed] =
        kind === "oqood_register"
          ? []
          : await tx
              .select()
              .from(titleDeeds)
              .where(and(eq(titleDeeds.unitNo, p.unitNo), eq(titleDeeds.superseded, false)));
      const found =
        kind === "oqood_register"
          ? registerRejections(p as OqoodRegisterPayload, { unit: unit ?? null, persons, today })
          : transferRejections(p as OqoodTransferPayload, {
              unit: unit ?? null,
              deed: deed ? ({ titleDeedNo: deed.titleDeedNo, owners: deed.owners } satisfies DeedRecord) : null,
              persons,
              today,
            });
      const forced = rejectNext;
      rejectNext = false;
      const reasons = forced ? [...found, forcedMismatch()] : found;
      if (reasons.length) {
        await tx.insert(submissions).values({ requestId, kind, outcome: "rejected", reasons, unitNo: p.unitNo });
        return { http: 422, body: sim({ status: "rejected", reasons }) };
      }

      const buyers = p.buyers.map((b) => b.name);
      const sellers = "sellers" in p ? p.sellers.map((s) => s.name) : [p.developerName];
      const registryNo =
        kind === "oqood_register"
          ? await nextNo(tx, "oqd_seq", "OQD", today)
          : await nextNo(tx, "trf_seq", "TRF", today);
      await tx.insert(registrations).values({
        registryNo,
        kind,
        unitNo: p.unitNo,
        buyers,
        sellers,
        priceFils: p.priceFils,
        issuedOn: today,
      });
      if (kind === "oqood_register") {
        await tx.update(unitRecords).set({ state: "registered" }).where(eq(unitRecords.unitNo, p.unitNo));
        await tx.insert(titleDeeds).values({ titleDeedNo: registryNo, unitNo: p.unitNo, owners: buyers });
      } else {
        // The old record is retired and a new one is issued to the buyers.
        await tx.update(titleDeeds).set({ superseded: true }).where(eq(titleDeeds.unitNo, p.unitNo));
        if (kind === "trustee_transfer") {
          const newTitleDeedNo = await nextNo(tx, "td_seq", "TD", today);
          await tx.insert(titleDeeds).values({ titleDeedNo: newTitleDeedNo, unitNo: p.unitNo, owners: buyers });
          await tx.insert(trusteeBookings).values({
            bookingNo: registryNo,
            newTitleDeedNo,
            appointmentOn: addDays(today, APPOINTMENT_DAYS),
          });
        } else {
          await tx.insert(titleDeeds).values({ titleDeedNo: registryNo, unitNo: p.unitNo, owners: buyers });
        }
      }
      await tx.insert(submissions).values({ requestId, kind, outcome: "issued", registryNo, unitNo: p.unitNo });
      return { http: 201, body: sim({ status: "issued", no: registryNo, issuedOn: today }) };
    });
  }

  const route = (kind: RegistryKind, schema: z.ZodType<{ unitNo: string }>) => (c: Context) =>
    replyWithAnswer({ json: simJson(c) }, async () => {
      const { requestId, payload } = RequestOf(schema).parse(await c.req.json().catch(() => ({})));
      return submit(kind, requestId, payload as never);
    });
  app.post("/api/v1/oqood/register", route("oqood_register", OqoodRegisterPayload));
  app.post("/api/v1/oqood/transfer", route("oqood_transfer", OqoodTransferPayload));
  app.post("/api/v1/trustee/transfers", route("trustee_transfer", TrusteeTransferPayload));

  app.get("/api/v1/oqood/:no", async (c) => {
    const [r] = await o.db
      .select()
      .from(registrations)
      .where(eq(registrations.registryNo, c.req.param("no")));
    if (!r) return c.json(sim({ error: "not found" }), 404);
    return c.json(sim({ no: r.registryNo, kind: r.kind, state: r.state, unitNo: r.unitNo, issuedOn: r.issuedOn }));
  });

  app.get("/api/v1/oqood/:no/certificate.pdf", async (c) => {
    const [r] = await o.db
      .select()
      .from(registrations)
      .where(eq(registrations.registryNo, c.req.param("no")));
    if (!r) return c.json(sim({ error: "not found" }), 404);
    const [booking] = await o.db.select().from(trusteeBookings).where(eq(trusteeBookings.bookingNo, r.registryNo));
    const pdf = await certificatePdf({
      kind: r.kind,
      registryNo: r.registryNo,
      issuedOn: r.issuedOn,
      unitNo: r.unitNo,
      buyers: r.buyers,
      sellers: r.kind === "oqood_register" ? [] : r.sellers,
      price: formatAed(r.priceFils),
      ...(booking ? { newTitleDeedNo: booking.newTitleDeedNo, appointmentOn: booking.appointmentOn } : {}),
    });
    return c.body(new Uint8Array(pdf), 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="simulated-${r.registryNo}.pdf"`,
    });
  });

  return app;
}
