import { describe, expect, test } from "bun:test";
import {
  applicationMachine,
  calendarDate as d,
  canTransition,
  findTransition,
  type LeaseGuardContext,
  leaseMachine,
  type UnitGuardContext,
  unitMachine,
} from "../src/index.ts";

const readyUnit = {
  category: "residential" as const,
  dldPropertyNo: "DLD-1001",
  unitNo: "1204",
  makaniNo: "1234567890",
  areaSqft: 850,
  bedrooms: 1,
  furnished: false,
  dewaPremiseNo: "DEWA-1",
  askingRentFils: 8_500_000,
  priceApprovedAt: null,
  ownUseLockUntil: null,
};
const unitCtx = (
  over: Omit<Partial<UnitGuardContext>, "unit"> & { unit?: Partial<UnitGuardContext["unit"]> } = {},
): UnitGuardContext => ({
  today: d("2026-06-01"),
  priceRange: {
    min: 7_000_000,
    max: 10_000_000,
    basis: { sriFils: null, bandMin: null, bandMax: null, aedMin: 7_000_000, aedMax: 10_000_000 },
  },
  hasActiveEjari: false,
  hasContractedLease: false,
  ...over,
  unit: { ...readyUnit, ...over.unit },
});

const lease = {
  ejariNo: "EJ-1",
  ejariCancelledOn: null,
  depositSettledOn: null,
  startOn: d("2026-01-01"),
  endOn: d("2026-12-31"),
};
const leaseCtx = (
  over: Partial<LeaseGuardContext["lease"]> = {},
  extra: Partial<LeaseGuardContext> = {},
): LeaseGuardContext => ({
  today: d("2026-06-01"),
  ...extra,
  lease: { ...lease, ...over },
});

describe("machines are well formed", () => {
  for (const m of [unitMachine, applicationMachine, leaseMachine]) {
    test(`${m.entity}: every non-terminal state has an exit`, () => {
      for (const s of m.states) {
        if ((m.terminal as readonly string[]).includes(s)) continue;
        expect(m.transitions.some((t) => t.from === s)).toBe(true);
      }
    });
    test(`${m.entity}: terminal states have no exit`, () => {
      for (const s of m.terminal) expect(m.transitions.some((t) => t.from === s)).toBe(false);
    });
    test(`${m.entity}: every state is reachable from the initial state`, () => {
      const seen = new Set<string>([m.initial]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const t of m.transitions) {
          if (seen.has(t.from) && !seen.has(t.to)) {
            seen.add(t.to);
            grew = true;
          }
        }
      }
      // OCCUPIED/READY etc. are reachable; nothing is orphaned.
      expect([...seen].toSorted()).toEqual([...m.states].toSorted());
    });
  }
});

describe("unit", () => {
  const guard = (from: "PREP" | "READY" | "OCCUPIED", event: "MARK_READY" | "PUBLISH" | "LEASE_CLOSED") => {
    const t = findTransition(unitMachine, from, event);
    if (!t?.guard) throw new Error("expected guard");
    return t.guard;
  };
  test("PREP → READY when checklist complete and rent in range", () => {
    expect(guard("PREP", "MARK_READY")(unitCtx())).toEqual({ ok: true });
  });
  test("commercial unit without bedrooms passes the checklist", () => {
    const r = guard("PREP", "MARK_READY")(unitCtx({ unit: { category: "commercial", bedrooms: null } }));
    expect(r).toEqual({ ok: true });
  });
  test("residential unit without bedrooms fails it", () => {
    const r = guard("PREP", "MARK_READY")(unitCtx({ unit: { bedrooms: null } }));
    expect(r).toEqual({ ok: false, reasons: ["missing bedrooms"] });
  });
  test("PREP → READY refused with missing checklist fields", () => {
    const r = guard("PREP", "MARK_READY")(unitCtx({ unit: { makaniNo: null, dewaPremiseNo: "" } }));
    expect(r).toEqual({ ok: false, reasons: ["missing Makani number", "missing DEWA premise number"] });
  });
  test("PREP → READY refused when rent outside range and not approved", () => {
    const r = guard("PREP", "MARK_READY")(unitCtx({ unit: { askingRentFils: 50_000_000 } }));
    expect(r.ok).toBe(false);
  });
  test("PREP → READY allowed when out-of-range price was approved", () => {
    const r = guard(
      "PREP",
      "MARK_READY",
    )(unitCtx({ unit: { askingRentFils: 50_000_000, priceApprovedAt: new Date(0) } }));
    expect(r.ok).toBe(true);
  });
  test("PREP → READY refused without asking rent", () => {
    expect(guard("PREP", "MARK_READY")(unitCtx({ unit: { askingRentFils: null } })).ok).toBe(false);
  });
  test("PUBLISH refused while previous Ejari is active", () => {
    expect(guard("READY", "PUBLISH")(unitCtx({ hasActiveEjari: true }))).toEqual({
      ok: false,
      reasons: ["a previous Ejari registration is still active"],
    });
  });
  test("PUBLISH refused inside own-use lock, allowed on the lock end date", () => {
    expect(guard("READY", "PUBLISH")(unitCtx({ unit: { ownUseLockUntil: d("2026-06-02") } })).ok).toBe(false);
    expect(guard("READY", "PUBLISH")(unitCtx({ unit: { ownUseLockUntil: d("2026-06-01") } })).ok).toBe(true);
  });
  test("PUBLISH refused while the unit is under contract", () => {
    expect(guard("READY", "PUBLISH")(unitCtx({ hasContractedLease: true }))).toEqual({
      ok: false,
      reasons: ["the unit is already under contract"],
    });
  });
  test("WITHDRAW refused while a lease on the unit is contracted, from LISTED and READY", () => {
    for (const from of ["LISTED", "READY"] as const) {
      const g = findTransition(unitMachine, from, "WITHDRAW")?.guard;
      expect(g?.(unitCtx({ hasContractedLease: true }))).toEqual({
        ok: false,
        reasons: ["the unit is under contract"],
      });
      expect(g?.(unitCtx())).toEqual({ ok: true });
    }
  });
  test("LEASE_CLOSED refused while Ejari active", () => {
    expect(guard("OCCUPIED", "LEASE_CLOSED")(unitCtx({ hasActiveEjari: true })).ok).toBe(false);
    expect(guard("OCCUPIED", "LEASE_CLOSED")(unitCtx()).ok).toBe(true);
  });
  test("transition table", () => {
    expect(canTransition("unit", "PREP", "READY")).toBe(true);
    expect(canTransition("unit", "READY", "LISTED")).toBe(true);
    expect(canTransition("unit", "LISTED", "OCCUPIED")).toBe(true);
    expect(canTransition("unit", "READY", "OCCUPIED")).toBe(true);
    expect(canTransition("unit", "OCCUPIED", "PREP")).toBe(true);
    expect(canTransition("unit", "LISTED", "PREP")).toBe(true);
    expect(canTransition("unit", "PREP", "LISTED")).toBe(false);
    expect(canTransition("unit", "PREP", "OCCUPIED")).toBe(false);
    expect(canTransition("unit", "OCCUPIED", "LISTED")).toBe(false);
  });
});

describe("application", () => {
  test("happy path", () => {
    const path = [
      ["ENQUIRY", "VIEWING_BOOKED", "VIEWING"],
      ["VIEWING", "APPLIED", "SCREENING"],
      ["SCREENING", "KYC_VERIFIED", "OFFER"],
      ["OFFER", "OFFER_ACCEPTED", "RESERVED"],
      ["RESERVED", "LEASE_CREATED", "CONVERTED"],
    ] as const;
    for (const [from, ev, to] of path) expect(findTransition(applicationMachine, from, ev)?.to).toBe(to);
  });
  test("offer acceptance needs the reservation payment", () => {
    const t = findTransition(applicationMachine, "OFFER", "OFFER_ACCEPTED");
    expect(t?.guard?.({ reservationPaid: false })).toEqual({
      ok: false,
      reasons: ["reservation payment not recorded"],
    });
    expect(t?.guard?.({ reservationPaid: true })).toEqual({ ok: true });
  });
  test("exits", () => {
    expect(findTransition(applicationMachine, "SCREENING", "KYC_FAILED")?.to).toBe("REJECTED");
    expect(findTransition(applicationMachine, "OFFER", "OFFER_DECLINED")?.to).toBe("WITHDRAWN");
    expect(findTransition(applicationMachine, "OFFER", "OFFER_EXPIRED")?.to).toBe("WITHDRAWN");
    expect(findTransition(applicationMachine, "ENQUIRY", "KYC_VERIFIED")).toBeUndefined();
    expect(findTransition(applicationMachine, "CONVERTED", "WITHDRAWN")).toBeUndefined();
    expect(findTransition(applicationMachine, "OFFER", "WITHDRAWN")?.to).toBe("WITHDRAWN");
  });
  test("viewing outcome: attended applies, a no-show closes the application", () => {
    expect(findTransition(applicationMachine, "VIEWING", "APPLIED")?.to).toBe("SCREENING");
    expect(findTransition(applicationMachine, "VIEWING", "VIEWING_NO_SHOW")?.to).toBe("WITHDRAWN");
    expect(findTransition(applicationMachine, "ENQUIRY", "VIEWING_NO_SHOW")).toBeUndefined();
    expect(findTransition(applicationMachine, "SCREENING", "VIEWING_NO_SHOW")).toBeUndefined();
  });
  test("walk-in applicants apply without a viewing; offers can be revised in place", () => {
    expect(findTransition(applicationMachine, "ENQUIRY", "APPLIED")?.to).toBe("SCREENING");
    expect(findTransition(applicationMachine, "OFFER", "OFFER_REVISED")?.to).toBe("OFFER");
    expect(findTransition(applicationMachine, "SCREENING", "OFFER_REVISED")).toBeUndefined();
    expect(findTransition(applicationMachine, "RESERVED", "OFFER_REVISED")).toBeUndefined();
  });
});

describe("lease", () => {
  test("gated transitions", () => {
    expect(findTransition(leaseMachine, "CONTRACT", "CONTRACT_SIGNED")?.gate).toBe("final_contract");
    expect(findTransition(leaseMachine, "REGISTRATION", "EJARI_ISSUED")?.gate).toBe("ejari_submission");
    expect(findTransition(leaseMachine, "ACTIVE", "TERMINATED")?.gate).toBe("vacate_notice");
    expect(findTransition(leaseMachine, "RENEWAL", "TERMINATED")?.gate).toBe("vacate_notice");
    expect(findTransition(leaseMachine, "RENEWAL", "RENEWED")?.gate).toBe("renewal_notice");
    expect(findTransition(leaseMachine, "ACTIVE", "TENANT_VACATE_NOTICE")?.gate).toBeUndefined();
  });
  test("EJARI_ISSUED needs an Ejari number", () => {
    const g = findTransition(leaseMachine, "REGISTRATION", "EJARI_ISSUED")?.guard;
    expect(g?.(leaseCtx({ ejariNo: null })).ok).toBe(false);
    expect(g?.(leaseCtx()).ok).toBe(true);
  });
  test("MOVE_IN_COMPLETED needs the Ejari number and a complete move-in checklist", () => {
    const g = findTransition(leaseMachine, "MOVE_IN", "MOVE_IN_COMPLETED")?.guard;
    expect(g?.({ ...leaseCtx(), moveInMissing: [] })).toEqual({ ok: true });
    expect(g?.({ ...leaseCtx({ ejariNo: null }), moveInMissing: [] })).toEqual({
      ok: false,
      reasons: ["Ejari number missing"],
    });
    expect(g?.(leaseCtx())).toEqual({ ok: false, reasons: ["move-in checklist not started"] });
    expect(g?.({ ...leaseCtx(), moveInMissing: ["DEWA not ticked", "no photo of the kitchen"] })).toEqual({
      ok: false,
      reasons: ["DEWA not ticked", "no photo of the kitchen"],
    });
  });
  test("SETTLED needs deposit settled and Ejari cancelled", () => {
    const g = findTransition(leaseMachine, "MOVE_OUT", "SETTLED")?.guard;
    expect(g?.(leaseCtx())).toEqual({ ok: false, reasons: ["deposit not settled", "Ejari not cancelled"] });
    expect(g?.(leaseCtx({ depositSettledOn: d("2027-01-05") })).ok).toBe(false);
    expect(g?.(leaseCtx({ depositSettledOn: d("2027-01-05"), ejariCancelledOn: d("2027-01-03") })).ok).toBe(true);
    expect(g?.(leaseCtx({ ejariNo: null, depositSettledOn: d("2027-01-05") })).ok).toBe(true);
  });
  test("DISPUTE_RESOLVED_CLOSED uses the same settlement guard", () => {
    const g = findTransition(leaseMachine, "DISPUTE", "DISPUTE_RESOLVED_CLOSED")?.guard;
    expect(g?.(leaseCtx()).ok).toBe(false);
  });
  test("TERMINATED takes effect only at or after lease end", () => {
    for (const from of ["ACTIVE", "RENEWAL"] as const) {
      const g = findTransition(leaseMachine, from, "TERMINATED")?.guard;
      expect(g?.(leaseCtx({}, { today: d("2026-12-30") })).ok).toBe(false);
      expect(g?.(leaseCtx({}, { today: d("2026-12-31") })).ok).toBe(true);
    }
  });
  test("there is no ungated landlord non-renewal", () => {
    expect(leaseMachine.events).not.toContain("NOT_RENEWED" as never);
  });
  test("RENEWED needs a later new term", () => {
    const g = findTransition(leaseMachine, "RENEWAL", "RENEWED")?.guard;
    expect(g?.(leaseCtx())).toEqual({ ok: false, reasons: ["new term missing"] });
    expect(g?.(leaseCtx({}, { newTerm: { startOn: d("2026-12-31"), endOn: d("2027-12-30") } })).ok).toBe(false);
    expect(g?.(leaseCtx({}, { newTerm: { startOn: d("2027-01-01"), endOn: d("2027-01-01") } })).ok).toBe(false);
    expect(g?.(leaseCtx({}, { newTerm: { startOn: d("2027-01-01"), endOn: d("2027-12-31") } })).ok).toBe(true);
  });
  test("transition table", () => {
    const ok: [string, string][] = [
      ["CONTRACT", "REGISTRATION"],
      ["REGISTRATION", "MOVE_IN"],
      ["MOVE_IN", "ACTIVE"],
      ["ACTIVE", "RENEWAL"],
      ["RENEWAL", "ACTIVE"],
      ["RENEWAL", "MOVE_OUT"],
      ["ACTIVE", "MOVE_OUT"],
      ["MOVE_OUT", "CLOSED"],
      ["ACTIVE", "DISPUTE"],
      ["RENEWAL", "DISPUTE"],
      ["MOVE_OUT", "DISPUTE"],
      ["DISPUTE", "ACTIVE"],
      ["DISPUTE", "MOVE_OUT"],
      ["DISPUTE", "CLOSED"],
    ];
    for (const [a, b] of ok) expect(canTransition("lease", a, b)).toBe(true);
    const bad: [string, string][] = [
      ["CONTRACT", "ACTIVE"],
      ["CLOSED", "ACTIVE"],
      ["ACTIVE", "CLOSED"],
      ["REGISTRATION", "ACTIVE"],
      ["MOVE_IN", "RENEWAL"],
    ];
    for (const [a, b] of bad) expect(canTransition("lease", a, b)).toBe(false);
  });
});
