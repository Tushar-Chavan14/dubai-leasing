import { describe, expect, test } from "bun:test";
import { FakeLlm } from "@platform/llm";
import { fitsBlank, matchPlaceholder, proposeMappings } from "@platform/readers/structure/mapping";
import { partyBlocks, signatureRoles, spaTemplateProfile as P } from "../src/template/profile.ts";

const blank = (before = "", after = "") => ({ before, after });

describe("SPA data sheet through the reader", () => {
  test("plain keys are keys; bps and table keys read as text", () => {
    expect(P.sheet.isKey("purchaser_name")).toBe(true);
    expect(P.sheet.keyInfo("price")?.type).toBe("money_fils");
    expect(P.sheet.keyInfo("purchaser_share")?.type).toBe("text");
    expect(P.sheet.keyInfo("payment_plan")?.type).toBe("text");
  });

  test("numbered instalment keys are keys; the literal _n_ is not", () => {
    expect(P.sheet.isKey("instalment_3_amount")).toBe(true);
    expect(P.sheet.keyInfo("instalment_3_due")?.type).toBe("date");
    expect(P.sheet.isKey("instalment_n_amount")).toBe(false);
    expect(P.sheet.isKey("instalment_0_amount")).toBe(false);
    expect(P.sheet.isKey("instalment_61_amount")).toBe(false);
  });

  test("party slot keys 1 to 10 on repeat keys only", () => {
    expect(P.sheet.isKey("purchaser_name_2")).toBe(true);
    expect(P.sheet.isKey("seller_share_10")).toBe(true);
    expect(P.sheet.isKey("purchaser_name_11")).toBe(false);
    expect(P.sheet.isKey("price_2")).toBe(false);
    expect(P.sheet.keyInfo("purchaser_name_2")?.label).toBe("Purchaser 2 full name");
  });

  test("the prompt key list names descriptions, never the literal _n_ key", () => {
    const list = P.sheet.forPrompt();
    expect(list).toContain("purchaser_name | text | Purchaser full name");
    expect(list).toContain("instalment_<n>_amount");
    expect(list).not.toContain("instalment_n_amount");
  });
});

describe("label rules", () => {
  const m = (label: string, party: string | null = null) => P.matchLabel(label, party);
  test("party-scoped keys", () => {
    expect(m("Name", "purchaser")).toBe("purchaser_name");
    expect(m("Name", "seller")).toBe("seller_name");
    expect(m("Purchaser nationality")).toBe("purchaser_nationality");
    expect(m("Buyer passport number")).toBe("purchaser_passport_no");
    expect(m("Emirates ID", "purchaser")).toBe("purchaser_eid_no");
    expect(m("Emirates ID", "seller")).toBe("seller_id_no");
    expect(m("Vendor trade licence no")).toBe("seller_licence_no");
    expect(m("Authorised signatory name", "seller")).toBe("seller_signatory_name");
    expect(m("Share", "purchaser")).toBe("purchaser_share");
    expect(m("Purchaser trade licence no")).toBe("purchaser_licence_no");
    expect(m("Authorised signatory name", "purchaser")).toBe("purchaser_signatory_name");
    expect(m("Signatory title", "purchaser")).toBe("purchaser_signatory_title");
    expect(m("Name")).toBeNull();
  });
  test("broker keys", () => {
    expect(m("Agency name", "broker")).toBe("broker_agency");
    expect(m("ORN")).toBe("broker_orn");
    expect(m("Broker BRN")).toBe("broker_brn");
    expect(m("Agent name", "broker")).toBe("broker_agent_name");
    expect(m("Commission", "broker")).toBe("broker_commission");
  });
  test("unit, money, resale and dates", () => {
    expect(m("Unit no.")).toBe("unit_no");
    expect(m("Project")).toBe("project_name");
    expect(m("Area (sq ft)")).toBe("area_sqft");
    expect(m("Purchase price")).toBe("price");
    expect(m("Purchase price in words")).toBe("price_words");
    expect(m("DLD registration fee")).toBe("dld_fee");
    expect(m("Oqood fee")).toBe("oqood_fee");
    expect(m("Booking amount")).toBe("booking_amount");
    expect(m("Security deposit")).toBe("deposit_amount");
    expect(m("Title deed number")).toBe("title_deed_no");
    expect(m("NOC reference")).toBe("noc_ref");
    expect(m("Transfer date")).toBe("transfer_date");
    expect(m("Date of this agreement")).toBe("agreement_date");
    expect(m("Anticipated completion date")).toBe("anticipated_completion");
    expect(m("Instalment 3 amount")).toBe("instalment_3_amount");
    expect(m("3rd instalment due date")).toBe("instalment_3_due");
    expect(m("Instalment 99 amount")).toBeNull();
  });
});

describe("parties", () => {
  test("a seller blank never takes a purchaser key, by code, the model's answer included", () => {
    expect(P.keyFitsParty?.("purchaser_name", "seller")).toBe(false);
    expect(P.keyFitsParty?.("seller_name_2", "purchaser")).toBe(false);
    expect(P.keyFitsParty?.("broker_orn", "purchaser")).toBe(false);
    expect(P.keyFitsParty?.("price", "seller")).toBe(true);
    expect(P.keyFitsParty?.("purchaser_name", null)).toBe(true);
    expect(fitsBlank("purchaser_name", "Name", { ...blank("Seller: "), party: "seller" }, P)).toBe(false);
  });

  test("the model's cross-party key is refused", async () => {
    const llm = new FakeLlm(
      () => new Error("no decide"),
      undefined,
      () => ({ blanks: [{ id: "b1", key: "purchaser_name" }] }),
    );
    const { proposals } = await proposeMappings(
      llm,
      [{ id: "b1", label: "Party details", before: "SELLER ", after: "", party: "seller" }],
      P,
    );
    expect(proposals.get("b1")).toEqual({ field: "leave_empty", source: "empty" });
  });

  test("placeholders by alias and own name", () => {
    expect(matchPlaceholder("buyer name", P)).toBe("purchaser_name");
    expect(matchPlaceholder("purchaser_name", P)).toBe("purchaser_name");
    expect(matchPlaceholder("Unit No", P)).toBe("unit_no");
    expect(matchPlaceholder("payment_plan", P)).toBe("payment_plan");
    expect(matchPlaceholder("favourite colour", P)).toBeNull();
  });

  test("numbered party blocks give slot keys; unnumbered stays repeatable; beyond 10 empties", () => {
    const texts = [
      "PURCHASER 1",
      "Name: {{b1}} Nationality: {{b2}}",
      "Second Purchaser",
      "Name: {{b3}}",
      "SELLER",
      "Name: {{b4}}",
      "The sale price is AED {{b5}}",
      "Purchaser 11 name: {{b6}}",
    ];
    const blanks = [
      ["b1", "purchaser_name"],
      ["b2", "purchaser_nationality"],
      ["b3", "purchaser_name"],
      ["b4", "seller_name"],
      ["b5", "price"],
      ["b6", "purchaser_name"],
    ].map(([id, field]) => ({ id: id!, field: field!, label: "x", fieldType: "text", role: "field" }));
    const out = P.afterMapping!(texts, blanks);
    expect(out.map((b) => b.field)).toEqual([
      "purchaser_name_1",
      "purchaser_nationality_1",
      "purchaser_name_2",
      "seller_name",
      "price",
      "leave_empty",
    ]);
  });

  test("partyBlocks reports roles and numbered slots", () => {
    expect(partyBlocks(["PURCHASER 1", "Purchaser 2", "THE SELLER", "Broker: {{b1}}"])).toEqual([
      { role: "seller", slots: [] },
      { role: "purchaser", slots: [1, 2] },
      { role: "broker", slots: [] },
    ]);
  });

  test("signature roles from the label, else the words before it", () => {
    const roles = signatureRoles([
      { id: "b1", role: "signature", label: "Purchaser signature", before: "" },
      { id: "b2", role: "signature", label: "Signature", before: "Signed by the Seller\n" },
      { id: "b3", role: "signature", label: "Witness", before: "" },
      { id: "b4", role: "field", label: "Name", before: "Seller" },
    ]);
    expect(roles).toEqual({ b1: "purchaser", b2: "seller", b3: null });
  });
});
