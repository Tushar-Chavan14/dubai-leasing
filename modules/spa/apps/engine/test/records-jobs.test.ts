/* oxlint-disable no-explicit-any -- schedule rows read loosely */
import { describe, expect, test } from "bun:test";
import { FixedClock } from "@platform/kernel";
import { spaTestDatabaseUrl } from "@spa/db/testing";
import {
  createBoss,
  MONTHLY_REPORT_JOB,
  reportKey,
  RETENTION_REVIEW_JOB,
  retentionKey,
  startJobs,
} from "../src/jobs.ts";

const url = spaTestDatabaseUrl();

describe("the monthly records jobs (C23, S62)", () => {
  test("keys are one per Dubai month", () => {
    expect(retentionKey("2026-11-19")).toBe("retention:2026-11");
    expect(reportKey("2026-11-01")).toBe("report:2026-11");
  });
  test.skipIf(!url)(
    "retention runs on the 1st at 01:00 and the report at 02:00 Dubai; each is queued once at start and runs its handler once",
    async () => {
      const seen = { retention: 0, report: 0 };
      const jobs = await startJobs(createBoss(url!), new FixedClock(new Date("2026-11-19T06:00:00Z")), {
        retentionReview: async () => void seen.retention++,
        monthlyReport: async () => void seen.report++,
      });
      try {
        for (let i = 0; i < 40 && (!seen.retention || !seen.report); i++) await Bun.sleep(100);
        await Bun.sleep(300);
        expect(seen).toEqual({ retention: 1, report: 1 });
        const s = (await jobs.boss.getSchedules()) as any[];
        const of = (n: string) => s.find((x) => x.name === n);
        expect(of(RETENTION_REVIEW_JOB)).toMatchObject({ cron: "0 1 1 * *", timezone: "Asia/Dubai" });
        expect(of(MONTHLY_REPORT_JOB)).toMatchObject({ cron: "0 2 1 * *", timezone: "Asia/Dubai" });
        // the month's key queues nothing more
        await jobs.boss.send(RETENTION_REVIEW_JOB, {}, { singletonKey: retentionKey("2026-11-19") });
        await jobs.boss.send(MONTHLY_REPORT_JOB, {}, { singletonKey: reportKey("2026-11-19") });
        await Bun.sleep(500);
        expect(seen).toEqual({ retention: 1, report: 1 });
      } finally {
        await jobs.stop();
      }
    },
  );
});
