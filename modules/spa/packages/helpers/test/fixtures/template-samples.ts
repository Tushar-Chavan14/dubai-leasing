import { runHelper } from "@platform/kernel/helper-runner";
import { type ChatMessage, FakeLlm } from "@platform/llm";
import { ContractStructureSchemas } from "@platform/readers/structure/schema";
import { generatePdf, type Spec } from "@platform/readers/testing/sample-pdf";
import { spaTemplateHelper } from "../../src/index.ts";

/** Fictional SPA templates; nothing here is a real company or person. */
export const U = "____________________";
const base = { serif: true, size: [595, 842] as [number, number], accent: [20, 60, 110] as [number, number, number] };

export interface Sample {
  spec: Spec;
  /** A blank whose last 30 characters before it contain `near` maps to `field`; `label` is what the model calls it. */
  maps: { near: string; label: string; field: string }[];
  /** Strings in the sample that must never reach a model. */
  secrets: string[];
  slots?: number[];
}

export const SAMPLES: Sample[] = [
  {
    spec: {
      ...base,
      id: "articles-slots",
      leftMargin: 60,
      title: "SALE AND PURCHASE AGREEMENT",
      intro: ["This agreement is made between the parties below."],
      sections: [
        {
          heading: "ARTICLE 1 PARTIES",
          lines: [
            "SELLER",
            `Name: ${U}`,
            `Trade licence no: ${U}`,
            "PURCHASER 1",
            `Name: ${U}`,
            `Nationality: ${U}`,
            "PURCHASER 2",
            `Name: ${U}`,
            "BROKER",
            `Agency name: ${U}`,
            `ORN: ${U}`,
          ],
        },
        { heading: "ARTICLE 2 PROPERTY", lines: [`Unit no: ${U}`, `Building: ${U}`] },
        { heading: "ARTICLE 3 PRICE", lines: ["The purchase price is AED ______________."] },
        { heading: "ARTICLE 4 SIGNATURES", lines: [`Seller signature: ${U}`, `Purchaser signature: ${U}`] },
      ],
    },
    maps: [
      { near: "Trade licence no:", label: "Trade licence no", field: "seller_licence_no" },
      { near: "Nationality:", label: "Nationality", field: "purchaser_nationality_1" },
      { near: "Agency name:", label: "Agency name", field: "broker_agency" },
      { near: "ORN:", label: "ORN", field: "broker_orn" },
      { near: "Unit no:", label: "Unit no", field: "unit_no" },
      { near: "Building:", label: "Building", field: "building" },
      { near: "price is AED", label: "Purchase price", field: "price" },
    ],
    secrets: [],
    slots: [1, 2],
  },
  {
    spec: {
      ...base,
      serif: false,
      id: "decimal-plan",
      leftMargin: 50,
      title: "OFF-PLAN SALE AGREEMENT",
      intro: ["Sample prepared by Example Homes LLC for jane.example@example.com on 12/03/2026."],
      sections: [
        {
          heading: "1. THE PARTIES",
          lines: [`1.1 Seller name: ${U}`, `1.2 Purchaser name: ${U}`, `1.3 Purchaser passport number: ${U}`],
        },
        {
          heading: "2. PAYMENT",
          lines: [
            "2.1 The purchase price is AED ______________.",
            `2.2 Instalment 1 amount: AED ${U}`,
            `2.3 Instalment 1 due date: ${U}`,
            `2.4 DLD registration fee: AED ${U}`,
          ],
        },
        { heading: "3. COMPLETION", lines: [`3.1 Anticipated completion date: ${U}`] },
      ],
    },
    maps: [
      { near: "Seller name:", label: "Seller name", field: "seller_name" },
      { near: "1.2 Purchaser name:", label: "Purchaser name", field: "purchaser_name" },
      { near: "passport number:", label: "Purchaser passport number", field: "purchaser_passport_no" },
      { near: "price is AED", label: "Purchase price", field: "price" },
      { near: "Instalment 1 amount: AED", label: "Instalment 1 amount", field: "instalment_1_amount" },
      { near: "Instalment 1 due date:", label: "Instalment 1 due date", field: "instalment_1_due" },
      { near: "registration fee: AED", label: "DLD registration fee", field: "dld_fee" },
      { near: "completion date:", label: "Anticipated completion date", field: "anticipated_completion" },
    ],
    secrets: ["jane.example@example.com", "12/03/2026"],
  },
  {
    spec: {
      ...base,
      id: "placeholders",
      leftMargin: 60,
      title: "MEMORANDUM OF UNDERSTANDING",
      intro: ["Dated {agreement date}."],
      sections: [
        { heading: "Article 1 Seller", lines: ["The Seller {seller_name} sells the unit {unit no}."] },
        {
          heading: "Article 2 Buyer",
          lines: ["The Buyer {purchaser_name}, of {buyer nationality} nationality, buys it."],
        },
        { heading: "Article 3 Price", lines: ["The price is {sale price}, paid as per {payment_plan}."] },
      ],
    },
    maps: [
      { near: "Dated", label: "Agreement date", field: "agreement_date" },
      { near: "The Seller", label: "Seller name", field: "seller_name" },
      { near: "sells the unit", label: "Unit no", field: "unit_no" },
      { near: "The Buyer", label: "Purchaser name", field: "purchaser_name" },
      { near: "of", label: "Purchaser nationality", field: "purchaser_nationality" },
      { near: "The price is", label: "Sale price", field: "price" },
      { near: "paid as per", label: "Payment plan", field: "payment_plan" },
    ],
    secrets: [],
  },
];

const nearOf = (s: Sample, before: string) => s.maps.find((m) => before.slice(-30).includes(m.near));

/** A model that answers like a careful one: labels from the words before a blank, keys only when asked. */
export function fakeFor(s: Sample) {
  return new FakeLlm(
    () => new Error("no decide"),
    undefined,
    (messages: ChatMessage[]) => {
      const user = messages.find((m) => m.role === "user")!.content;
      if (messages[0]!.content.includes("match blanks of a company's property sale agreement template")) {
        const asked = user
          .split("\n")
          .filter((l) => l.startsWith("{"))
          .map((l) => JSON.parse(l) as { id: string; before: string });
        return { blanks: asked.map((c) => ({ id: c.id, key: nearOf(s, c.before)?.field ?? "none" })) };
      }
      const ctxs = user
        .split("BLANK CONTEXTS (JSON lines):\n")[1]!
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .map((l) => JSON.parse(l) as { id: string; before: string });
      return {
        sections: s.spec.sections.map((x) => ({ heading: x.heading })),
        blanks: ctxs.map((c) => {
          const m = nearOf(s, c.before);
          return { id: c.id, label: m?.label ?? (/signature/i.test(c.before) ? "Signature" : "Name") };
        }),
      };
    },
  );
}

export async function read(s: Sample, rendered?: Uint8Array) {
  const llm = fakeFor(s);
  const bytes = rendered ?? (await generatePdf(s.spec));
  const rec = await runHelper(
    spaTemplateHelper(llm, { readFile: async () => bytes }),
    {
      runId: "r1",
      entity: { kind: "company", id: "c1" },
      step: "spa_template",
      context: { docId: "d1" },
      rulesVersion: "dubai-sales-test",
      now: "2026-11-19T00:00:00Z",
    },
    ContractStructureSchemas,
    () => 0,
  );
  return { llm, rec };
}
