import { describe, expect, test } from "bun:test";
import { FakeLlm } from "@platform/llm";
import {
  contextParty,
  type KycProfile,
  kycHelper,
  leasingKycProfile,
  leasingTemplateProfile,
  mappingMessages,
  matchPlaceholder,
  partyIn,
  proposeMappings,
  readPrompt,
  structureMessages,
  type TemplateProfile,
} from "../src/index.ts";
import { GOLDEN, profileCases } from "./profile-cases.ts";

// S4 (P1): shared helpers take a profile; leasing callers pass none and must get exactly what they got before.
describe("leasing default profile", () => {
  test("KYC reader and contract-structure reader give the recorded prompts and results", async () => {
    const golden = (await Bun.file(GOLDEN).json()) as unknown;
    expect(await profileCases()).toEqual(golden);
  });
  test("passing the leasing profile explicitly is the same as passing none", () => {
    expect(readPrompt("passport", undefined, leasingKycProfile)).toBe(readPrompt("passport"));
    expect(mappingMessages([], "n", leasingTemplateProfile)).toEqual(mappingMessages([], "n"));
    expect(partyIn("the Lessor", leasingTemplateProfile)).toBe(partyIn("the Lessor"));
  });
});

/** A fictional sales-style profile: shows the words come from the profile, not from leasing. */
const salesKyc: KycProfile = {
  helperName: "sample_kyc",
  orgNoun: "sales company",
  partyNoun: "buyer",
  documents: { passport: "a passport data page", title_deed: "a property title deed" },
  documentLabels: { passport: "passport", title_deed: "title deed" },
  mrzKeys: [],
  aiCheckSubject: "a sales company set for client documents",
};
const sheet = new Map([
  ["purchaserNameEn", { type: "text" as const, label: "Purchaser full name" }],
  ["sellerNameEn", { type: "text" as const, label: "Seller full name" }],
  ["priceFils", { type: "money_fils" as const, label: "Sale price" }],
]);
const salesTemplate: TemplateProfile = {
  helperName: "sample_structure",
  structureIntro: "You read a company's sample sale and purchase agreement.",
  labelExamples: '"Sale price", "Purchaser nationality"',
  mappingIntro: "You match blanks of a sale agreement template to the data the system holds.",
  partyKeyRule: "A seller blank never takes a purchaser key and the other way round.",
  parties: [
    { role: "seller", words: ["seller", "vendor"] },
    { role: "purchaser", words: ["purchaser", "buyer"] },
  ],
  sheet: {
    isKey: (k) => sheet.has(k),
    keyNames: [...sheet.keys()],
    keyInfo: (k) => sheet.get(k) ?? null,
    forPrompt: () => [...sheet].map(([k, v]) => `${k} | ${v.type} | ${v.label}`).join("\n"),
  },
  placeholderAliases: { buyername: "purchaserNameEn", price: "priceFils" },
  labelWords: new Set(["seller", "purchaser", "price", "name"]),
  matchLabel: (label, party) =>
    /\bname\b/i.test(label) && party ? `${party}NameEn` : /\bprice\b/i.test(label) ? "priceFils" : null,
};

describe("another module's profile", () => {
  test("KYC prompt, helper name and labels come from the profile", async () => {
    expect(readPrompt("title_deed", undefined, salesKyc)).toStartWith("This image should be a property title deed.");
    expect(readPrompt("custom", { name: "NOC", description: "", hasExpiry: true }, salesKyc)).toContain(
      "a document the sales company calls",
    );
    expect(readPrompt("passport", undefined, salesKyc)).not.toContain("MRZ");
    const helper = kycHelper(
      new FakeLlm(
        () => new Error("no decide"),
        () => new Error("down"),
      ),
      async () => new Uint8Array([1]),
      { profile: salesKyc },
    );
    expect(helper.name).toBe("sample_kyc");
    const r = await helper.run({
      runId: "r",
      entity: { kind: "deal", id: "d" },
      step: "kyc",
      context: {
        applicant: { nameEn: "Sample Buyer", kind: "individual" },
        leaseStartOn: "2027-01-01",
        today: "2026-11-01",
        minValidityDays: 30,
        minConfidence: 0.8,
        documents: [{ docId: "p", kind: "passport", side: "page" }],
      } as never,
      rulesVersion: "x",
      now: "2026-11-01T06:00:00Z",
    });
    expect(r.status).toBe("needs_human");
    expect(r.reasons[0]).toContain("Reading the passport failed twice");
  });

  test("parties, keys, aliases and prompt wording come from the profile", async () => {
    expect(partyIn("The Vendor", salesTemplate)).toBe("seller");
    expect(partyIn("buyers", salesTemplate)).toBe("purchaser");
    expect(partyIn("seller and buyer", salesTemplate)).toBeNull();
    expect(partyIn("The Landlord", salesTemplate)).toBeNull();
    expect(contextParty(["Between the Seller", "and the Purchaser", "Name: {{b1}}"], 2, 6, salesTemplate)).toBe(
      "purchaser",
    );
    expect(matchPlaceholder("Buyer Name", salesTemplate)).toBe("purchaserNameEn");
    expect(matchPlaceholder("tenant name", salesTemplate)).toBeNull();
    const m = mappingMessages(
      [{ id: "b1", label: "Name", before: "", after: "", party: "seller" }],
      "n",
      salesTemplate,
    );
    expect(m[0]!.content).toStartWith("You match blanks of a sale agreement template");
    expect(m[0]!.content).toContain("A seller blank never takes a purchaser key");
    expect(m[0]!.content).toContain("priceFils | money_fils | Sale price");
    expect(m[0]!.content).not.toContain("landlord");
    const s = structureMessages(["SALE AGREEMENT"], [], "n", salesTemplate);
    expect(s[0]!.content).toStartWith("You read a company's sample sale and purchase agreement.");
    expect(s[0]!.content).toContain('"Purchaser nationality"');
    const llm = new FakeLlm(
      () => new Error("no decide"),
      undefined,
      () => ({ blanks: [{ id: "x", key: "tenantNameEn" }] }),
    );
    const { proposals } = await proposeMappings(
      llm,
      [
        { id: "a", label: "Name", before: "Name: ", after: "", party: "seller" },
        { id: "p", label: "Sale price", before: "Sale price: ", after: "", party: null },
        { id: "x", label: "Something", before: "", after: "", party: null },
      ],
      salesTemplate,
    );
    expect(proposals.get("a")).toEqual({ field: "sellerNameEn", source: "matched" });
    expect(proposals.get("p")).toEqual({ field: "priceFils", source: "matched" });
    // A leasing key is not in this profile's sheet: never accepted.
    expect(proposals.get("x")).toEqual({ field: "leave_empty", source: "empty" });
  });
});
