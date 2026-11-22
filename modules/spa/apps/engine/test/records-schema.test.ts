import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { newId } from "@platform/kernel";
import {
  alertSettings,
  alerts,
  complianceReports,
  type SpaDatabase,
  spaApprovals,
  spaExports,
  retentionReviewItems,
  retentionReviews,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq, sql } from "drizzle-orm";
import { dealInDraft, seedUsers, type U } from "./prepare-fixtures.ts";
import { FixedClock } from "@platform/kernel";
import { failClosedFacts } from "../src/manager/facts.ts";

const url = spaTestDatabaseUrl();
const AT = new Date("2026-11-19T06:00:00Z");

describe.skipIf(!url)("records and alerts tables and their guards (C23, S62)", () => {
  let database: SpaDatabase;
  let users: Record<string, U>;
  let dealId: string;
  let approvalId: string;
  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    dealId = (
      await dealInDraft({ database, clock: new FixedClock(AT), facts: failClosedFacts }, database, {
        type: "resale_ready",
      })
    ).dealId;
    approvalId = newId();
    await database.db.insert(spaApprovals).values({
      id: approvalId,
      gate: "kyc_review",
      entityKind: "deal",
      entityId: dealId,
      dedupeKey: `${dealId}:kyc_review`,
      title: "t",
      proposal: {},
      approverRole: "sales_manager",
      proposedBy: "system",
      createdAt: AT,
    });
  });
  afterAll(async () => {
    await database?.close();
  });
  const refuses = async (p: Promise<unknown>, re: RegExp) => {
    let msg = "";
    await p.catch((e) => (msg = String(e?.cause?.message ?? e?.message ?? e)));
    expect(msg).toMatch(re);
  };

  test("exports: append-only; a case pack has a deal, a report has none; size and file count are positive", async () => {
    const id = newId();
    const row = {
      id,
      dealId,
      kind: "case_pack" as const,
      requestedBy: users.compliance!.id,
      requestedAt: AT,
      sha256: "a".repeat(64),
      sizeBytes: 10,
      storageKey: "aa/x.zip",
      fileCount: 3,
    };
    await database.db.insert(spaExports).values(row);
    await refuses(database.db.insert(spaExports).values({ ...row, id: newId(), dealId: null }), /exports_kind_deal/);
    await refuses(
      database.db.insert(spaExports).values({ ...row, id: newId(), kind: "monthly_report" }),
      /exports_kind_deal/,
    );
    await refuses(database.db.insert(spaExports).values({ ...row, id: newId(), sizeBytes: 0 }), /exports_size/);
    await refuses(database.db.update(spaExports).set({ fileCount: 9 }).where(eq(spaExports.id, id)), /append-only/);
    await refuses(database.db.delete(spaExports).where(eq(spaExports.id, id)), /append-only/);
    await refuses(database.db.execute(sql`truncate table exports`), /append-only/);
  });

  test("retention: a period is unique and well formed; status moves forward once; nothing is deleted", async () => {
    const id = newId();
    await database.db.insert(retentionReviews).values({
      id,
      period: "2026-11",
      retentionYears: 5,
      cutoffOn: "2021-11-19",
      createdAt: AT,
    });
    await refuses(
      database.db
        .insert(retentionReviews)
        .values({ id: newId(), period: "2026-11", retentionYears: 5, cutoffOn: "2021-11-19", createdAt: AT }),
      /duplicate|unique/,
    );
    await refuses(
      database.db
        .insert(retentionReviews)
        .values({ id: newId(), period: "2026-13", retentionYears: 5, cutoffOn: "2021-11-19", createdAt: AT }),
      /retention_reviews_period/,
    );
    await database.db.insert(retentionReviewItems).values({ reviewId: id, dealId, endedOn: "2021-01-01" });
    // an approval needs who and when
    await refuses(
      database.db.update(retentionReviews).set({ status: "approved" }).where(eq(retentionReviews.id, id)),
      /retention_reviews_approved_needs_who/,
    );
    await refuses(
      database.db
        .update(retentionReviews)
        .set({ createdAt: new Date(0) })
        .where(eq(retentionReviews.id, id)),
      /only its approval/,
    );
    await database.db
      .update(retentionReviewItems)
      .set({ status: "approved" })
      .where(eq(retentionReviewItems.reviewId, id));
    await refuses(
      database.db
        .update(retentionReviewItems)
        .set({ endedOn: "2020-01-01" })
        .where(eq(retentionReviewItems.reviewId, id)),
      /only its status/,
    );
    await refuses(
      database.db.update(retentionReviewItems).set({ status: "listed" }).where(eq(retentionReviewItems.reviewId, id)),
      /forward once/,
    );
    await database.db
      .update(retentionReviews)
      .set({ status: "approved", approvedBy: users.compliance!.id, approvedAt: AT })
      .where(eq(retentionReviews.id, id));
    await refuses(
      database.db
        .update(retentionReviews)
        .set({ approvedAt: new Date(0) })
        .where(eq(retentionReviews.id, id)),
      /forward once|only its approval/,
    );
    await refuses(database.db.delete(retentionReviews).where(eq(retentionReviews.id, id)), /never deleted/);
    await refuses(database.db.delete(retentionReviewItems), /never deleted/);
    await refuses(database.db.execute(sql`truncate table retention_review_items`), /never deleted/);
  });

  test("compliance reports are immutable and unique per month", async () => {
    const id = newId();
    const row = {
      id,
      period: "2026-10",
      csvSha256: "a".repeat(64),
      pdfSha256: "b".repeat(64),
      csvKey: "aa/a.csv",
      pdfKey: "bb/b.pdf",
      generatedAt: AT,
    };
    await database.db.insert(complianceReports).values(row);
    await refuses(database.db.insert(complianceReports).values({ ...row, id: newId() }), /duplicate|unique/);
    await refuses(
      database.db.update(complianceReports).set({ csvKey: "x" }).where(eq(complianceReports.id, id)),
      /immutable/,
    );
    await refuses(database.db.delete(complianceReports), /immutable/);
  });

  test("alert settings: a positive threshold, one row per (gate, version), append-only", async () => {
    const row = { gate: "kyc_review" as const, version: 1, thresholdHours: 12, setBy: users.admin!.id, setAt: AT };
    await database.db.insert(alertSettings).values(row);
    await refuses(
      database.db.insert(alertSettings).values({ ...row, version: 2, thresholdHours: 0 }),
      /alert_settings_hours/,
    );
    await refuses(database.db.insert(alertSettings).values(row), /duplicate|unique/);
    await refuses(
      database.db.insert(alertSettings).values({ ...row, gate: "nope" as never, version: 3 }),
      /alert_settings_gate/,
    );
    await refuses(database.db.update(alertSettings).set({ thresholdHours: 5 }), /append-only/);
    await refuses(database.db.delete(alertSettings), /append-only/);
  });

  test("alerts: once per (approval, level, user); only read_at and the mail link are set, once; never deleted", async () => {
    const id = newId();
    const row = {
      id,
      approvalId,
      level: "approver" as const,
      userId: users.manager!.id,
      waitedHours: 24,
      createdAt: AT,
    };
    await database.db.insert(alerts).values(row);
    await refuses(database.db.insert(alerts).values({ ...row, id: newId() }), /duplicate|unique/);
    await database.db.insert(alerts).values({ ...row, id: newId(), level: "manager" });
    await refuses(
      database.db.insert(alerts).values({ ...row, id: newId(), level: "boss" as never, userId: users.officer!.id }),
      /alerts_level/,
    );
    await database.db.update(alerts).set({ readAt: AT }).where(eq(alerts.id, id));
    await refuses(
      database.db
        .update(alerts)
        .set({ readAt: new Date(0) })
        .where(eq(alerts.id, id)),
      /once/,
    );
    await refuses(database.db.update(alerts).set({ waitedHours: 99 }).where(eq(alerts.id, id)), /only read_at/);
    await refuses(
      database.db.update(alerts).set({ userId: users.officer!.id }).where(eq(alerts.id, id)),
      /only read_at/,
    );
    await refuses(database.db.delete(alerts).where(eq(alerts.id, id)), /never deleted/);
    await refuses(database.db.execute(sql`truncate table alerts`), /never deleted/);
  });
});
