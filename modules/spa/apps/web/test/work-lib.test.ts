import { expect, test } from "bun:test";
import { dealsQuery, parseWorkSearch, stageTone, waitingParts, workHref } from "../lib/work";

test("search params become one typed search; junk is dropped", () => {
  expect(parseWorkSearch({})).toEqual({ tab: "deals", scope: "mine", done: false });
  const s = parseWorkSearch({
    tab: "deals",
    type: "resale_ready",
    stage: "SIGNING",
    q: "  marina ",
    mine: "1",
    hold: "1",
    default: "1",
    cursor: "abc",
  });
  expect(s).toMatchObject({
    tab: "deals",
    type: "resale_ready",
    stage: "SIGNING",
    q: "marina",
    mine: true,
    hold: true,
    default: true,
    cursor: "abc",
  });
  const bad = parseWorkSearch({ tab: "hack", type: "x", stage: "DROP TABLE", mine: ["1", "2"] });
  expect(bad).toEqual({ tab: "deals", scope: "mine", done: false });
});

test("the engine query carries only the filters that are set", () => {
  expect(dealsQuery(parseWorkSearch({}))).toBe("limit=25");
  const q = new URLSearchParams(
    dealsQuery(
      parseWorkSearch({
        type: "primary_offplan",
        q: "a b",
        mine: "1",
        hold: "1",
        default: "1",
        stage: "NOC",
        cursor: "c",
      }),
    ),
  );
  expect(Object.fromEntries(q)).toEqual({
    limit: "25",
    type: "primary_offplan",
    q: "a b",
    mine: "true",
    hold: "true",
    default: "true",
    stage: "NOC",
    cursor: "c",
  });
});

test("links keep the other filters and drop the cursor", () => {
  const s = parseWorkSearch({ type: "resale_ready", q: "x", cursor: "c" });
  expect(workHref(s, { hold: true })).toBe("/work?type=resale_ready&q=x&hold=1");
  expect(workHref(s, { type: undefined })).toBe("/work?q=x");
  expect(workHref(parseWorkSearch({}), {})).toBe("/work");
  expect(workHref(parseWorkSearch({}), { tab: "tasks" })).toBe("/work?tab=tasks");
});

test("pill tones follow design 6.1", () => {
  expect(stageTone("ON_HOLD")).toBe("warning");
  expect(stageTone("COMPLETED")).toBe("accent");
  expect(stageTone("HANDED_OVER")).toBe("accent");
  expect(stageTone("SIGNING")).toBe("neutral");
  expect(stageTone("CANCELLED")).toBe("neutral");
});

test("waiting for: a gate names only the role; a review names nobody; since is a date", () => {
  const since = "2026-11-15T06:00:00.000Z";
  expect(waitingParts({ role: "legal", label: "Legal approval", since, waitedDays: 4 }, "sales_officer")).toEqual({
    headline: "Legal approval",
    who: "Legal",
    since: "15 Nov 2026",
    mine: false,
    days: 4,
  });
  expect(waitingParts({ role: null, label: "Compliance review", since, waitedDays: 4 }, "sales_officer")).toMatchObject(
    { headline: "Compliance review", who: null },
  );
  expect(waitingParts({ role: "legal", label: "Legal approval", since, waitedDays: 0 }, "legal")).toMatchObject({
    mine: true,
  });
  expect(waitingParts(null, "legal")).toBeNull();
});

import { canFinishTask, waitingCount } from "../lib/work";

test("a task is finished by its own role or a sales manager, and only while open", () => {
  const t = { role: "finance" as const, status: "open" };
  expect(canFinishTask(t, "finance")).toBe(true);
  expect(canFinishTask(t, "sales_manager")).toBe(true);
  expect(canFinishTask(t, "sales_officer")).toBe(false);
  expect(canFinishTask({ ...t, status: "done" }, "finance")).toBe(false);
});

test("the Work badge counts what waits for the role", () => {
  expect(waitingCount({ inbox: { open: 2 }, tasks: { open: 3 } })).toBe(5);
  expect(waitingCount(null)).toBe(0);
});

test("a stage is one the Work list may filter by; the internal hold name is not", () => {
  expect(parseWorkSearch({ stage: "ON_HOLD" }).stage).toBe("ON_HOLD");
  expect(parseWorkSearch({ stage: "NOC" }).stage).toBe("NOC");
  expect(parseWorkSearch({ stage: "AML_HOLD" }).stage).toBeUndefined();
  expect(parseWorkSearch({ stage: "SOMETHING" }).stage).toBeUndefined();
});

test("the inbox tab is in the address (C31); its link keeps no deal filter and the page cursor is its own", () => {
  expect(parseWorkSearch({ tab: "inbox" }).tab).toBe("inbox");
  const s = parseWorkSearch({ tab: "inbox", cursor: "c1", q: "x", hold: "1" });
  expect(workHref(s, { cursor: "c2" })).toBe("/work?tab=inbox&cursor=c2");
  expect(workHref(s, { tab: "deals" })).toBe("/work?q=x&hold=1");
  expect(workHref(parseWorkSearch({ tab: "inbox" }), {})).toBe("/work?tab=inbox");
});
