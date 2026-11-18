import { describe, expect, test } from "bun:test";
import { defaultCompanyPolicy } from "@leasing/core";
import { freeViewingSlots, parseSlotKey, slotKey } from "../src/manager/viewing-slots.ts";

const policy = { ...defaultCompanyPolicy }; // Mon–Sat, 10:00–18:00 Dubai, 30 min, 4 h lead, 7 days
const dubai = (local: string) => new Date(`${local}+04:00`);
const iso = (d: Date) => d.toISOString();

describe("freeViewingSlots", () => {
  test("Sunday is not a viewing day: the first slot is Monday 10:00 Dubai", () => {
    const slots = freeViewingSlots(dubai("2026-11-01T08:00:00"), policy, [], 3); // Sunday
    expect(slots.map(iso)).toEqual([
      iso(dubai("2026-11-02T10:00:00")),
      iso(dubai("2026-11-02T10:30:00")),
      iso(dubai("2026-11-02T11:00:00")),
    ]);
  });

  test("the lead time is respected on a viewing day", () => {
    const [first] = freeViewingSlots(dubai("2026-11-02T09:10:00"), policy, [], 1); // Monday 09:10
    expect(iso(first!)).toBe(iso(dubai("2026-11-02T13:30:00"))); // 09:10 + 4 h → next slot 13:30
  });

  test("the last slot ends by the closing hour", () => {
    const monday = freeViewingSlots(dubai("2026-11-02T06:00:00"), policy, [], 100).filter(
      (s) => iso(s) < iso(dubai("2026-11-03T00:00:00")),
    );
    expect(iso(monday.at(-1)!)).toBe(iso(dubai("2026-11-02T17:30:00")));
    expect(monday).toHaveLength(16);
  });

  test("Dubai day boundary: late evening UTC is already the next Dubai day", () => {
    // 2026-11-01 21:00 UTC = Monday 01:00 Dubai; lead 4 h → Monday 10:00 is the first slot.
    const [first] = freeViewingSlots(new Date("2026-11-01T21:00:00Z"), policy, [], 1);
    expect(iso(first!)).toBe(iso(dubai("2026-11-02T10:00:00")));
  });

  test("nothing beyond the horizon", () => {
    const now = dubai("2026-11-02T06:00:00");
    const all = freeViewingSlots(now, policy, [], Number.POSITIVE_INFINITY);
    const limit = now.getTime() + 7 * 86_400_000;
    expect(all.every((s) => s.getTime() <= limit)).toBe(true);
    expect(all.length).toBeGreaterThan(0);
  });

  test("a booked viewing takes its slot, and a staff booking off the grid blocks the slots it overlaps", () => {
    const now = dubai("2026-11-02T06:00:00");
    const exact = freeViewingSlots(now, policy, [dubai("2026-11-02T10:30:00")], 3).map(iso);
    expect(exact).toEqual([
      iso(dubai("2026-11-02T10:00:00")),
      iso(dubai("2026-11-02T11:00:00")),
      iso(dubai("2026-11-02T11:30:00")),
    ]);
    const offGrid = freeViewingSlots(now, policy, [dubai("2026-11-02T10:15:00")], 2).map(iso);
    expect(offGrid).toEqual([iso(dubai("2026-11-02T11:00:00")), iso(dubai("2026-11-02T11:30:00"))]);
  });

  test("policy changes: Saturday only, 60-minute slots", () => {
    const slots = freeViewingSlots(
      dubai("2026-11-02T06:00:00"),
      { ...policy, viewingDays: [6], viewingSlotMinutes: 60, viewingStartHour: 9, viewingEndHour: 11 },
      [],
      10,
    );
    expect(slots.map(iso)).toEqual([iso(dubai("2026-11-07T09:00:00")), iso(dubai("2026-11-07T10:00:00"))]);
  });
});

describe("slot keys", () => {
  test("round trip, and only well-formed keys parse", () => {
    const at = dubai("2026-11-02T10:30:00");
    expect(slotKey(at).length).toBeLessThanOrEqual(64);
    expect(parseSlotKey(slotKey(at))?.toISOString()).toBe(at.toISOString());
    expect(parseSlotKey("slot:abc")).toBeNull();
    expect(parseSlotKey("slot:1")).toBeNull();
    expect(parseSlotKey("unit:29000000")).toBeNull();
  });
});
