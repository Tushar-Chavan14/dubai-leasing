import { describe, expect, test } from "bun:test";
import { DEFAULT_SPA_POLICY, SpaPolicy } from "../src/index.ts";

describe("SpaPolicy", () => {
  test("the code default is valid", () => {
    expect(SpaPolicy.parse(DEFAULT_SPA_POLICY)).toEqual(DEFAULT_SPA_POLICY);
  });
  test("refuses reminders out of order, a signing order missing a role, two default NOC rules", () => {
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, reminderDays: [5, 2] }).success).toBe(false);
    expect(
      SpaPolicy.safeParse({
        ...DEFAULT_SPA_POLICY,
        signingOrder: { ...DEFAULT_SPA_POLICY.signingOrder, resale_ready: ["buyer"] },
      }).success,
    ).toBe(false);
    const twoDefaults = [...DEFAULT_SPA_POLICY.nocRules, { projectCode: null, minPaidBps: 1, validityDays: 1 }];
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, nocRules: twoDefaults }).success).toBe(false);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, maxDiscountBps: 10_001 }).success).toBe(false);
  });
  test("documentLinkDays defaults to 14 (an older stored policy parses), and must be 1-60 days (C35, S67)", () => {
    expect(DEFAULT_SPA_POLICY.documentLinkDays).toBe(14);
    const { documentLinkDays: _drop, ...older } = DEFAULT_SPA_POLICY;
    expect(SpaPolicy.parse(older).documentLinkDays).toBe(14);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, documentLinkDays: 0 }).success).toBe(false);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, documentLinkDays: 61 }).success).toBe(false);
  });

  test("signingLinkDays defaults to 14 (an older stored policy without it parses), and must be 1-60 days", () => {
    expect(DEFAULT_SPA_POLICY.signingLinkDays).toBe(14);
    const { signingLinkDays: _drop, ...older } = DEFAULT_SPA_POLICY;
    expect(SpaPolicy.parse(older).signingLinkDays).toBe(14);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, signingLinkDays: 0 }).success).toBe(false);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, signingLinkDays: 61 }).success).toBe(false);
  });

  test("companyLicenceMinDays defaults to 30 (an older stored policy without it parses), and must be 1-365 days", () => {
    expect(DEFAULT_SPA_POLICY.companyLicenceMinDays).toBe(30);
    const { companyLicenceMinDays: _drop, ...older } = DEFAULT_SPA_POLICY;
    expect(SpaPolicy.parse(older).companyLicenceMinDays).toBe(30);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, companyLicenceMinDays: 0 }).success).toBe(false);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, companyLicenceMinDays: 366 }).success).toBe(false);
  });

  test("defaultAfterDays defaults to 30 (an older stored policy without it parses), and must be 1-180 days", () => {
    expect(DEFAULT_SPA_POLICY.defaultAfterDays).toBe(30);
    const { defaultAfterDays: _drop, ...older } = DEFAULT_SPA_POLICY;
    expect(SpaPolicy.parse(older).defaultAfterDays).toBe(30);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, defaultAfterDays: 0 }).success).toBe(false);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, defaultAfterDays: 181 }).success).toBe(false);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, defaultAfterDays: 1.5 }).success).toBe(false);
  });
  test("instalmentReminders defaults to 14 and 3 days before and 1 day after (an older stored policy parses)", () => {
    expect(DEFAULT_SPA_POLICY.instalmentReminders).toEqual({ beforeDays: [14, 3], afterDays: [1] });
    const { instalmentReminders: _drop, ...older } = DEFAULT_SPA_POLICY;
    expect(SpaPolicy.parse(older).instalmentReminders).toEqual({ beforeDays: [14, 3], afterDays: [1] });
    const ok = (r: unknown) => SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, instalmentReminders: r }).success;
    expect(ok({ beforeDays: [], afterDays: [] })).toBe(true);
    expect(ok({ beforeDays: [7], afterDays: [1, 5] })).toBe(true);
    expect(ok({ beforeDays: [3, 14], afterDays: [1] })).toBe(false); // descending, nearest last
    expect(ok({ beforeDays: [3, 3], afterDays: [1] })).toBe(false);
    expect(ok({ beforeDays: [0], afterDays: [1] })).toBe(false);
    expect(ok({ beforeDays: [14], afterDays: [1, 1] })).toBe(false);
    expect(ok({ beforeDays: [14], afterDays: [200] })).toBe(false);
    expect(ok({ beforeDays: [1.5], afterDays: [] })).toBe(false);
  });

  test("chaseTaskAfterDays defaults to 7 (an older stored policy parses) and must exceed the last reminder day (C25, S60)", () => {
    expect(DEFAULT_SPA_POLICY.chaseTaskAfterDays).toBe(7);
    const { chaseTaskAfterDays: _drop, ...older } = DEFAULT_SPA_POLICY;
    expect(SpaPolicy.parse(older).chaseTaskAfterDays).toBe(7);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, chaseTaskAfterDays: 5 }).success).toBe(false);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, reminderDays: [2, 9], chaseTaskAfterDays: 9 }).success).toBe(
      false,
    );
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, reminderDays: [2, 9], chaseTaskAfterDays: 10 }).success).toBe(
      true,
    );
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, chaseTaskAfterDays: 0 }).success).toBe(false);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, chaseTaskAfterDays: 91 }).success).toBe(false);
  });
});

describe("retentionYears (C23, S62)", () => {
  test("defaults to 5 (an older stored policy without it parses), and must be 1-30 years", () => {
    expect(DEFAULT_SPA_POLICY.retentionYears).toBe(5);
    const { retentionYears: _drop, ...older } = DEFAULT_SPA_POLICY;
    expect(SpaPolicy.parse(older).retentionYears).toBe(5);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, retentionYears: 0 }).success).toBe(false);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, retentionYears: 31 }).success).toBe(false);
    expect(SpaPolicy.safeParse({ ...DEFAULT_SPA_POLICY, retentionYears: 5.5 }).success).toBe(false);
  });
});

describe("listingChat caps (S61 amendment)", () => {
  test("default per-listing hourly caps; an older stored policy without them parses; bounds", () => {
    expect(DEFAULT_SPA_POLICY.listingChat).toEqual({ messagesPerListingPerHour: 200, enquiriesPerListingPerHour: 10 });
    const { listingChat: _drop, ...older } = DEFAULT_SPA_POLICY;
    expect(SpaPolicy.parse(older).listingChat.messagesPerListingPerHour).toBe(200);
    expect(
      SpaPolicy.safeParse({
        ...DEFAULT_SPA_POLICY,
        listingChat: { messagesPerListingPerHour: 0, enquiriesPerListingPerHour: 1 },
      }).success,
    ).toBe(false);
    expect(
      SpaPolicy.safeParse({
        ...DEFAULT_SPA_POLICY,
        listingChat: { messagesPerListingPerHour: 1, enquiriesPerListingPerHour: 1.5 },
      }).success,
    ).toBe(false);
  });
});
