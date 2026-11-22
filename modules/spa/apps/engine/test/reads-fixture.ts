import { newId } from "@platform/kernel";
import { FixedClock } from "@platform/kernel/clock";
import {
  amlCases,
  amlHits,
  dealEvents,
  deals,
  helperRuns,
  kycRuns,
  parties,
  type SpaDatabase,
  withSpaTx,
} from "@spa/db";
import { eq } from "drizzle-orm";
import { proposeApproval } from "../src/manager/approvals.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { openTask } from "../src/manager/tasks.ts";
import { dealInDraft, party, seedUsers, type U } from "./prepare-fixtures.ts";

export const NOW = new Date("2026-11-19T06:00:00Z");
export const PASSPORT = "N1234567";
export const EID = "784-1990-1234567-1";
export const PHONE = "+971 50 123 4567";
/** Words a sales role must never read anywhere in a deal's responses (S50, S57). */
export const COMPLIANCE_WORDS = /aml|screening|sanction|\bpep\b|\bedd\b|edd_|\brisk\b|not_screened/i;

export const ctxOf = (database: SpaDatabase, now = NOW): SpaContext => ({
  database,
  clock: new FixedClock(now),
  facts: failClosedFacts,
});

export interface World {
  users: Record<string, U>;
  ctx: SpaContext;
  /** A resale on hold with an open compliance review, a pending kyc_review and hidden compliance rows. */
  held: { dealId: string; buyer: string; seller: string; aml: string; kyc: string };
  /** A primary deal in `AGREEMENT_DRAFT`, nothing flagged. */
  plain: { dealId: string; buyer: string };
}

/** Builds a database of fictional deals, one with an open compliance review and AML detail in every table it can sit in. */
export async function buildWorld(database: SpaDatabase): Promise<World> {
  const users = await seedUsers(database);
  const ctx = ctxOf(database);
  const h = await dealInDraft(ctx, database, { type: "resale_ready", buyers: ["Buyer One"], sellers: ["Seller One"] });
  const buyer = h.buyerIds[0]!;
  await database.db
    .update(parties)
    .set({ passportNo: PASSPORT, emiratesIdNo: EID, phone: PHONE })
    .where(eq(parties.id, buyer));
  await database.db.update(deals).set({ state: "AML_HOLD" }).where(eq(deals.id, h.dealId));
  const dealId = h.dealId;
  const amlApproval = await proposeApproval(ctx, {
    gate: "aml_flag",
    entity: { kind: "deal", id: dealId },
    dedupeKey: `${dealId}:aml_flag:1`,
    title: "Compliance review",
    proposal: { rule: "sanctions", score: 0.97, outcomeHint: "stop_and_report" },
    reasons: ["sanctions match on the buyer"],
    proposedBy: "system:aml-screening",
  });
  const kycApproval = await proposeApproval(ctx, {
    gate: "kyc_review",
    entity: { kind: "deal", id: dealId },
    dedupeKey: `${dealId}:kyc_review:1`,
    title: `Passport ${PASSPORT} is unreadable`,
    proposal: { partyId: buyer },
    reasons: [`call the buyer on ${PHONE}`],
    proposedBy: "system:kyc",
  });
  await withSpaTx(ctx.database, async (tx) => {
    const compliance = `user:${users.compliance!.id}` as const;
    const at = (s: string) => new Date(s);
    const ev = (type: string, o: { actor?: string; to?: string; payload?: Record<string, unknown>; at?: Date } = {}) =>
      tx.db.insert(dealEvents).values({
        id: newId(),
        entityKind: "deal",
        entityId: dealId,
        type,
        actor: o.actor ?? "system",
        toState: o.to ?? null,
        payload: o.payload ?? {},
        at: o.at ?? at("2026-11-19T05:00:00Z"),
      });
    await ev("COMPLIANCE_REVIEW_RECORDED", {
      actor: compliance,
      to: "AML_HOLD",
      payload: { machineEvent: "compliance_review", approvalId: amlApproval.id },
      at: at("2026-11-19T05:10:00Z"),
    });
    await ev("AML_POLICY_PUBLISHED", { actor: compliance, at: at("2026-11-19T05:20:00Z") });
    await ev("FUTURE_EVENT", { at: at("2026-11-19T05:30:00Z") });
    await openTask(ctx, tx, {
      dealId,
      kind: "confirm_amount",
      role: "sales_officer",
      title: "Confirm the bank amount",
      dedupeKey: `${dealId}:task:officer`,
    });
    await openTask(ctx, tx, {
      dealId,
      kind: "payment_review",
      role: "compliance_officer",
      title: "Look at this payment",
      dedupeKey: `${dealId}:task:compliance`,
    });
    const [c] = await tx.db
      .insert(amlCases)
      .values({
        id: newId(),
        dealId,
        status: "open",
        approvalId: amlApproval.id,
        summary: "Sanctions match for the buyer (screening list v1)",
        instructionLike: false,
        openedAt: NOW,
      })
      .returning({ id: amlCases.id });
    await tx.db.insert(amlHits).values({
      id: newId(),
      caseId: c!.id,
      partyId: buyer,
      subjectKey: `party:${buyer}`,
      rule: "sanctions",
      severity: "flag",
      detail: "sanctions list match",
      listVersion: "v1",
      createdAt: NOW,
    });
    for (const [visibility, helper] of [
      ["compliance", "aml"],
      ["staff", "kyc"],
    ] as const)
      await tx.db.insert(helperRuns).values({
        id: newId(),
        helper,
        dealId,
        entityKind: "deal",
        entityId: dealId,
        status: "ok",
        result: { note: visibility === "compliance" ? "sanctions hit on the buyer" : "documents read" },
        reasons: [],
        rulesVersion: "dubai-sales-2026-01",
        visibility,
        createdAt: NOW,
      });
    await tx.db.insert(kycRuns).values({
      id: newId(),
      dealId,
      partyId: buyer,
      role: "buyer_person",
      configScope: "buyer",
      configVersion: 1,
      status: "review",
      flags: [],
      identity: { passportNo: PASSPORT },
      answers: {},
      docsHash: "h1",
      createdAt: NOW,
    });
  });
  const p = await dealInDraft(ctx, database, { type: "primary_offplan", buyers: ["Buyer Two"] });
  void party;
  return {
    users,
    ctx,
    held: { dealId, buyer, seller: h.sellerIds[0]!, aml: amlApproval.id, kyc: kycApproval.id },
    plain: { dealId: p.dealId, buyer: p.buyerIds[0]! },
  };
}
