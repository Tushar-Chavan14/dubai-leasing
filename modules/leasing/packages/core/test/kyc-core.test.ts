import { describe, expect, test } from "bun:test";
import {
  applicantReason,
  compareNames,
  defaultBaseRules,
  defaultDocRules,
  effectiveCross,
  FormField,
  KycRules,
  makeTd3,
  mrzCheckDigit,
  normaliseName,
  OfferResponded,
  parseTd3,
} from "../src/index.ts";

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

describe("document field rules and checks across documents (D49)", () => {
  const base = defaultBaseRules({ kycMinValidityDays: 30, kycMinConfidence: 0.8 });
  const rulesWith = (patch: (c: ReturnType<typeof effectiveCross>) => void, company: unknown[] = []) => {
    const c = structuredClone(effectiveCross(base));
    patch(c);
    return KycRules.safeParse({ base: { ...base, checks: c }, company });
  };
  const passportField = (patch: (r: ReturnType<typeof defaultDocRules>) => void = () => {}) => {
    const rules = structuredClone(defaultDocRules("passport", base));
    patch(rules);
    return FormField.safeParse({
      key: "passport",
      label: "Passport",
      type: "document",
      required: true,
      documentKind: "passport",
      rules,
    });
  };

  test("a document field's rules may only list its category's checks", () => {
    expect(passportField().success).toBe(true);
    // A check left out takes its default (rules saved before a check existed stay valid).
    expect(passportField((r) => delete r.checks.mrz).success).toBe(true);
    expect(passportField((r) => (r.checks.id_number = { severity: "warning", emailApplicant: false })).success).toBe(
      false,
    );
    expect(passportField((r) => delete r.validityDays).success).toBe(false);
    // The Emirates ID back has no expiry date and only two checks.
    const back = defaultDocRules("emirates_id_back");
    expect(Object.keys(back.checks)).toEqual(["readable", "right_document"]);
    expect(back.validityDays).toBeUndefined();
  });

  test("rules only go on a document field that is read", () => {
    const rules = defaultDocRules("passport");
    expect(FormField.safeParse({ key: "n", label: "N", type: "text", required: false, rules }).success).toBe(false);
    expect(
      FormField.safeParse({ key: "o", label: "O", type: "document", documentKind: "other", required: false, rules })
        .success,
    ).toBe(false);
  });

  test("an expired document can't be anything but a blocker; wrong or unreadable can't be off", () => {
    const set = (k: string, severity: "off" | "warning" | "blocker") =>
      passportField((r) => (r.checks[k] = { severity, emailApplicant: false })).success;
    expect(set("expired", "warning")).toBe(false);
    expect(set("right_document", "off")).toBe(false);
    expect(set("readable", "off")).toBe(false);
    expect(set("readable", "blocker")).toBe(true);
  });

  test("checks across documents must all be present", () => {
    expect(rulesWith(() => {}).success).toBe(true);
    expect(rulesWith((c) => delete c.cross.names_consistent).success).toBe(false);
    expect(rulesWith((c) => (c.cross.extra = { severity: "off", emailApplicant: false })).success).toBe(false);
  });

  test("an AI check can only warn", () => {
    const ai = { id: "a", type: "ai_check", label: "L", instruction: "Check something here.", severity: "blocker" };
    expect(rulesWith(() => {}, [ai]).success).toBe(false);
    expect(rulesWith(() => {}, [{ ...ai, severity: "warning" }]).success).toBe(true);
  });

  test("older company rules parse as warnings", () => {
    const r = KycRules.parse({ base, company: [{ id: "m", type: "min_age", label: "21+", years: 21 }] });
    expect(r.company[0]).toMatchObject({ severity: "warning", emailApplicant: false });
  });

  test("a pattern must be a valid, bounded regular expression", () => {
    const p = (pattern: string) => ({
      id: "p",
      type: "document_value_pattern",
      label: "P",
      identityField: "passportNo",
      pattern,
    });
    expect(rulesWith(() => {}, [p("^[A-Z]\\d{7}$")]).success).toBe(true);
    expect(rulesWith(() => {}, [p("([a-z")]).success).toBe(false);
    expect(rulesWith(() => {}, [p("(a+)+$")]).success).toBe(false);
    expect(rulesWith(() => {}, [p("(a|aa)+$")]).success).toBe(false);
    expect(rulesWith(() => {}, [p("(\\d|\\d\\d)+x")]).success).toBe(false);
    expect(rulesWith(() => {}, [p("^(\\d)\\1")]).success).toBe(false);
    expect(rulesWith(() => {}, [p("^(CN|DED)-\\d{6}$")]).success).toBe(true);
  });

  test("applicant reasons come from code, name the field by its label, and carry no personal data", () => {
    const rules = KycRules.parse({
      base,
      company: [{ id: "m", type: "min_age", label: "Applicants must be 21 or older", years: 21 }],
    });
    const form = [
      {
        key: "pp",
        label: "Passport data page",
        type: "document" as const,
        required: true,
        appliesTo: "both" as const,
        options: [],
        placeholder: "",
        help: "",
        nameAsPerDocuments: false,
        documentKind: "passport" as const,
        rules: { ...defaultDocRules("passport"), validityDays: 180 },
      },
    ];
    expect(applicantReason("passport.valid_long_enough", rules, form)).toBe(
      'Your "Passport data page" must be valid for at least 180 days after the move-in date.',
    );
    expect(applicantReason("emirates_id_back.readable", rules)).toContain("Emirates ID (back)");
    expect(applicantReason("rule:m", rules)).toBe("Applicants must be 21 or older.");
    expect(applicantReason("rule:missing", rules)).toBeNull();
    expect(applicantReason("nonsense.key", rules)).toBeNull();
  });
});
