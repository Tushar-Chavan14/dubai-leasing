import { describe, expect, test } from "bun:test";
import { compareNames, makeTd3, mrzCheckDigit, normaliseName, OfferResponded, parseTd3 } from "../src/index.ts";

// ICAO 9303 specimen values (fictional person "Anna Maria Eriksson", Utopia).
const ICAO = ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F1204159ZE184226B<<<<<10"];

describe("passport MRZ (TD3)", () => {
  test("the ICAO specimen parses with all check digits valid", () => {
    const r: unknown = parseTd3(ICAO, 2026);
    expect(r).toEqual({
      ok: true,
      data: {
        documentType: "P",
        issuingState: "UTO",
        surname: "ERIKSSON",
        givenNames: "ANNA MARIA",
        fullName: "ERIKSSON ANNA MARIA",
        passportNo: "L898902C3",
        nationality: "UTO",
        birthDate: "1974-08-12",
        sex: "F",
        expiresOn: "2012-04-15",
        personalNo: "ZE184226B",
      },
    });
  });

  test("check digits use weights 7-3-1 with letters as 10–35 and < as 0", () => {
    expect(mrzCheckDigit("L898902C3")).toBe(6);
    expect(mrzCheckDigit("740812")).toBe(2);
    expect(mrzCheckDigit("<<<<")).toBe(0);
  });

  test("one changed character fails its check digit and the composite", () => {
    const bad = [ICAO[0]!, ICAO[1]!.replace("L898902C3", "L898902C4")];
    const r = parseTd3(bad, 2026);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain("passport number check digit does not match");
      expect(r.errors).toContain("composite check digit does not match");
      expect(r.partial?.passportNo).toBe("L898902C4");
    }
  });

  test("wrong length or a non-passport MRZ is refused", () => {
    expect(parseTd3(["P<UTO", "L898"], 2026).ok).toBe(false);
    const visa = parseTd3([`V${ICAO[0]!.slice(1)}`, ICAO[1]!], 2026);
    expect(visa.ok).toBe(false);
  });

  test("miscounted < fillers are repaired; the check digits still decide", () => {
    const short1 = ICAO[0]!.replace(/<{6}$/, "");
    const long2 = ICAO[1]!.replace("<<<<<10", "<<<<<<<<10");
    expect(parseTd3([short1, long2], 2026).ok).toBe(true);
    // A real character change can't be "repaired" into a valid MRZ.
    expect(parseTd3([short1, long2.replace("L898902C3", "L898902C8")], 2026).ok).toBe(false);
  });

  test("OCR noise (spaces, lower case) is tolerated", () => {
    const noisy = [ICAO[0]!.toLowerCase().replace(/<<<</, "<< <<"), ` ${ICAO[1]} `];
    expect(parseTd3(noisy, 2026).ok).toBe(true);
  });

  test("makeTd3 builds MRZs that parse back to the same fields", () => {
    const lines = makeTd3({
      issuingState: "IND",
      surname: "Example Rao",
      givenNames: "Priya",
      passportNo: "Z1234567",
      nationality: "IND",
      birthDate: "1991-03-07",
      sex: "F",
      expiresOn: "2031-11-30",
    });
    const r = parseTd3(lines, 2026);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.data).toMatchObject({
        fullName: "EXAMPLE RAO PRIYA",
        passportNo: "Z1234567",
        birthDate: "1991-03-07",
        expiresOn: "2031-11-30",
      });
  });

  test("impossible dates fail even when the check digits match", () => {
    const lines = makeTd3({
      issuingState: "UTO",
      surname: "A",
      givenNames: "B",
      passportNo: "X1",
      nationality: "UTO",
      birthDate: "1990-02-31",
      sex: "M",
      expiresOn: "2030-01-01",
    });
    const r = parseTd3(lines, 2026);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("date of birth is not a valid date");
  });

  test("birth years use the pivot; expiry years are always this century", () => {
    const lines = makeTd3({
      issuingState: "UTO",
      surname: "A",
      givenNames: "B",
      passportNo: "X1",
      nationality: "UTO",
      birthDate: "2001-01-01",
      sex: "M",
      expiresOn: "2030-01-01",
    });
    const r = parseTd3(lines, 2026);
    expect(r.ok ? String(r.data.birthDate) : null).toBe("2001-01-01");
  });
});

describe("name comparison", () => {
  test("case, spacing, punctuation and accents are typo-class; order and spelling are not", () => {
    expect(compareNames("Sara Example Khan", "Sara Example Khan")).toBe("exact");
    expect(compareNames("Sara  Example-Khan", "SARA EXAMPLE KHAN")).toBe("typo_class");
    expect(compareNames("José Example", "JOSE EXAMPLE")).toBe("typo_class");
    expect(compareNames("KHAN SARA EXAMPLE", "Sara Example Khan")).toBe("reordered");
    expect(compareNames("Sarah Example Khan", "Sara Example Khan")).toBe("different");
    expect(compareNames("", "Sara")).toBe("different");
  });
  test("normalised form keeps only letters and single spaces", () => {
    expect(normaliseName("  o'Brien-  Smith.  ")).toBe("O BRIEN SMITH");
  });
});

describe("offer response payload", () => {
  test("a counter needs at least one changed term; buttons are typed", () => {
    expect(OfferResponded.safeParse({ revision: 1, choice: "accept" }).success).toBe(true);
    expect(OfferResponded.safeParse({ revision: 1, choice: "counter" }).success).toBe(false);
    expect(OfferResponded.safeParse({ revision: 1, choice: "counter", counter: { cheques: 6 } }).success).toBe(true);
    expect(OfferResponded.safeParse({ revision: 1, choice: "counter", counter: { annualRentFils: 1.5 } }).success).toBe(
      false,
    );
    expect(OfferResponded.safeParse({ revision: 1, choice: "accept", extra: 1 }).success).toBe(false);
  });
});
