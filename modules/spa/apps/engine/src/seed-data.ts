import type { SpaRole } from "@spa/core";

/** One fictional demo user per SPA role (S3). Names and emails are made up; `.test` never delivers mail. */
export const DEMO_USERS: readonly { email: string; name: string; role: SpaRole }[] = [
  { email: "officer@spa-demo.test", name: "Rania Officer", role: "sales_officer" },
  { email: "manager@spa-demo.test", name: "Karim Manager", role: "sales_manager" },
  { email: "salesadmin@spa-demo.test", name: "Lina Salesadmin", role: "sales_admin" },
  { email: "legal@spa-demo.test", name: "Omar Legal", role: "legal" },
  { email: "compliance@spa-demo.test", name: "Sara Compliance", role: "compliance_officer" },
  { email: "mlro@spa-demo.test", name: "Yusuf Mlro", role: "mlro" },
  { email: "finance@spa-demo.test", name: "Huda Finance", role: "finance" },
  { email: "admin@spa-demo.test", name: "Adam Admin", role: "admin" },
];

/**
 * One fictional agreement for the demo's Settings → Templates (C34, S66): what the template reader would return for a
 * short sample with blanks, so legal has a version waiting in its inbox. Invented wording; no real party, number or logo.
 */
export const DEMO_TEMPLATE = {
  name: "Standard sale agreement [SAMPLE]",
  data: {
    sections: {
      numbering: "decimal" as const,
      title: "SALE AND PURCHASE AGREEMENT [SAMPLE]",
      items: [
        {
          id: "s1",
          number: "1.",
          heading: "PARTIES",
          paragraphs: ["SELLER", "Name: {{b1}}", "PURCHASER", "Name: {{b2}}"],
        },
        {
          id: "s2",
          number: "2.",
          heading: "PROPERTY AND PRICE",
          paragraphs: ["Unit no: {{b3}}", "The price is AED {{b4}}.", "The registration fee is AED {{b5}}."],
        },
        { id: "s3", number: "3.", heading: "SIGNATURES", paragraphs: ["Seller: {{b6}}", "Purchaser: {{b7}}"] },
      ],
    },
    blanks: [
      ["b1", "Name", "seller_name", "Name: "],
      ["b2", "Name", "purchaser_name", "Name: "],
      ["b3", "Unit no", "unit_no", "Unit no: "],
      ["b4", "Price", "price", "The price is AED "],
      ["b5", "Registration fee", "dld_fee", "The registration fee is AED "],
    ]
      .map(([id, label, field, before]) => ({
        id: id!,
        kind: "underscore" as const,
        marker: "____________",
        label: label!,
        field: field!,
        source: "matched" as const,
        fieldType: field === "price" || field === "dld_fee" ? ("money_fils" as const) : ("text" as const),
        role: "field" as const,
        sectionIndex: 0,
        before: before!,
        after: "",
      }))
      .concat(
        ["b6", "b7"].map((id, i) => ({
          id,
          kind: "underscore" as const,
          marker: "____________",
          label: "Signature",
          field: "unmapped",
          source: "matched" as const,
          fieldType: null as never,
          role: "signature" as const,
          sectionIndex: 2,
          before: `${i === 0 ? "Seller" : "Purchaser"}: `,
          after: "",
        })) as never,
      ),
  },
};
