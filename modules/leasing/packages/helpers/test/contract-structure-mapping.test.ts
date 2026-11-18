import { describe, expect, test } from "bun:test";
import { FakeLlm, type ChatMessage } from "@platform/llm";
import {
  matchAfter,
  matchBlank as matchBlankRule,
  matchLabel as matchLabelRule,
  askModel,
  contextParty,
  mappingMessages,
  matchBlank,
  matchLabel,
  numberChequeDateRuns,
  partyIn,
  proposeMappings,
  redactValues,
  resuggestBlanks,
  SHEET_KEYS,
  sheetExtras,
  sheetForPrompt,
  type TemplateBlank,
  validateMapping,
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
    ["Cheque amount", null, "chequeAmountFils"],
    ["Amount per cheque", null, "chequeAmountFils"],
    ["4 cheques of", null, "chequeAmountFils"],
    ["Cheque dates", null, "chequeDates"],
    ["First cheque date", null, "chequeDate1"],
    ["Second cheque date", null, "chequeDate2"],
    ["Twelfth cheque date", null, "chequeDate12"],
    ["Cheque date 3", null, "chequeDate3"],
    ["4th cheque date", null, "chequeDate4"],
    ["Cheque date 13", null, "leave_empty"],
    ["Ejari registration fee", null, "registrationFeeFils"],
    ["Ejari fee", null, "registrationFeeFils"],
    ["Tawtheeq registration fee", null, "registrationFeeFils"],
    ["Registration fee", null, "registrationFeeFils"],
    ["Ejari fee paid by", null, "registrationFeePayer"],
    ["Other fees", null, "feesSummary"],
    ["Additional fees", null, "feesSummary"],
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

  const FEES = [
    {
      id: "any",
      name: "Any registration fee",
      kind: "registration",
      amountFils: 10_000,
      payer: "landlord",
      emirates: [],
    },
    {
      id: "dxb",
      name: "Ejari registration fee",
      kind: "registration",
      amountFils: 22_000,
      payer: "tenant",
      emirates: ["dubai"],
    },
    { id: "ag", name: "Agency fee", kind: "other", amountFils: 100_000, payer: "tenant", emirates: [] },
  ];

  test("cheque and registration fee keys come from the payment schedule and the company row", () => {
    const four = sheetExtras({
      ...records,
      lease: { startOn: "2027-01-01", endOn: "2027-12-31", annualRentFils: 8_500_000, cheques: 4 },
      unit: { emirate: "dubai" },
      company: { contractFees: FEES },
    });
    expect(four.chequeAmountFils).toBe(2_125_000);
    expect(four.chequeDate1).toBe("2027-01-01");
    expect(four.chequeDate4).toBe("2027-10-01");
    expect(four.chequeDate5).toBeNull();
    expect(four.chequeDates).toBe("1 January 2027 | 1 April 2027 | 1 July 2027 | 1 October 2027");
    // The Dubai-specific registration fee beats the any-emirate one; other fees are summarised.
    expect(four.registrationFeeFils).toBe(22_000);
    expect(four.registrationFeePayer).toBe("Tenant");
    expect(four.feesSummary).toBe("Agency fee AED 1,000 (tenant)");
    expect(four.allFeesList).toBe(
      "Any registration fee AED 100 (landlord)\nEjari registration fee AED 220 (tenant)\nAgency fee AED 1,000 (tenant)",
    );
    // Abu Dhabi: the any-emirate registration fee; the Dubai one doesn't apply.
    const ad = sheetExtras({ ...records, unit: { emirate: "abu_dhabi" }, company: { contractFees: FEES } });
    expect(ad.registrationFeeFils).toBe(10_000);
    expect(ad.registrationFeePayer).toBe("Landlord");
    // No unit emirate: only the any-emirate fees.
    expect(sheetExtras({ ...records, company: { contractFees: FEES } }).registrationFeeFils).toBe(10_000);
    // Unequal instalments (remainder fils): no single amount.
    const uneven = sheetExtras({ ...records, lease: { ...records.lease, annualRentFils: 8_500_001, cheques: 4 } });
    expect(uneven.chequeAmountFils).toBeNull();
    expect(uneven.chequeDate2).toBe("2027-04-01");
    // No cheque info on the lease: nothing.
    const none = sheetExtras(records);
    expect(none.chequeDate1).toBeNull();
    expect(none.chequeDates).toBeNull();
    expect(none.registrationFeeFils).toBeNull();
    expect(none.registrationFeePayer).toBeNull();
    expect(none.feesSummary).toBeNull();
    expect(SHEET_KEYS.chequeDate12!.type).toBe("date");
    expect(SHEET_KEYS.chequeAmountFils!.type).toBe("money_fils");
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

describe("cheque and Ejari fee blanks pass the type check", () => {
  const raw = { before: "", after: "" } as never;
  const cases: [string, string][] = [
    ["First cheque date", "chequeDate1"],
    ["Cheque date 3", "chequeDate3"],
    ["Cheque dates", "chequeDates"],
    ["Cheque amount", "chequeAmountFils"],
    ["Ejari registration fee", "registrationFeeFils"],
    ["Other fees", "feesSummary"],
    ["Ejari fee paid by", "registrationFeePayer"],
  ];
  test.each(cases)("%s -> %s", (label, key) => {
    expect(validateMapping(key, label, raw).field).toBe(key);
  });
  test("the cheque count is still a count", () => {
    expect(validateMapping("cheques", "Number of cheques", raw).field).toBe("cheques");
  });
});

describe("D70: a row of cheque-date blanks is numbered by position", () => {
  const b = (id: string, field: string, label: string) => ({ id, field, label, fieldType: "date", role: "field" });
  test("the first blank labelled 'Cheque dates' becomes cheque 1, the rest follow", () => {
    const out = numberChequeDateRuns(
      ["Cheque Dates {{b46}} | {{b47}} | {{b48}} | {{b49}} Security Deposit {{b30}}"],
      [
        b("b46", "chequeDates", "Cheque dates"),
        b("b47", "chequeDate1", "First cheque date"),
        b("b48", "chequeDate2", "Second cheque date"),
        b("b49", "chequeDate3", "Third cheque date"),
        { ...b("b30", "depositFils", "Security deposit"), fieldType: "money_fils" },
      ],
    );
    expect(out.map((x) => x.field)).toEqual([
      "chequeDate1",
      "chequeDate2",
      "chequeDate3",
      "chequeDate4",
      "depositFils",
    ]);
  });
  test("a blank left empty but labelled as a cheque date joins its row", () => {
    const out = numberChequeDateRuns(
      ["Cheque Dates {{b47}} | {{b48}} | {{b49}}"],
      [
        b("b47", "leave_empty", "First cheque date"),
        b("b48", "chequeDate2", "Second cheque date"),
        b("b49", "chequeDate3", "Third cheque date"),
      ],
    );
    expect(out.map((x) => x.field)).toEqual(["chequeDate1", "chequeDate2", "chequeDate3"]);
  });
  test("a single 'cheque dates' blank keeps the whole list; a run with another key is left alone", () => {
    const one = numberChequeDateRuns(["Cheque Dates {{b1}}"], [b("b1", "chequeDates", "Cheque dates")]);
    expect(one[0]!.field).toBe("chequeDates");
    const mixed = numberChequeDateRuns(
      ["{{b1}} | {{b2}}"],
      [b("b1", "chequeDates", "Cheque dates"), b("b2", "startOn", "Start")],
    );
    expect(mixed.map((x) => x.field)).toEqual(["chequeDates", "startOn"]);
  });
});

describe("D70: unit labels that are not the unit number", () => {
  test("description, unit code and property type map to their own keys", () => {
    expect(matchLabel("Unit description", null)).toBe("unitDescription");
    expect(matchLabel("Unit code", null)).toBe("unitCode");
    expect(matchLabel("Property type", null)).toBe("propertySubtype");
    expect(matchLabel("Unit number", null)).toBe("unitNo");
  });
});

describe("words after a blank and bare 'type' (eval finding, 2026-11-18)", () => {
  test("a count of cheques is read from the words right after the blank", () => {
    expect(matchAfter(" cheques.")).toBe("cheques");
    expect(matchAfter("__ post-dated cheques of AED")).toBe("cheques");
    expect(matchAfter(" PDCs")).toBe("cheques");
    expect(matchAfter(" payable in ____ cheques.")).toBeNull();
    expect(matchAfter(" days")).toBeNull();
    expect(matchAfter("")).toBeNull();
  });
  test("the after-words beat a label that names nothing we store, never a label that names a field", () => {
    const b = { before: "The annual rent is AED ____ payable in ", after: " cheques." };
    expect(matchBlankRule("Payment method type", b, null)).toBe("cheques");
    expect(matchBlankRule("Number of cheques", b, null)).toBe("cheques");
    const rent = { before: "The annual rent is AED ", after: " cheques." };
    expect(matchBlankRule("Annual rent", rent, null)).toBe("annualRentFils");
    expect(matchBlankRule("Payment method", { before: "Paid by ", after: " transfer" }, null)).toBe("leave_empty");
  });
  test("a bare 'type' is not the property subtype; a property's type still is", () => {
    expect(matchLabelRule("Payment type", null)).not.toBe("propertySubtype");
    expect(matchLabelRule("ID type", "tenant")).not.toBe("propertySubtype");
    expect(matchLabelRule("Property type", null)).toBe("propertySubtype");
    expect(matchLabelRule("Unit subtype", null)).toBe("propertySubtype");
    expect(matchLabelRule("Subtype", null)).toBe("propertySubtype");
    expect(matchLabelRule("Category", null)).toBe("propertySubtype");
  });
});
