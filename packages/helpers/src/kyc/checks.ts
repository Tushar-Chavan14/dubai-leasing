import {
  addDays,
  type CalendarDate,
  compareNames,
  isValidEmiratesId,
  normaliseEmiratesId,
  parseTd3,
} from "@leasing/core";
import type { DocKind, DocRead, KycContext, KycData, KycFlag, KycIdentity, ReadField } from "./schema.ts";

/**
 * The KYC decision, in pure code: what the vision model read goes in, a verdict comes out.
 * Nothing here trusts the model's judgement; it trusts check digits, formats, dates and names.
 * "verified" only when nothing at all is flagged.
 */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Dates as printed on documents → ISO. DD/MM/YYYY (UAE order), YYYY-MM-DD or "07 MAR 1991". */
export function parseDocDate(raw: string | null | undefined): CalendarDate | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(s);
  if (match) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)))
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})\s*([A-Z]{3})[A-Z]*\.?\s*(\d{4})$/.exec(s)) && MONTHS.includes(match[2]!)) {
    [d, m, y] = [Number(match[1]), MONTHS.indexOf(match[2]!) + 1, Number(match[3])];
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  // Reject impossible days (31/02).
  const check = new Date(`${iso}T00:00:00Z`);
  return check.getUTCMonth() + 1 === m ? (iso as CalendarDate) : null;
}

const alnum = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const val = (r: Record<string, unknown> | null, key: string): ReadField | undefined =>
  (r?.[key] as ReadField | undefined) ?? undefined;

/** Fields that must be read confidently for each document, by read key. */
const REQUIRED: Record<string, string[]> = {
  emirates_id_front: ["idNumber", "name", "nationality", "birthDate", "expiryDate"],
  emirates_id_back: ["cardNumber"],
  passport: ["passportNo", "surname", "givenNames", "birthDate", "expiryDate", "mrzLine1", "mrzLine2"],
  visa: ["visaNo", "name", "passportNo", "expiryDate"],
  trade_licence: ["licenceNo", "tradeName", "managerName", "expiryDate"],
};
const EXPECTED_TYPE: Record<string, string> = {
  emirates_id_front: "identity_card_front",
  emirates_id_back: "identity_card_back",
  passport: "passport",
  visa: "residence_visa",
  trade_licence: "trade_licence",
};
const LABEL: Record<DocKind, string> = {
  emirates_id: "Emirates ID",
  passport: "passport",
  visa: "residence visa",
  trade_licence: "trade licence",
};

export function assessKyc(ctx: KycContext, reads: DocRead[]): KycData {
  const flags: KycFlag[] = [];
  const checks: KycData["checks"] = [];
  const identity: KycIdentity = {
    fullNameEn: null,
    nationality: null,
    birthDate: null,
    emiratesIdNo: null,
    idExpiresOn: null,
    passportNo: null,
    passportExpiresOn: null,
    visaNo: null,
    visaExpiresOn: null,
    companyName: null,
    tradeLicenceNo: null,
    tradeLicenceExpiresOn: null,
  };
  const sources: KycData["sources"] = {};
  const flag = (kind: KycFlag["kind"], message: string, docId: string | null, blocking = false) => {
    flags.push({ kind, message, docId, blocking });
    checks.push({ check: kind, status: "flag", docId });
  };
  const pass = (check: string, docId: string | null) => checks.push({ check, status: "pass", docId });
  const set = <K extends keyof KycIdentity>(key: K, value: KycIdentity[K], docId: string, via: "mrz" | "printed") => {
    if (value === null || identity[key] !== null) return;
    identity[key] = value;
    sources[key] = { docId, via };
  };
  const names: { name: string; docId: string; where: string }[] = [];
  const latestOk = addDays(ctx.leaseStartOn as CalendarDate, ctx.minValidityDays);

  const checkExpiry = (raw: ReadField | undefined, docId: string, what: string): CalendarDate | null => {
    const d = parseDocDate(raw?.value);
    if (!d) {
      // Without a readable expiry date nobody can show the document is valid: ask for a new photo.
      flag("invalid_date", `The ${what} expiry date can't be read as a date.`, docId, true);
      return null;
    }
    if (d < ctx.today) flag("expired", `The ${what} expired on ${d}.`, docId, true);
    else if (d < ctx.leaseStartOn) {
      flag("expired", `The ${what} expires on ${d}, before the lease starts (${ctx.leaseStartOn}).`, docId, true);
    } else if (d < latestOk) {
      flag(
        "expires_too_soon",
        `The ${what} expires on ${d}, less than ${ctx.minValidityDays} days after the lease starts (${ctx.leaseStartOn}).`,
        docId,
      );
    } else pass("in_date", docId);
    return d;
  };

  // Fixed order, so the identity always comes from the same document: the Emirates ID first,
  // then the passport, the visa and the trade licence (first value wins in `set`).
  const PRIORITY = { emirates_id: 0, passport: 1, visa: 2, trade_licence: 3 } as const;
  const ordered = reads.toSorted((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.side.localeCompare(b.side));
  for (const r of ordered) {
    const key = r.kind === "emirates_id" ? (r.side === "back" ? "emirates_id_back" : "emirates_id_front") : r.kind;
    const what = r.kind === "emirates_id" ? `Emirates ID (${r.side})` : LABEL[r.kind];
    if (!r.read) {
      flag("unreadable", `The ${what} could not be read${r.error ? ` (${r.error})` : ""}.`, r.docId);
      continue;
    }
    const docType = String(r.read.documentType ?? "other");
    if (docType !== EXPECTED_TYPE[key]) {
      flag(
        "wrong_document",
        `The ${what} upload looks like a different document (${docType.replaceAll("_", " ")}).`,
        r.docId,
      );
    }
    const unsure = REQUIRED[key]!.filter((k) => {
      const v = val(r.read, k);
      return !v?.value || v.confidence < ctx.minConfidence;
    });
    if (unsure.length)
      flag("low_confidence", `On the ${what}, these weren't read clearly: ${unsure.join(", ")}.`, r.docId);
    else pass("readable", r.docId);

    if (key === "emirates_id_front") {
      const rawId = val(r.read, "idNumber")?.value ?? "";
      const id = normaliseEmiratesId(rawId);
      if (!id || !isValidEmiratesId(id)) {
        flag("invalid_id_number", "The Emirates ID number is not valid (format or check digit).", r.docId);
      } else {
        pass("id_number_valid", r.docId);
        set("emiratesIdNo", id, r.docId, "printed");
      }
      const birth = parseDocDate(val(r.read, "birthDate")?.value);
      if (birth) set("birthDate", birth, r.docId, "printed");
      if (id && birth && id.slice(4, 8) !== birth.slice(0, 4)) {
        flag(
          "id_birth_year_mismatch",
          "The birth year in the Emirates ID number doesn't match the date of birth.",
          r.docId,
        );
      }
      set("idExpiresOn", checkExpiry(val(r.read, "expiryDate"), r.docId, "Emirates ID"), r.docId, "printed");
      const name = val(r.read, "name")?.value;
      if (name) {
        names.push({ name, docId: r.docId, where: "Emirates ID" });
        set("fullNameEn", name.trim(), r.docId, "printed");
      }
      set("nationality", val(r.read, "nationality")?.value?.trim() ?? null, r.docId, "printed");
    }

    if (key === "passport") {
      const l1 = val(r.read, "mrzLine1")?.value ?? "";
      const l2 = val(r.read, "mrzLine2")?.value ?? "";
      const mrz = parseTd3([l1, l2], Number(ctx.today.slice(0, 4)));
      const printedNo = val(r.read, "passportNo")?.value;
      const printedName = [val(r.read, "givenNames")?.value, val(r.read, "surname")?.value].filter(Boolean).join(" ");
      const printedExpiry = parseDocDate(val(r.read, "expiryDate")?.value);
      if (!mrz.ok) {
        flag(
          "mrz_invalid",
          `The passport's machine-readable zone fails its checks: ${mrz.errors.join("; ")}.`,
          r.docId,
        );
      } else {
        pass("mrz_valid", r.docId);
        // The MRZ carries check digits; it wins over the printed page.
        set("passportNo", mrz.data.passportNo, r.docId, "mrz");
        set("birthDate", mrz.data.birthDate, r.docId, "mrz");
        if (alnum(printedNo) && alnum(printedNo) !== alnum(mrz.data.passportNo)) {
          flag("mrz_mismatch", "The printed passport number differs from the machine-readable zone.", r.docId);
        }
        if (printedExpiry && printedExpiry !== mrz.data.expiresOn) {
          flag("mrz_mismatch", "The printed expiry date differs from the machine-readable zone.", r.docId);
        }
        if (printedName && compareNames(printedName, mrz.data.fullName) === "different") {
          flag("mrz_mismatch", "The printed name differs from the machine-readable zone.", r.docId);
        }
      }
      const expiry = mrz.ok ? mrz.data.expiresOn : printedExpiry;
      set(
        "passportExpiresOn",
        checkExpiry({ value: expiry, confidence: 1 }, r.docId, "passport"),
        r.docId,
        mrz.ok ? "mrz" : "printed",
      );
      if (printedName) {
        names.push({ name: printedName, docId: r.docId, where: "passport" });
        set("fullNameEn", printedName, r.docId, "printed");
      }
      set("nationality", val(r.read, "nationality")?.value?.trim() ?? null, r.docId, "printed");
      if (!mrz.ok) {
        set("passportNo", printedNo ? alnum(printedNo) : null, r.docId, "printed");
        set("birthDate", parseDocDate(val(r.read, "birthDate")?.value), r.docId, "printed");
      }
    }

    if (key === "visa") {
      const no = val(r.read, "visaNo")?.value?.replace(/\s+/g, "") ?? "";
      if (!/^\d{3}\/\d{4}\/\d{7}$/.test(no)) {
        flag("invalid_id_number", "The visa file number is not in the expected 000/0000/0000000 form.", r.docId);
      } else {
        pass("visa_number_format", r.docId);
        set("visaNo", no, r.docId, "printed");
      }
      set("visaExpiresOn", checkExpiry(val(r.read, "expiryDate"), r.docId, "visa"), r.docId, "printed");
      const name = val(r.read, "name")?.value;
      if (name) names.push({ name, docId: r.docId, where: "visa" });
      const passportOnVisa = alnum(val(r.read, "passportNo")?.value);
      const passport = reads.find((x) => x.kind === "passport");
      const passportNo = alnum(val(passport?.read ?? null, "passportNo")?.value);
      if (passportOnVisa && passportNo && passportOnVisa !== passportNo) {
        flag("number_mismatch", "The passport number on the visa differs from the passport.", r.docId);
      }
    }

    if (key === "trade_licence") {
      const no = val(r.read, "licenceNo")?.value?.trim();
      if (no) set("tradeLicenceNo", no, r.docId, "printed");
      set("companyName", val(r.read, "tradeName")?.value?.trim() ?? null, r.docId, "printed");
      set(
        "tradeLicenceExpiresOn",
        checkExpiry(val(r.read, "expiryDate"), r.docId, "trade licence"),
        r.docId,
        "printed",
      );
      const manager = val(r.read, "managerName")?.value;
      if (manager) names.push({ name: manager, docId: r.docId, where: "trade licence (manager)" });
    }
  }

  // Required documents.
  const has = (kind: DocKind, side?: string) => reads.some((r) => r.kind === kind && (!side || r.side === side));
  const personDocs = (has("emirates_id", "front") && has("emirates_id", "back")) || (has("passport") && has("visa"));
  const signatoryDocs = (has("emirates_id", "front") && has("emirates_id", "back")) || has("passport");
  if (ctx.applicant.kind === "individual" && !personDocs) {
    flag("missing_document", "Needed: both sides of the Emirates ID, or the passport and residence visa.", null);
  } else if (ctx.applicant.kind === "company" && (!has("trade_licence") || !signatoryDocs)) {
    flag(
      "missing_document",
      "Needed: the trade licence and the signatory's Emirates ID (both sides) or passport.",
      null,
    );
  } else pass("documents_complete", null);

  // One person across documents (order may differ: the MRZ puts the surname first).
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (compareNames(names[i]!.name, names[j]!.name) === "different") {
        flag(
          "name_mismatch",
          `The name on the ${names[i]!.where} differs from the ${names[j]!.where}.`,
          names[j]!.docId,
        );
      }
    }
  }
  if (names.length > 1 && !flags.some((x) => x.kind === "name_mismatch")) pass("names_consistent", null);

  // The applicant is the person (or company) on the documents.
  const holder = ctx.applicant.kind === "company" ? identity.companyName : identity.fullNameEn;
  if (holder && compareNames(ctx.applicant.nameEn, holder) === "different") {
    flag(
      "applicant_name_mismatch",
      `The applicant's name (${ctx.applicant.nameEn}) is not the name on the documents (${holder}).`,
      null,
    );
  } else if (holder) pass("applicant_matches", null);

  return { verdict: flags.length ? "review" : "verified", identity, sources, checks, flags };
}
