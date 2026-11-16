import { isCalendarDate, parseAed } from "@leasing/core";
import { type Llm } from "@leasing/llm";
import { extractPdf, normalizeWs } from "../contract-template/extract.ts";
import { certificateMessages } from "./prompt.ts";
import { type CertificateRead, type CertificateResult, ModelCertificate } from "./schema.ts";

export * from "./schema.ts";
export { certificateMessages } from "./prompt.ts";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const iso = (y: number, m: number, d: number): string | undefined => {
  const s = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isCalendarDate(s) ? s : undefined;
};
const monthOf = (name: string): number | undefined => {
  const n = name.toLowerCase().replace(/\.$/, "");
  if (n.length < 3) return undefined;
  const i = MONTHS.findIndex(
    (m) => m === n || (n.length === 3 && m.startsWith(n)) || (n === "sept" && m === "september"),
  );
  return i < 0 ? undefined : i + 1;
};

/** ISO, dd/mm/yyyy (also - or .), "1 December 2026", "Dec 1, 2026" to an ISO calendar date. */
export function parseCertificateDate(raw: string): string | undefined {
  const s = normalizeWs(raw);
  let m = /(?<![\d])(\d{4})-(\d{2})-(\d{2})(?![\d])/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /(?<![\d])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?![\d])/.exec(s);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /(?<![\d])(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})(?![\d])/.exec(s);
  if (m) {
    const mo = monthOf(m[2]!);
    return mo ? iso(Number(m[3]), mo, Number(m[1])) : undefined;
  }
  m = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?![\d])/.exec(s);
  if (m) {
    const mo = monthOf(m[1]!);
    return mo ? iso(Number(m[3]), mo, Number(m[2])) : undefined;
  }
  return undefined;
}

const SEP = String.raw`\s*[:\-–]?\s*`;
const label = (alts: string) => new RegExp(String.raw`^(?:${alts})${SEP}(.*)$`, "i");
const LABELS = {
  // In priority order: the first label that appears wins.
  reference: [
    label(String.raw`registration\s+(?:no|number)\.?`),
    label(String.raw`ejari\s+(?:no|number)\.?`),
    label(String.raw`tawtheeq\s+(?:no|number)\.?`),
    label(String.raw`attestation\s+(?:no|number)\.?`),
    // The other emirates' systems: Ajman Tasdeeq, Fujairah Ejaar. A "Contract No." or "Certificate No." is not the
    // registration reference (it may be the landlord's own contract number).
    label(String.raw`(?:tasdeeq|ejaar|ejar)(?:\s+registration)?\s+(?:no|number)\.?`),
    label(String.raw`reference\s+(?:no|number)\.?`),
  ],
  issuedOn: [
    label(String.raw`issued\s+on`),
    label(String.raw`date\s+of\s+issue`),
    label(String.raw`issue\s+date`),
    label(String.raw`registration\s+date`),
    label(String.raw`(?:attestation|tasdeeq|tawtheeq)\s+date`),
    label(String.raw`date\s+of\s+(?:attestation|registration)`),
    label(String.raw`issued`),
  ],
  propertyNo: [label(String.raw`property\s+(?:no|number)\.?`)],
  unitNo: [label(String.raw`unit\s+(?:no|number)\.?`)],
  makaniNo: [label(String.raw`makani\s+(?:no|number)\.?`)],
  tenant: [label(String.raw`tenant(?:\s+name)?`)],
  landlord: [label(String.raw`landlord(?:\s+name)?`), label(String.raw`owner(?:\s+name)?`)],
  period: [
    label(String.raw`(?:contract\s+|tenancy\s+|lease\s+)?period`),
    label(String.raw`(?:contract\s+|tenancy\s+)?term`),
  ],
  start: [
    label(String.raw`(?:contract\s+|tenancy\s+|lease\s+)?start(?:\s+date)?`),
    label(String.raw`commencement(?:\s+date)?`),
  ],
  end: [label(String.raw`(?:contract\s+|tenancy\s+|lease\s+)?end(?:\s+date)?`), label(String.raw`expiry(?:\s+date)?`)],
  rent: [
    label(String.raw`annual\s+rent(?:al)?`),
    label(String.raw`yearly\s+rent`),
    label(String.raw`rent\s+per\s+year`),
  ],
  fee: [
    label(String.raw`(?:registration|attestation|tawtheeq|ejari)\s+fees?(?:\s+paid)?`),
    label(String.raw`fees?\s+paid`),
    label(String.raw`(?:total\s+)?fees?`),
    label(String.raw`amount\s+paid`),
  ],
} as const;

/** The value after the first line-start label that matches, on the same line or the next one. */
function labelled(lines: string[], pats: readonly RegExp[]): string | undefined {
  for (const pat of pats) {
    for (let i = 0; i < lines.length; i++) {
      const m = pat.exec(lines[i]!);
      if (!m) continue;
      const v = (m[1] ?? "").trim() || (lines[i + 1] ?? "").trim();
      if (v) return v;
    }
  }
  return undefined;
}

const REF_TOKEN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,59}$/;
const token = (v: string | undefined): string | undefined => {
  const t = v?.split(/\s+/)[0]?.replace(/[.,;]+$/, "");
  return t && REF_TOKEN.test(t) ? t : undefined;
};
const cap = (v: string | undefined, n = 120) => (v ? v.slice(0, n) : undefined);

function moneyFils(v: string | undefined): number | undefined {
  const m = v && /(\d[\d,]*(?:\.\d{1,2})?)/.exec(v);
  if (!m) return undefined;
  try {
    return parseAed(m[1]!);
  } catch {
    return undefined;
  }
}

/** Pure code: reads the labelled values. A value is only taken after a label at the start of a line. */
export function parseCertificateText(text: string): CertificateRead {
  const lines = text
    .split(/\r?\n/)
    .map((l) => normalizeWs(l))
    .filter(Boolean);
  const out: CertificateRead = {};
  const ref = token(labelled(lines, LABELS.reference));
  if (ref && /\d/.test(ref)) out.reference = ref;
  const issued = labelled(lines, LABELS.issuedOn);
  const issuedOn = issued ? parseCertificateDate(issued) : undefined;
  if (issuedOn) out.issuedOn = issuedOn;
  const prop = token(labelled(lines, LABELS.propertyNo));
  if (prop) out.propertyNo = prop;
  const unit = token(labelled(lines, LABELS.unitNo));
  if (unit) out.unitNo = unit;
  const makani = token(labelled(lines, LABELS.makaniNo));
  if (makani) out.makaniNo = makani;
  const tenant = cap(labelled(lines, LABELS.tenant));
  if (tenant) out.tenant = tenant;
  const landlord = cap(labelled(lines, LABELS.landlord));
  if (landlord) out.landlord = landlord;
  const period = labelled(lines, LABELS.period);
  let start: string | undefined;
  let end: string | undefined;
  if (period) {
    const parts = period.split(/\s+(?:to|until|till|-|–)\s+/i);
    if (parts.length === 2) {
      start = parseCertificateDate(parts[0]!);
      end = parseCertificateDate(parts[1]!);
    }
  }
  if (!start) {
    const v = labelled(lines, LABELS.start);
    start = v ? parseCertificateDate(v) : undefined;
  }
  if (!end) {
    const v = labelled(lines, LABELS.end);
    end = v ? parseCertificateDate(v) : undefined;
  }
  if (start) out.startOn = start;
  if (end) out.endOn = end;
  const rent = moneyFils(labelled(lines, LABELS.rent));
  if (rent !== undefined) out.annualRentFils = rent;
  const fee = moneyFils(labelled(lines, LABELS.fee));
  if (fee !== undefined) out.feePaidFils = fee;
  return out;
}

export interface ReadCertificateOpts {
  /** Local model; asked only when the code found no reference. */
  llm?: Llm;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Reads a registration certificate PDF to prefill the manual-registration form. Code reads the labelled
 * values; the local model is asked for the reference and issue date only when the code found no
 * reference, and each value it returns must appear verbatim in the text. Nothing is stored, nothing
 * advances: a person checks and submits. The text is never logged (names, IDs).
 */
export async function readCertificate(bytes: Uint8Array, opts: ReadCertificateOpts = {}): Promise<CertificateResult> {
  const ex = await extractPdf(bytes);
  if (!ex.ok) return { status: "unreadable", reason: ex.message };
  const read = parseCertificateText(ex.text);
  if (read.reference || !opts.llm) return { status: "ok", read, source: "code" };

  const haystack = normalizeWs(ex.text);
  let used = false;
  let answered = false;
  for (let attempt = 0; attempt < 2 && !used; attempt++) {
    try {
      const r = await opts.llm.chat(certificateMessages(ex.text), {
        schema: ModelCertificate,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      const parsed = ModelCertificate.safeParse(r.parsed);
      if (!parsed.success) continue;
      answered = true;
      const ref = parsed.data.reference ? normalizeWs(parsed.data.reference) : undefined;
      if (ref && haystack.includes(ref) && /\d/.test(ref) && REF_TOKEN.test(ref)) {
        read.reference = ref;
        used = true;
      }
      const when = parsed.data.issuedOn ? normalizeWs(parsed.data.issuedOn) : undefined;
      const date = when && haystack.includes(when) ? parseCertificateDate(when) : undefined;
      if (date && !read.issuedOn) {
        read.issuedOn = date;
        used = true;
      }
      break;
    } catch {
      // timeout or an unparsable answer: one retry, then leave it unread
    }
  }
  // The model was asked and gave no usable answer twice (timeout, error or invalid): the person types it.
  return { status: "ok", read, source: used ? "model" : "code", ...(answered ? {} : { modelFailed: true as const }) };
}
