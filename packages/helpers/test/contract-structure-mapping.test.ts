import { describe, expect, test } from "bun:test";
import { FakeLlm, type ChatMessage } from "@leasing/llm";
import {
  askModel,
  contextParty,
  mappingMessages,
  matchBlank,
  matchLabel,
  partyIn,
  proposeMappings,
  redactValues,
  resuggestBlanks,
  SHEET_KEYS,
  sheetExtras,
  sheetForPrompt,
  type TemplateBlank,
} from "../src/index.ts";

const noModel = () =>
  new FakeLlm(
    () => new Error("no decide"),
    undefined,
    () => {
      throw new Error("the model must not be asked");
    },
  );

describe("label matcher (code rules)", () => {
  // The labels from the Silverline screenshots and the usual synonyms, each with the expected key.
  const table: [string, "landlord" | "tenant" | null, string][] = [
    ["Landlord Nationality", null, "landlordNationality"],
    ["Landlord Phone", null, "landlordPhone"],
    ["Landlord representative", null, "leave_empty"],
    ["Date of contract", null, "contractOn"],
    ["Contract date", null, "contractOn"],
    ["Contract No.", null, "leaseRef"],
    ["Landlord Emirates ID", null, "landlordIdNo"],
    ["Owner name", null, "landlordNameEn"],
    ["Lessor", null, "landlordNameEn"],
    ["Lessee name", null, "tenantNameEn"],
    ["Tenant mobile", null, "tenantPhone"],
    ["Tenant e-mail", null, "tenantEmail"],
    ["Tenant EID", null, "tenantEmiratesIdNo"],
    ["Tenant trade licence no.", null, "tenantTradeLicenceNo"],
    ["Tenant passport number", null, "tenantPassportNo"],
    ["Landlord passport number", null, "landlordPassportNo"],
    ["Tenant date of birth", null, "tenantBirthDate"],
    ["Tenant address", null, "leave_empty"],
    ["Annual rent", null, "annualRentFils"],
    ["Security deposit", null, "depositFils"],
    ["Number of cheques", null, "cheques"],
    ["Cheque no.", null, "leave_empty"],
    ["Start date", null, "startOn"],
    ["Tenancy starts on", null, "startOn"],
    ["End date", null, "endOn"],
    ["Lease period", null, "tenancyPeriod"],
    ["Contract period", null, "tenancyPeriod"],
    ["Plot number", null, "plotNo"],
    ["Plot No", null, "plotNo"],
    ["Makani number", null, "makaniNo"],
    ["DEWA premises number", null, "dewaPremiseNo"],
    ["Premises no.", null, "dewaPremiseNo"],
    ["Building name", null, "building"],
    ["Community", null, "community"],
    ["Property number", null, "dldPropertyNo"],
    ["Unit No.", null, "unitNo"],
    ["Bedrooms", null, "bedrooms"],
    ["Property usage", null, "propertyUsage"],
    ["Area (sqft)", null, "areaSqft"],
    ["Area (sqm)", null, "leave_empty"],
    ["Occupants", null, "leave_empty"],
    ["Ejari number", null, "leave_empty"],
    ["Payment method", null, "leave_empty"],
    ["Rent-free days", null, "rentFreeDays"],
    ["Move-in date", null, "moveInOn"],
    // Party from the surrounding context for bare labels.
    ["Nationality", "landlord", "landlordNationality"],
    ["Nationality", "tenant", "tenantNationality"],
    ["Phone", "landlord", "landlordPhone"],
    ["Email", "tenant", "tenantEmail"],
    ["Name", "landlord", "landlordNameEn"],
  ];
  test.each(table)("%s (context %p) -> %s", (label, party, expected) => {
    expect(matchLabel(label, party)).toBe(expected);
  });

  test("never maps to Lease reference unless the label is about a reference or contract number", () => {
    for (const [label] of table) {
      if (matchLabel(label, null) === "leaseRef") expect(label).toMatch(/contract no|ref/i);
    }
    expect(matchLabel("Landlord Nationality", null)).not.toBe("leaseRef");
    expect(matchLabel("Date of contract", null)).not.toBe("startOn");
  });

  test("a bare detail label with no party is not guessed", () => {
    expect(matchLabel("Nationality", null)).toBeNull();
    expect(matchLabel("Phone", null)).toBeNull();
    expect(matchLabel("Something unusual", null)).toBeNull();
  });

  test("the party in the label wins over the context", () => {
    expect(matchLabel("Landlord Nationality", "tenant")).toBe("landlordNationality");
    expect(partyIn("Landlord / Tenant name")).toBeNull();
    expect(partyIn("Owner")).toBe("landlord");
    expect(partyIn("Lessee")).toBe("tenant");
  });

  test("party scoping from the nearest Landlord or Tenant line above the blank", () => {
    const lines = ["PARTIES", "Landlord (Owner)", "Nationality: {{b1}}", "Tenant", "Nationality: {{b2}}"];
    expect(contextParty(lines, 2)).toBe("landlord");
    expect(contextParty(lines, 4)).toBe("tenant");
    expect(contextParty(["Nationality: {{b1}}"], 0)).toBeNull();
    expect(matchBlank("Nationality", { before: "Nationality:", after: "" }, contextParty(lines, 2))).toBe(
      "landlordNationality",
    );
    expect(matchBlank("Nationality", { before: "Nationality:", after: "" }, contextParty(lines, 4))).toBe(
      "tenantNationality",
    );
  });

  test("the words before the blank are used when the label says nothing", () => {
    expect(matchBlank("Details", { before: "The annual rent is", after: "" }, null)).toBe("annualRentFils");
  });
});

const item = (id: string, label: string, over: Partial<{ before: string; after: string }> = {}) => ({
  id,
  label,
  before: over.before ?? label,
  after: over.after ?? "",
  party: null,
});

const answering = (answers: (calls: number, ids: string[]) => Record<string, string> | "garbage") => {
  let calls = 0;
  const llm = new FakeLlm(
    () => new Error("tev not used"),
    undefined,
    (messages: ChatMessage[]) => {
      calls++;
      const ids = messages[1]!.content
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .map((l) => (JSON.parse(l) as { id: string }).id);
      const a = answers(calls, ids);
      return a === "garbage" ? { nope: true } : { blanks: Object.entries(a).map(([id, key]) => ({ id, key })) };
    },
  );
  return { llm, calls: () => calls };
};

describe("model fallback for blanks code could not match", () => {
  test("a valid key is used and marked as suggested by the model", async () => {
    const { llm } = answering(() => ({ b1: "unitCode", b2: "none" }));
    const r = await askModel(llm, [item("b1", "Short code of the flat"), item("b2", "Remarks")]);
    expect(r.proposals.get("b1")).toEqual({ field: "unitCode", source: "model" });
    expect(r.proposals.get("b2")).toEqual({ field: "leave_empty", source: "empty" });
  });

  test("an invalid answer is asked once more, then the blank is left empty", async () => {
    const { llm, calls } = answering(() => ({ b1: "madeUpKey" }));
    const r = await askModel(llm, [item("b1", "Short code of the flat")]);
    expect(calls()).toBe(2);
    expect(r.proposals.get("b1")).toEqual({ field: "leave_empty", source: "empty" });
  });

  test("garbage output or a failing model leaves everything empty and never throws", async () => {
    const g = answering(() => "garbage");
    expect((await askModel(g.llm, [item("b1", "x")])).proposals.get("b1")?.field).toBe("leave_empty");
    const down = new FakeLlm(
      () => new Error("x"),
      undefined,
      () => {
        throw new Error("model down");
      },
    );
    expect((await askModel(down, [item("b1", "x")])).proposals.get("b1")?.field).toBe("leave_empty");
  });

  test("the second try can fix an invalid first answer", async () => {
    const { llm } = answering((n) => ({ b1: n === 1 ? "bogus" : "unitCode" }));
    const r = await askModel(llm, [item("b1", "Short code of the flat")]);
    expect(r.proposals.get("b1")).toEqual({ field: "unitCode", source: "model" });
  });

  test("a type-incompatible key is left empty", async () => {
    const { llm } = answering(() => ({ b1: "annualRentFils" }));
    const r = await askModel(llm, [item("b1", "Number of floors", { before: "Number of floors" })]);
    expect(r.proposals.get("b1")?.field).toBe("leave_empty");
  });

  test("the model is asked only about blanks code could not match", async () => {
    const r = await proposeMappings(noModel(), [
      { ...item("b1", "Annual rent"), known: null },
      { ...item("b2", "Landlord representative"), known: null },
    ]);
    expect(r.proposals.get("b1")).toEqual({ field: "annualRentFils", source: "matched" });
    expect(r.proposals.get("b2")).toEqual({ field: "leave_empty", source: "empty" });
  });

  test("a matched key of the wrong type for the blank is left empty, not used", async () => {
    const r = await proposeMappings(noModel(), [
      { ...item("b1", "Start date", { before: "Number of days" }), known: null },
    ]);
    expect(r.proposals.get("b1")?.field).toBe("leave_empty");
  });
});

describe("data sheet", () => {
  const records = {
    lease: { startOn: "2027-01-01", endOn: "2027-12-31", annualRentFils: 8_500_000 },
    unit: {
      code: "MRN-1204",
      dewaPremiseNo: "DEWA-77",
      areaSqft: 950,
      bathrooms: 2,
      floor: 12,
      furnished: true,
      subtype: "apartment",
    },
    company: { name: "Silverline Realty", tradeLicenceNo: "TL-1", email: "hello@silverline.test" },
    landlord: { birthDate: "1970-02-03", passportNo: "P9999999" },
    tenant: { birthDate: "1991-03-07", visaExpiresOn: "2028-01-01", passportNo: "Z1234567" },
    application: { ref: "A-ABC123", reservationFils: 100_000 },
  };

  test("keys are generated from the records and cover the contract fields and the tenancy period", () => {
    expect(SHEET_KEYS.annualRentFils).toBeDefined();
    for (const k of [
      "tenancyPeriod",
      "dewaPremiseNo",
      "areaSqft",
      "tenantBirthDate",
      "landlordPassportNo",
      "companyName",
    ]) {
      expect(SHEET_KEYS[k]).toBeDefined();
    }
    expect(SHEET_KEYS.tenancyPeriod!.type).toBe("text");
    expect(SHEET_KEYS.areaSqft!.type).toBe("int");
  });

  test("values are copied verbatim from the records; the tenancy period comes from the lease dates", () => {
    const e = sheetExtras(records);
    expect(e.tenancyPeriod).toBe("1 January 2027 to 31 December 2027");
    expect(e.dewaPremiseNo).toBe("DEWA-77");
    expect(e.areaSqft).toBe(950);
    expect(e.furnishing).toBe("Furnished");
    expect(e.tenantPassportNo ?? null).toBeNull(); // a contract field (legacy key), not an extra
    expect(e.landlordPassportNo).toBe("P9999999");
    expect(e.tenantBirthDate).toBe("1991-03-07");
    expect(e.companyName).toBe("Silverline Realty");
    expect(e.reservationFils).toBe(100_000);
    expect(sheetExtras({}).tenancyPeriod).toBeNull();
  });

  test("the mapper never sees a value: the prompt holds descriptions and the blank's own words only", async () => {
    const text = [sheetForPrompt(), ...mappingMessages([item("b1", "Plot")]).map((m) => m.content)].join("\n");
    for (const v of ["MRN-1204", "DEWA-77", "Z1234567", "P9999999", "1991-03-07", "Silverline Realty", "8500000"]) {
      expect(text).not.toContain(v);
    }
    // And the call that asks the model carries no record at all.
    let seen = "";
    const llm = new FakeLlm(
      () => new Error("x"),
      undefined,
      (m: ChatMessage[]) => {
        seen = m.map((x) => x.content).join("\n");
        return { blanks: [] };
      },
    );
    await askModel(llm, [item("b1", "Short code of the flat")]);
    expect(seen).not.toContain("MRN-1204");
  });
});

describe("re-suggest on a stored template", () => {
  const blank = (id: string, label: string, over: Partial<TemplateBlank> = {}): TemplateBlank => ({
    id,
    kind: "underscore",
    marker: "____",
    label,
    field: "unmapped",
    fieldType: null,
    role: "field",
    sectionIndex: 0,
    before: label,
    after: "",
    ...over,
  });
  test("maps by label and party, leaves the rest empty, keeps admin choices and signatures", async () => {
    const sections = {
      title: "Contract",
      items: [
        {
          heading: null,
          paragraphs: [
            "Landlord",
            "Nationality: {{b1}}",
            "Tenant",
            "Nationality: {{b2}}",
            "Representative: {{b3}}",
            "Sign {{b4}}",
            "Date {{b5}}",
          ],
        },
      ],
    };
    const blanks = [
      blank("b1", "Nationality"),
      blank("b2", "Nationality"),
      blank("b3", "Representative"),
      blank("b4", "Landlord signature", { role: "signature" }),
      blank("b5", "Date of contract", { field: "startOn", fieldType: "date", source: "admin" }),
    ];
    const r = await resuggestBlanks(noModel(), sections, blanks);
    expect(r.blanks.map((b) => b.field)).toEqual([
      "landlordNationality",
      "tenantNationality",
      "leave_empty",
      "unmapped",
      "startOn",
    ]);
    expect(r.blanks[0]!.source).toBe("matched");
    expect(r.blanks[2]!.source).toBe("empty");
    expect(r.changed).toBe(3);
  });
});

describe("filled samples never leak values to the model (rule 8)", () => {
  test("personal data and amounts in the blank's surrounding words are replaced by [value]", async () => {
    let seen = "";
    const llm = new FakeLlm(
      () => new Error("x"),
      undefined,
      (m: ChatMessage[]) => {
        seen = m.map((x) => x.content).join("\n");
        return { blanks: [] };
      },
    );
    await askModel(llm, [
      {
        id: "b1",
        label: "Remarks",
        before: "Ahmed 784-1980-1234567-1 mail a@b.example paid AED 120,000 on 01 November 2026 tel +971 50 123 4567",
        after: "passport Z1234567",
        party: null,
      },
    ]);
    for (const v of ["784-1980", "a@b.example", "120,000", "01 November 2026", "+971 50", "Z1234567"]) {
      expect(seen).not.toContain(v);
    }
    expect(seen).toContain("[value]");
    expect(redactValues("Rent is due monthly")).toBe("Rent is due monthly");
  });
});
