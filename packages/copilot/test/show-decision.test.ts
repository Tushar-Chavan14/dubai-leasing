import { describe, expect, test } from "bun:test";
import type { StaffUser } from "@leasing/core";
import { showDecision } from "../src/tools/show-decision.ts";
import type { EngineClient } from "../src/types.ts";

const LEASE = "01a19b12-976a-78d3-b70a-b89ad770d5bb";
const APP = "01a19afb-12b6-7f23-9b10-1f71864d2b82";
const RES = "01a19afb-12b6-7f23-9b10-1f71864d2b99";
const officer: StaffUser = { id: "u-off", email: "o@test.example", name: "O", role: "leasing_officer" };
const finance: StaffUser = { id: "u-fin", email: "f@test.example", name: "F", role: "finance" };

let noSubmission = false;
const engine = (paths: string[] = []): EngineClient => ({
  async get<T>(path: string): Promise<T> {
    paths.push(path);
    if (path.startsWith("/api/copilot/records")) {
      const q = decodeURIComponent(/q=([^&]*)/.exec(path)?.[1] ?? "").toLowerCase();
      const rows: (Record<string, unknown> & { ref: string; title: string; unitCode: string })[] = [
        {
          kind: "lease",
          id: LEASE,
          ref: "JVC-0412/2026-11",
          title: "Lena Testova",
          unitCode: "JVC-0412",
          stage: "Ejari",
          nextStep: "",
          owner: "",
        },
        {
          kind: "application",
          id: APP,
          ref: "A-TMSDQZ",
          title: "Lena Testova",
          unitCode: "JVC-0412",
          stage: "Viewing",
          nextStep: "",
          owner: "",
        },
        {
          kind: "application",
          id: RES,
          ref: "A-BZVJ2V",
          title: "Lena Testova",
          unitCode: "JVC-0412",
          stage: "Offer",
          nextStep: "",
          owner: "",
          reservationDueFils: 370_000,
        },
      ];
      const hits = rows.filter((r) => [r.ref, r.title, r.unitCode].some((v) => v.toLowerCase().includes(q)));
      return { total: hits.length, rows: hits } as T;
    }
    if (path === "/api/approvals?status=pending") {
      return [
        {
          id: "a1",
          title: "Submit JVC-0412/2026-11 to Ejari (simulated)",
          gate: "ejari_submission",
          gateLabel: "Ejari submission",
          entityKind: "lease",
          entityId: LEASE,
          proposedBy: "system",
        },
        {
          id: "a2",
          title: "Final contract",
          gate: "final_contract",
          gateLabel: "Final contract",
          entityKind: "lease",
          entityId: LEASE,
          proposedBy: `user:${officer.id}`,
        },
        {
          id: "a3",
          title: "Elsewhere",
          gate: "final_contract",
          gateLabel: "Final contract",
          entityKind: "lease",
          entityId: "other",
          proposedBy: "system",
        },
      ] as T;
    }
    if (path === `/api/leases/${LEASE}/registration`) {
      const SUB = "01a19b12-976a-78d3-b70a-b89ad770d5cc";
      return {
        mode: "manual",
        registration: {
          system: "Ejari",
          portalName: "Ejari portal",
          portalUrl: "https://example.test",
          instructions: "Open the portal.",
          referenceExample: "ABC-123",
        },
        pack: {
          leaseRef: "JVC-0412/2026-11",
          state: "REGISTRATION",
          fee: { feeFils: 89_250, paidBy: "tenant" },
          checklist: [{ key: "title_deed", label: "Title deed", status: "bring" }],
        },
        openTaskId: null,
        submissions: noSubmission
          ? []
          : [
              {
                id: SUB,
                attempt: 1,
                mode: "manual",
                status: "awaiting_manual",
                reference: null,
                reasons: "<b>x",
                completedAt: null,
              },
            ],
      } as T;
    }
    throw new Error(`unexpected ${path}`);
  },
  async propose<T>(): Promise<T> {
    throw new Error("show_decision never writes");
  },
});
const ctx = (user: StaffUser, e = engine()) => ({ engine: e, user, today: "2026-11-02" });

describe("show_decision (D48): a card the user clicks; the tool decides nothing", () => {
  test("approvals for the named record become cards; one the user prepared is blocked; others aren't shown", async () => {
    const paths: string[] = [];
    const out = await showDecision.run({ action: "approval", record: "lena testova" }, ctx(officer, engine(paths)));
    expect(out.shown).toBe(2);
    const cards = out.ui!.cards;
    expect(cards.map((c) => (c.decision === "approval" ? c.approvalId : ""))).toEqual(["a1", "a2"]);
    expect(cards[0]!.blocked).toBeUndefined();
    expect(cards[1]!.blocked).toContain("You prepared this");
    expect(cards[0]!.href).toBe("/work?approval=a1");
    // Only reads: the records search and the pending approvals.
    expect(paths).toEqual(["/api/copilot/records?q=lena%20testova&limit=20", "/api/approvals?status=pending"]);
    expect(out.note).toContain("Nothing is approved");
  });

  test("a role that doesn't decide the gate sees the card blocked with who decides it", async () => {
    const out = await showDecision.run(
      { action: "approval", approvalId: "01a19b37-71b3-70b6-97fd-31d8e5a764ae" },
      ctx(finance),
    );
    expect(out.shown).toBe(0);
    const byRecord = await showDecision.run({ action: "approval", record: "JVC-0412" }, ctx(finance));
    expect(byRecord.ui!.cards[0]!.blocked).toContain("leasing officer");
  });

  test("site visit: only applications at the viewing stage; non-leasing roles are blocked", async () => {
    const out = await showDecision.run({ action: "site_visit", record: "A-TMSDQZ" }, ctx(officer));
    expect(out.ui!.cards).toEqual([
      expect.objectContaining({ decision: "site_visit", applicationId: APP, ref: "A-TMSDQZ" }),
    ]);
    expect(out.ui!.cards[0]!.blocked).toBeUndefined();
    const fin = await showDecision.run({ action: "site_visit", record: "A-TMSDQZ" }, ctx(finance));
    expect(fin.ui!.cards[0]!.blocked).toContain("Leasing staff");
  });

  test("approval titles reach the model wrapped as untrusted", async () => {
    const out = await showDecision.run({ action: "approval", record: "lena testova" }, ctx(officer));
    expect(out.items[0]!.what).toContain("<untrusted>");
  });

  test("reservation: only an accepted offer; the amount is the engine's; prefills the user's date and reference", async () => {
    const out = await showDecision.run(
      { action: "reservation", record: "A-BZVJ2V", paidOn: "2026-11-02", reference: "144411223" },
      ctx(officer),
    );
    expect(out.ui!.cards).toEqual([
      expect.objectContaining({
        decision: "reservation",
        applicationId: RES,
        amount: "AED 3,700.00",
        paidOn: "2026-11-02",
        today: "2026-11-02",
        reference: "144411223",
      }),
    ]);
    expect(out.items[0]!.what).toBe("Reservation payment of AED 3,700.00");
    expect(out.note).toContain("Nothing is approved, rejected or recorded");
  });

  test("reservation: a future date falls back to today; non-leasing roles are blocked", async () => {
    const out = await showDecision.run(
      { action: "reservation", record: "A-BZVJ2V", paidOn: "2026-12-01" },
      ctx(officer),
    );
    const card = out.ui!.cards[0]!;
    expect(card.decision === "reservation" && card.paidOn).toBe("2026-11-02");
    expect(card.decision === "reservation" && card.reference).toBe("");
    const fin = await showDecision.run({ action: "reservation", record: "A-BZVJ2V" }, ctx(finance));
    expect(fin.ui!.cards[0]!.blocked).toContain("Leasing staff");
  });

  test("reservation: nothing when no accepted offer matches", async () => {
    const out = await showDecision.run({ action: "reservation", record: "A-TMSDQZ" }, ctx(officer));
    expect(out.shown).toBe(0);
    expect(out.note).toContain("accepted offer");
  });
});

describe("show_decision registration cards (D52)", () => {
  test("registration: only with a submission awaiting manual registration; fee is the engine's; the user's reference is prefilled", async () => {
    noSubmission = false;
    const out = await showDecision.run(
      { action: "registration", record: "JVC-0412", reference: "ABC-123", registeredOn: "2026-12-01" },
      ctx(officer),
    );
    expect(out.ui!.cards).toEqual([
      expect.objectContaining({
        decision: "registration",
        leaseId: LEASE,
        submissionId: "01a19b12-976a-78d3-b70a-b89ad770d5cc",
        reference: "ABC-123",
        issuedOn: "2026-11-02",
        feePaidAed: "892.50",
        href: `/leases/${LEASE}`,
      }),
    ]);
    expect(out.ui!.cards[0]!.blocked).toBeUndefined();
    noSubmission = true;
    const none = await showDecision.run({ action: "registration", record: "JVC-0412" }, ctx(officer));
    expect(none.shown).toBe(0);
    expect(none.note).toContain("manual registration");
    noSubmission = false;
  });

  test("registration_rejected prefills the user's reasons; tenant text seen this turn empties every prefill", async () => {
    const out = await showDecision.run(
      { action: "registration_rejected", record: "JVC-0412", reasons: "Title deed unreadable" },
      ctx(officer),
    );
    expect(out.ui!.cards[0]).toMatchObject({ decision: "registration_rejected", reasons: "Title deed unreadable" });
    const tainted = await showDecision.run(
      { action: "registration", record: "JVC-0412", reference: "999" },
      { ...ctx(officer), untrustedSeen: true },
    );
    expect(tainted.ui!.cards[0]).toMatchObject({ decision: "registration", reference: "" });
  });

  test("a role that can't record sees the card blocked, without reading the registration", async () => {
    const paths: string[] = [];
    const out = await showDecision.run({ action: "registration", record: "JVC-0412" }, ctx(finance, engine(paths)));
    expect(out.ui!.cards[0]!.blocked).toContain("Leasing staff");
    expect(paths.some((p) => p.includes("/registration"))).toBe(false);
  });
});
