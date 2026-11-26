import { z } from "zod";
import { DEAL_ROLES, DealIdInput, fence, nullableMoney } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Output = z.object({
  deal: z.object({
    id: z.string(),
    ref: z.string(),
    typeLabel: z.string(),
    stage: z.string(),
    stageLabel: z.string(),
    property: z.string(),
    priceFils: z.number().int(),
    rulesVersion: z.string(),
    targetTransferOn: z.string().nullable(),
    unitNo: z.string().nullable(),
    sellerMortgage: z.boolean(),
    buyerMortgage: z.boolean(),
    planTakenOver: z.boolean(),
    onHold: z.boolean(),
    inDefault: z.boolean(),
  }),
  waitingFor: z.object({ label: z.string(), role: z.string().nullable(), waitedDays: z.number().int() }).nullable(),
  parties: z.array(
    z.object({
      role: z.string(),
      kind: z.string(),
      name: z.string(),
      shareBps: nullableMoney,
      kyc: z.string().nullable(),
      compliance: z.string(),
    }),
  ),
  steps: z.array(z.object({ label: z.string(), status: z.string() })),
  approvals: z.array(
    z.object({ id: z.string(), gateLabel: z.string(), status: z.string(), approverRole: z.string().nullable() }),
  ),
  openTasks: z.array(z.object({ id: z.string(), title: z.string(), role: z.string() })),
});

const Raw = z.object({
  deal: z.object({
    id: z.string(),
    ref: z.string(),
    typeLabel: z.string(),
    stage: z.string(),
    stageLabel: z.string(),
    property: z.object({ label: z.string() }),
    priceFils: z.number().int(),
    rulesVersion: z.string(),
    targetTransferOn: z.string().nullable().optional(),
    unitNo: z.string().nullable().optional(),
    sellerMortgage: z.boolean(),
    buyerMortgage: z.boolean(),
    planTakenOver: z.boolean(),
    onHold: z.boolean(),
    inDefault: z.boolean(),
  }),
  waitingFor: z
    .object({ label: z.string(), role: z.string().nullable().optional(), waitedDays: z.number().int() })
    .nullable()
    .optional(),
  sections: z
    .object({
      parties: z
        .array(
          z.object({
            role: z.string(),
            kind: z.string(),
            name: z.string(),
            shareBps: z.number().int().nullable().optional(),
            kyc: z.object({ status: z.string() }).nullable().optional(),
            compliance: z.object({ status: z.string() }).optional(),
          }),
        )
        .optional(),
      steps: z.array(z.object({ label: z.string(), status: z.string() })).optional(),
      approvals: z
        .array(
          z.object({
            id: z.string(),
            gate: z.string().optional(),
            gateLabel: z.string().optional(),
            title: z.string().optional(),
            status: z.string(),
            approverRole: z.string().nullable().optional(),
          }),
        )
        .optional(),
      tasks: z.array(z.object({ id: z.string(), title: z.string(), role: z.string(), status: z.string() })).optional(),
    })
    .partial(),
});

export const getDeal: CopilotTool<typeof DealIdInput, typeof Output> = {
  name: "get_deal",
  description:
    "One deal in full: stage, property, price, parties with their document status, the steps, pending approvals and open tasks, and the rulebook version it is pinned to. Needs the deal id from search_deals.",
  kind: "read",
  roles: DEAL_ROLES,
  input: DealIdInput,
  output: Output,
  async run(client, a) {
    const r = Raw.parse(await client.get(`/api/deals/${a.dealId}`));
    const s = r.sections;
    return Output.parse({
      deal: {
        id: r.deal.id,
        ref: r.deal.ref,
        typeLabel: r.deal.typeLabel,
        stage: r.deal.stage,
        stageLabel: r.deal.stageLabel,
        property: fence(r.deal.property.label),
        priceFils: r.deal.priceFils,
        rulesVersion: r.deal.rulesVersion,
        targetTransferOn: r.deal.targetTransferOn ?? null,
        unitNo: r.deal.unitNo ?? null,
        sellerMortgage: r.deal.sellerMortgage,
        buyerMortgage: r.deal.buyerMortgage,
        planTakenOver: r.deal.planTakenOver,
        onHold: r.deal.onHold,
        inDefault: r.deal.inDefault,
      },
      waitingFor: r.waitingFor
        ? { label: r.waitingFor.label, role: r.waitingFor.role ?? null, waitedDays: r.waitingFor.waitedDays }
        : null,
      parties: (s.parties ?? []).map((p) => ({
        role: p.role,
        kind: p.kind,
        name: fence(p.name),
        shareBps: p.shareBps ?? null,
        kyc: p.kyc?.status ?? null,
        compliance: p.compliance?.status === "open" ? "Compliance review: open" : "Compliance review: none",
      })),
      steps: s.steps ?? [],
      approvals: (s.approvals ?? [])
        .filter((x) => x.status === "pending" || x.status === "open")
        .map((x) => ({
          id: x.id,
          gateLabel: x.gateLabel ?? x.title ?? "Compliance review",
          status: x.status,
          approverRole: x.approverRole ?? null,
        })),
      openTasks: (s.tasks ?? [])
        .filter((t) => t.status === "open")
        .map((t) => ({ id: t.id, title: fence(t.title), role: t.role })),
    });
  },
};
