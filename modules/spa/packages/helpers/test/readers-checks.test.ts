import { describe, expect, test } from "bun:test";
import type { CalendarDate } from "@platform/kernel/dates";
import {
  companyChecks,
  type CompanyCheckInput,
  interpretAuthority,
  interpretDeed,
  interpretLetter,
  interpretLicence,
  interpretMoa,
  interpretNoc,
  interpretReceipt,
  ownershipChecks,
  READ_MIN_CONFIDENCE,
} from "../src/readers/index.ts";

const hi = (value: string | null, confidence = 0.97) => ({ value, confidence });
const TODAY = "2026-11-19" as CalendarDate;

describe("interpretNoc: code parses, low confidence is unreadable", () => {
  const read = {
    documentType: "noc",
    unitNo: hi("1204"),
    sellerNames: [hi("Ana Sample"), hi("Bilal Example")],
    issuedOn: hi("01/11/2026"),
    expiresOn: hi("01/03/2027"),
    serviceCharges: hi("No dues outstanding"),
    amountPaid: hi("AED 400,000"),
    notes: "",
  };
  test("a clear read", () => {
    expect(interpretNoc(read)).toEqual({
      unitNo: "1204",
      sellerNames: ["Ana Sample", "Bilal Example"],
      issuedOn: "2026-11-01",
      expiresOn: "2027-03-01",
      serviceChargesCleared: true,
      paidReadFils: 40_000_000,
      amountUnread: false,
      unreadable: [],
    });
  });
  test("a field below the confidence bar, or one that fails to parse, is unreadable", () => {
    expect(READ_MIN_CONFIDENCE).toBe(0.8);
    const r = interpretNoc({
      ...read,
      unitNo: hi("1204", 0.5),
      expiresOn: hi("sometime in March"),
      sellerNames: [hi("Ana Sample"), hi("Bilal Exam", 0.4)],
      serviceCharges: hi("see attached"),
    });
    expect(r.unreadable.toSorted()).toEqual(["expiresOn", "sellerNames", "serviceChargesCleared", "unitNo"]);
    expect(r.unitNo).toBeNull();
    expect(r.expiresOn).toBeNull();
  });
  test("an unreadable amount is not required, but is flagged", () => {
    const r = interpretNoc({ ...read, amountPaid: hi("about 400k") });
    expect(r.paidReadFils).toBeNull();
    expect(r.amountUnread).toBe(true);
    expect(r.unreadable).toEqual([]);
  });
  test("no seller names is unreadable", () => {
    expect(interpretNoc({ ...read, sellerNames: [] }).unreadable).toContain("sellerNames");
  });
});

describe("interpretLetter", () => {
  const read = {
    documentType: "liability_letter",
    bankName: hi("Fictional Bank"),
    partyNames: [hi("Ana Sample")],
    amount: hi("AED 1,250,000.00"),
    issuedOn: hi("10/11/2026"),
    validUntil: hi("10/02/2027"),
    notes: "",
  };
  test("reads the amount as fils, never as a confirmed value", () => {
    const r = interpretLetter(read);
    expect(r).toMatchObject({ amountReadFils: 125_000_000, issuedOn: "2026-11-10", validUntil: "2027-02-10" });
    expect(r.unreadable).toEqual([]);
  });
  test("an unreadable issue date blocks; an unreadable amount or end date doesn't", () => {
    expect(interpretLetter({ ...read, issuedOn: hi("n/a") }).unreadable).toEqual(["issuedOn"]);
    const r = interpretLetter({ ...read, amount: hi("AED one point two five million"), validUntil: hi(null) });
    expect(r.unreadable).toEqual([]);
    expect(r.amountReadFils).toBeNull();
    expect(r.amountUnread).toBe(true);
    expect(r.validUntil).toBeNull();
  });
});

describe("interpretMoa / licence / authority / deed", () => {
  test("MoA: percentages to bps, a company-looking holder is corporate, an unread percent is flagged", () => {
    const r = interpretMoa({
      documentType: "moa",
      companyName: hi("Fictional Trading LLC"),
      shareholders: [
        { name: hi("Ana Sample"), percent: hi("60%"), holderKind: hi("person") },
        { name: hi("Orion Holdings Ltd"), percent: hi("30%"), holderKind: hi("person") },
        { name: hi("Bilal Example"), percent: hi("ten percent?"), holderKind: hi("person") },
      ],
      pageOf: hi("1 of 1"),
      notes: "",
    });
    expect(r.shareholders).toEqual([
      { name: "Ana Sample", bps: 6000, corporate: false },
      { name: "Orion Holdings Ltd", bps: 3000, corporate: true },
      { name: "Bilal Example", bps: null, corporate: false },
    ]);
    expect(r.percentUnread).toBe(true);
    expect(r.pages).toBe("complete");
  });
  test("licence", () => {
    const r = interpretLicence({
      documentType: "trade_licence",
      licenceNo: hi("CN-100200"),
      tradeName: hi("Fictional Trading LLC"),
      issuingAuthority: hi("Fictional Authority"),
      expiresOn: hi("31/12/2027"),
      managerName: hi("Ana Sample"),
      notes: "",
    });
    expect(r).toMatchObject({ tradeName: "Fictional Trading LLC", expiresOn: "2027-12-31", unreadable: [] });
    const low = interpretLicence({
      documentType: "trade_licence",
      licenceNo: hi("CN-100200"),
      tradeName: hi("Fictional Trading LLC"),
      issuingAuthority: hi("Fictional Authority"),
      expiresOn: hi("31/12/2027", 0.3),
      managerName: hi(null),
      notes: "",
    });
    expect(low.unreadable).toEqual(["expiresOn"]);
    expect(low.expiresOn).toBeNull();
  });
  test("authority: only a listed power over property counts; negated or low-confidence powers don't", () => {
    const base = {
      documentType: "poa",
      grantorName: hi("Fictional Trading LLC"),
      granteeName: hi("Ana Sample"),
      validUntil: hi("31/12/2027"),
      pageOf: hi("1 of 1"),
      notes: "",
    };
    const yes = interpretAuthority("poa", {
      ...base,
      powers: [hi("To sell, transfer and sign the sale of any real estate")],
    });
    expect(yes).toMatchObject({ signerName: "Ana Sample", coversProperty: true, validUntil: "2027-12-31" });
    for (const power of ["To open bank accounts", "Not to sell or transfer any property", "To sell property"]) {
      const r = interpretAuthority("poa", { ...base, powers: [hi(power, power.startsWith("To sell") ? 0.3 : 0.97)] });
      expect(r.coversProperty).toBe(false);
    }
    const res = interpretAuthority("board_resolution", {
      documentType: "board_resolution",
      companyName: hi("Fictional Trading LLC"),
      signerName: hi("Bilal Example"),
      powers: [hi("authorises the purchase of the unit")],
      resolutionDate: hi("01/10/2026"),
      pageOf: hi("1 of 1"),
      notes: "",
    });
    expect(res).toMatchObject({ signerName: "Bilal Example", coversProperty: true, validUntil: null });
  });
  test("deed: owners with shares in bps; an unread share is flagged", () => {
    const r = interpretDeed({
      documentType: "title_deed",
      documentNumber: hi("TD-5551"),
      propertyNumber: hi("1204"),
      owners: [
        { name: hi("Ana Sample"), share: hi("50%") },
        { name: hi("Bilal Example"), share: hi("half") },
      ],
      notes: "",
    });
    expect(r.owners).toEqual([
      { name: "Ana Sample", bps: 5000 },
      { name: "Bilal Example", bps: null },
    ]);
    expect(r.sharesUnread).toBe(true);
    expect(r.propertyNumber).toBe("1204");
  });
});

const licence = {
  licenceNo: "CN-1",
  tradeName: "Fictional Trading LLC",
  expiresOn: "2027-12-31" as string | null,
  managerName: "Ana Sample",
  unreadable: [] as string[],
};
const moa = (
  holders: { name: string; bps: number | null; corporate?: boolean }[],
  extra: Partial<{ pages: "complete" | "missing" | "unknown"; percentUnread: boolean }> = {},
) => ({
  companyName: "Fictional Trading LLC",
  shareholders: holders.map((h) => ({ corporate: false, ...h })),
  percentUnread: holders.some((h) => h.bps === null),
  pages: "complete" as const,
  ...extra,
});
const authority = (o: Partial<ReturnType<typeof interpretAuthority>> = {}) => ({
  kind: "poa" as const,
  signerName: "Ana Sample",
  coversProperty: true,
  validUntil: "2027-12-31" as string | null,
  validUntilUnread: false,
  unreadable: [] as string[],
  ...o,
});
const input = (o: Partial<CompanyCheckInput> = {}): CompanyCheckInput => ({
  today: TODAY,
  minLicenceDays: 30,
  targetTransferOn: null,
  ownerThresholdBps: 2500,
  partyName: "Fictional Trading LLC",
  licence,
  moa: moa([
    { name: "Ana Sample", bps: 6000 },
    { name: "Bilal Example", bps: 4000 },
  ]),
  authorities: [authority()],
  signatories: [{ name: "Ana Sample", authority: "poa" }],
  instructionFound: false,
  ...o,
});
const codes = (r: { findings: { code: string; severity: string }[] }) =>
  r.findings.filter((f) => f.severity === "review").map((f) => f.code);

describe("companyChecks: every ok comes from code (C20)", () => {
  test("a clean company passes; owners at or above the threshold are the ones to add; no layers", () => {
    const r = companyChecks(input());
    expect(r.status).toBe("passed");
    expect(r.signerOk).toBe(true);
    expect(r.layers).toBe(0);
    expect(r.licenceExpiresOn).toBe("2027-12-31");
    expect(r.ownersToAdd).toEqual([
      { name: "Ana Sample", bps: 6000 },
      { name: "Bilal Example", bps: 4000 },
    ]);
  });
  test("only holders at 25% or more are owners; the threshold comes from the rulebook value", () => {
    const m = moa([
      { name: "Ana Sample", bps: 7600 },
      { name: "Bilal Example", bps: 2400 },
    ]);
    expect(companyChecks(input({ moa: m })).ownersToAdd.map((o) => o.name)).toEqual(["Ana Sample"]);
    expect(companyChecks(input({ moa: m, ownerThresholdBps: 2000 })).ownersToAdd).toHaveLength(2);
    expect(
      companyChecks(
        input({
          moa: moa([
            { name: "Ana", bps: 2500 },
            { name: "Bo", bps: 7500 },
          ]),
        }),
      ).ownersToAdd,
    ).toHaveLength(2);
  });
  test("licence: unread, expired, too short, or for another name is review", () => {
    expect(codes(companyChecks(input({ licence: null })))).toContain("licence_missing");
    expect(
      codes(companyChecks(input({ licence: { ...licence, expiresOn: null, unreadable: ["expiresOn"] } }))),
    ).toContain("licence_unread");
    expect(codes(companyChecks(input({ licence: { ...licence, expiresOn: "2026-11-18" } })))).toContain(
      "licence_expired",
    );
    expect(codes(companyChecks(input({ licence: { ...licence, expiresOn: "2026-12-10" } })))).toContain(
      "licence_too_short",
    );
    expect(codes(companyChecks(input({ licence: { ...licence, expiresOn: "2026-12-19" } })))).toEqual([]);
    expect(
      codes(companyChecks(input({ licence: { ...licence, expiresOn: "2027-02-01" }, targetTransferOn: "2027-03-01" }))),
    ).toContain("licence_too_short");
    expect(codes(companyChecks(input({ partyName: "Other Trading LLC" })))).toContain("licence_name_mismatch");
  });
  test("signer: none recorded, not named in the document, another name, or no power over property", () => {
    expect(codes(companyChecks(input({ signatories: [] })))).toContain("no_signatory");
    expect(codes(companyChecks(input({ authorities: [] })))).toContain("authority_missing");
    const wrong = companyChecks(input({ authorities: [authority({ signerName: "Someone Else" })] }));
    expect(codes(wrong)).toContain("signer_mismatch");
    expect(wrong.signerOk).toBe(false);
    expect(
      codes(companyChecks(input({ authorities: [authority({ signerName: null, unreadable: ["signerName"] })] }))),
    ).toContain("signer_unread");
    expect(codes(companyChecks(input({ authorities: [authority({ coversProperty: false })] })))).toContain(
      "power_not_property",
    );
    expect(codes(companyChecks(input({ authorities: [authority({ validUntil: "2026-11-01" })] })))).toContain(
      "authority_expired",
    );
    expect(
      codes(companyChecks(input({ authorities: [authority({ validUntilUnread: true, validUntil: null })] }))),
    ).toContain("authority_unread");
    // A board resolution for a signatory recorded under a POA doesn't prove their authority.
    expect(
      codes(
        companyChecks(
          input({
            authorities: [authority({ kind: "board_resolution" })],
            signatories: [{ name: "Ana Sample", authority: "poa" }],
          }),
        ),
      ),
    ).toContain("signer_mismatch");
  });
  test("a missing page or an unread percentage: review, counts a layer, and no guessed owner is added", () => {
    const page = companyChecks(
      input({
        moa: moa(
          [
            { name: "Ana Sample", bps: 6000 },
            { name: "Bilal Example", bps: 4000 },
          ],
          { pages: "missing" },
        ),
      }),
    );
    expect(codes(page)).toContain("page_missing");
    expect(page.layers).toBe(1);
    expect(page.ownersToAdd).toEqual([]);
    const unread = companyChecks(
      input({
        moa: moa([
          { name: "Ana Sample", bps: 6000 },
          { name: "Bilal Example", bps: null },
        ]),
      }),
    );
    expect(codes(unread)).toContain("percent_unread");
    expect(unread.layers).toBe(1);
    expect(unread.ownersToAdd).toEqual([]);
    const unknown = companyChecks(input({ moa: moa([{ name: "Ana Sample", bps: 10000 }], { pages: "unknown" }) }));
    expect(codes(unknown)).toContain("page_missing");
    expect(codes(companyChecks(input({ moa: null })))).toContain("moa_missing");
    expect(companyChecks(input({ moa: null })).layers).toBe(1);
  });
  test("a corporate shareholder is an unresolved layer; shares must add to exactly 100%", () => {
    const corp = companyChecks(
      input({
        moa: moa([
          { name: "Ana Sample", bps: 5000 },
          { name: "Orion Holdings Ltd", bps: 5000, corporate: true },
        ]),
      }),
    );
    expect(codes(corp)).toContain("corporate_shareholder");
    expect(corp.layers).toBe(1);
    // The clearly read person is still an owner to add.
    expect(corp.ownersToAdd).toEqual([{ name: "Ana Sample", bps: 5000 }]);
    const over = companyChecks(
      input({
        moa: moa([
          { name: "Ana Sample", bps: 6000 },
          { name: "Bilal Example", bps: 6000 },
        ]),
      }),
    );
    expect(codes(over)).toContain("shares_over_100");
    expect(over.ownersToAdd).toEqual([]);
    const under = companyChecks(
      input({
        moa: moa([
          { name: "Ana Sample", bps: 6000 },
          { name: "Bilal Example", bps: 3000 },
        ]),
      }),
    );
    expect(codes(under)).toContain("shares_under_100");
    expect(under.ownersToAdd).toEqual([
      { name: "Ana Sample", bps: 6000 },
      { name: "Bilal Example", bps: 3000 },
    ]);
  });
  test("instruction-like text routes to review: never a pass, and no other finding or value changes", () => {
    const clean = companyChecks(input());
    const r = companyChecks(input({ instructionFound: true }));
    expect(clean.status).toBe("passed");
    expect(r.status).toBe("review");
    expect(r.findings.find((f) => f.code === "instruction_found")?.severity).toBe("review");
    expect(r.findings.filter((f) => f.code !== "instruction_found")).toEqual(clean.findings);
    expect([r.signerOk, r.licenceExpiresOn, r.owners, r.ownersToAdd, r.layers]).toEqual([
      clean.signerOk,
      clean.licenceExpiresOn,
      clean.owners,
      clean.ownersToAdd,
      clean.layers,
    ]);
    const bad = companyChecks(input({ instructionFound: true, licence: null }));
    expect(bad.status).toBe("review");
  });
});

describe("ownershipChecks: no wrong 'matched' (C20)", () => {
  const match = (docNames: string[], sellers: string[]) => {
    const reasons: string[] = [];
    const left = [...sellers];
    if (docNames.length !== sellers.length) reasons.push("count");
    for (const n of docNames) {
      const at = left.indexOf(n);
      if (at === -1) reasons.push(`${n} not a seller`);
      else left.splice(at, 1);
    }
    return { matched: !reasons.length, reasons };
  };
  const deed = (owners: { name: string; bps: number | null }[], o: Partial<ReturnType<typeof interpretDeed>> = {}) => ({
    documentNumber: "TD-1",
    propertyNumber: "1204" as string | null,
    owners,
    sharesUnread: owners.some((x) => x.bps === null),
    ownersUnread: false,
    unreadable: [] as string[],
    ...o,
  });
  const sellers = [
    { name: "Ana Sample", kind: "person" as const, licenceName: undefined },
    { name: "Bilal Example", kind: "person" as const, licenceName: undefined },
  ];
  const base = () => ({
    deed: deed([
      { name: "Ana Sample", bps: 5000 },
      { name: "Bilal Example", bps: 5000 },
    ]),
    dealUnitNo: "1204" as string | null,
    sellers,
    matchOwners: match,
  });
  test("matches only when names, shares, property number and licence all agree", () => {
    expect(ownershipChecks(base())).toEqual({ status: "matched", findings: [] });
  });
  test("instruction-like text on a document is review even when everything else matches", () => {
    const r = ownershipChecks({ ...base(), instructionFound: true });
    expect(r.status).toBe("review");
    expect(r.findings.map((f) => f.code)).toEqual(["instruction_found"]);
    expect(ownershipChecks({ ...base(), instructionFound: false }).status).toBe("matched");
  });
  test("a wrong, missing or extra owner is review", () => {
    const r = ownershipChecks({
      ...base(),
      deed: deed([
        { name: "Ana Sample", bps: 5000 },
        { name: "Carl Stranger", bps: 5000 },
      ]),
    });
    expect(r.status).toBe("review");
    expect(r.findings.map((f) => f.code)).toContain("owners_mismatch");
  });
  test("shares must add to exactly 10000 bps and every one must be read", () => {
    expect(
      ownershipChecks({
        ...base(),
        deed: deed([
          { name: "Ana Sample", bps: 5000 },
          { name: "Bilal Example", bps: 4000 },
        ]),
      }).findings.map((f) => f.code),
    ).toContain("shares_not_100");
    expect(
      ownershipChecks({
        ...base(),
        deed: deed([
          { name: "Ana Sample", bps: 5000 },
          { name: "Bilal Example", bps: null },
        ]),
      }).findings.map((f) => f.code),
    ).toContain("share_unread");
  });
  test("property number: a different one is review; one the record lacks is not_checked, which is review", () => {
    expect(ownershipChecks({ ...base(), dealUnitNo: "1205" }).findings.map((f) => f.code)).toContain(
      "property_mismatch",
    );
    expect(ownershipChecks({ ...base(), dealUnitNo: null }).findings.map((f) => f.code)).toContain(
      "property_not_checked",
    );
    expect(
      ownershipChecks({
        ...base(),
        deed: deed(
          [
            { name: "Ana Sample", bps: 5000 },
            { name: "Bilal Example", bps: 5000 },
          ],
          { propertyNumber: null },
        ),
      }).findings.map((f) => f.code),
    ).toContain("property_unread");
    expect(ownershipChecks({ ...base(), dealUnitNo: "a-12 04".replace(/[a-z\- ]/g, "") }).status).toBe("matched");
    expect(
      ownershipChecks({
        ...base(),
        dealUnitNo: "A-1204",
        deed: deed(
          [
            { name: "Ana Sample", bps: 5000 },
            { name: "Bilal Example", bps: 5000 },
          ],
          { propertyNumber: "a1204" },
        ),
      }).status,
    ).toBe("matched");
  });
  test("a company owner must match the licence name read from its trade licence", () => {
    const co = [
      {
        name: "Fictional Trading LLC",
        kind: "company" as const,
        licenceName: "Fictional Trading LLC" as string | null | undefined,
      },
    ];
    const d = deed([{ name: "Fictional Trading LLC", bps: 10000 }]);
    expect(ownershipChecks({ ...base(), deed: d, sellers: co }).status).toBe("matched");
    expect(
      ownershipChecks({ ...base(), deed: d, sellers: [{ ...co[0]!, licenceName: null }] }).findings.map((f) => f.code),
    ).toContain("licence_not_read");
    expect(
      ownershipChecks({ ...base(), deed: d, sellers: [{ ...co[0]!, licenceName: "Other LLC" }] }).findings.map(
        (f) => f.code,
      ),
    ).toContain("licence_name_mismatch");
  });
  test("an empty owner list or unreadable owners is never matched", () => {
    expect(ownershipChecks({ ...base(), deed: deed([], { ownersUnread: true }) }).status).toBe("review");
    expect(ownershipChecks({ ...base(), deed: deed([]) }).status).toBe("review");
  });
});

describe("interpretReceipt: the reader's copy of a transfer receipt (C22, S55)", () => {
  const read = {
    documentType: "payment_receipt",
    amount: hi("AED 250,000.00"),
    paidOn: hi("01/12/2026"),
    payerName: hi("Ana Sample Ribeiro"),
    receivingAccount: hi("AE07 0331 2345 6789 0123 456"),
    reference: hi("TRX-0042"),
    notes: "",
  };
  test("a clear read: the amount is only ever the amount read, the account is normalised and masked", () => {
    expect(interpretReceipt(read)).toEqual({
      amountReadFils: 25_000_000,
      paidOn: "2026-12-01",
      payerName: "Ana Sample Ribeiro",
      accountIban: "AE070331234567890123456",
      accountMasked: "AE07...3456",
      reference: "TRX-0042",
      amountUnread: false,
      unreadable: [],
    });
  });
  test("a doubtful field is null and named; an account that is not a good AE IBAN is never matched", () => {
    const r = interpretReceipt({
      ...read,
      amount: hi("AED 250,000.00", 0.5),
      receivingAccount: hi("AE08 0331 2345 6789 0123 456"),
      payerName: hi(null),
    });
    expect(r.amountReadFils).toBeNull();
    expect(r.amountUnread).toBe(true);
    expect(r.accountIban).toBeNull();
    expect(r.accountMasked).toBeNull();
    expect(r.payerName).toBeNull();
    expect(r.unreadable).toEqual(["amount", "payerName", "receivingAccount"]);
  });
  test("an amount that isn't properly written is unread, not guessed", () => {
    expect(interpretReceipt({ ...read, amount: hi("two hundred thousand") }).amountReadFils).toBeNull();
    expect(interpretReceipt({ ...read, amount: hi("AED 0") }).amountReadFils).toBeNull();
  });
});
