/**
 * The SPA profile for the shared agreement reader (S5, S34, S43, S44): Seller / Purchaser / Broker parties, the SPA data
 * sheet (`spaDataSheet`), code label rules, numbered party slots and instalments. Code decides first; the decision model
 * only picks from key descriptions for what is left, and code checks its answer (type and party).
 */
import { type SheetKeyInfo, SPA_SHEET_ALIASES, spaDataSheet, type SpaSheetKey } from "@spa/core";
import type { FieldInfo, FieldType } from "@platform/readers/structure/types";
import type { TemplateParty, TemplateProfile } from "@platform/readers/structure/profile";

export type SpaTemplateRole = "seller" | "purchaser" | "broker";

const PARTIES: readonly TemplateParty[] = Object.freeze([
  Object.freeze({ role: "seller", words: Object.freeze(["seller", "vendor", "developer", "transferor"]) }),
  Object.freeze({ role: "purchaser", words: Object.freeze(["purchaser", "buyer", "transferee"]) }),
  Object.freeze({ role: "broker", words: Object.freeze(["broker", "brokerage", "agent", "agency"]) }),
]);

/** The data-sheet group a party's own keys sit in. */
const GROUP_OF_ROLE: Record<SpaTemplateRole, SheetKeyInfo["group"]> = {
  seller: "seller",
  purchaser: "buyer",
  broker: "broker",
};

export const MAX_PARTY_SLOT = 10;
export const MAX_INSTALMENT = 60;
const GENERIC_INSTALMENT = new Set<string>(["instalment_n_amount", "instalment_n_due"]);
const INSTALMENT_RE = /^instalment_([1-9]\d?)_(amount|due)$/;
const SLOT_RE = /^([a-z_]+?)_([1-9]\d?)$/;

/** Reader types: `bps` and `table` keys read as text; C14 prints them from `spaDataSheet`'s own type. */
const readerType = (t: SheetKeyInfo["type"]): FieldType => (t === "bps" || t === "table" ? "text" : t);

const plainInfo = (key: string): SheetKeyInfo | null =>
  Object.hasOwn(spaDataSheet, key) && !GENERIC_INSTALMENT.has(key) ? spaDataSheet[key as SpaSheetKey] : null;

const ROLE_WORD: Record<"buyer" | "seller", string> = { buyer: "Purchaser", seller: "Seller" };

function keyInfo(key: string): FieldInfo | null {
  const plain = plainInfo(key);
  if (plain) return { type: readerType(plain.type), label: plain.label };
  const inst = INSTALMENT_RE.exec(key);
  if (inst && Number(inst[1]) <= MAX_INSTALMENT)
    return inst[2] === "amount"
      ? { type: "money_fils", label: `Instalment ${inst[1]} amount` }
      : { type: "date", label: `Instalment ${inst[1]} due date` };
  const slot = SLOT_RE.exec(key);
  if (slot && Number(slot[2]) <= MAX_PARTY_SLOT) {
    const base = plainInfo(slot[1]!);
    if (base?.repeat) {
      const word = ROLE_WORD[base.repeat];
      return { type: readerType(base.type), label: base.label.replace(word, `${word} ${slot[2]}`) };
    }
  }
  return null;
}

const KEY_NAMES: readonly string[] = Object.freeze(Object.keys(spaDataSheet).filter((k) => !GENERIC_INSTALMENT.has(k)));

function forPrompt(): string {
  const rows = KEY_NAMES.map((k) => {
    const i = spaDataSheet[k as SpaSheetKey];
    return `${k} | ${readerType(i.type)} | ${i.label}${i.repeat ? " (per party; numbered blocks: add _1, _2, …)" : ""}`;
  });
  rows.push(
    "instalment_<n>_amount | money_fils | Instalment amount; replace <n> with the instalment number",
    "instalment_<n>_due | date | Instalment due date; replace <n> with the instalment number",
  );
  return rows.join("\n");
}

const isKey = (key: string): boolean => keyInfo(key) !== null;

/** The plain key a slot key stands for (`purchaser_name_2` → `purchaser_name`). */
const baseKey = (key: string): string => {
  const slot = SLOT_RE.exec(key);
  return slot && plainInfo(slot[1]!)?.repeat ? slot[1]! : key;
};

function keyFitsParty(key: string, party: string | null): boolean {
  if (party === null) return true;
  const group = plainInfo(baseKey(key))?.group;
  const own = Object.values(GROUP_OF_ROLE);
  if (!group || !own.includes(group)) return true;
  return GROUP_OF_ROLE[party as SpaTemplateRole] === group;
}

// ---- label rules ---------------------------------------------------------------------------------------------------

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();

const wordsRe = (words: readonly string[]) => new RegExp(`\\b(?:${words.join("|")})s?\\b`);
const ROLE_RES = PARTIES.map((p) => ({ role: p.role as SpaTemplateRole, re: wordsRe(p.words) }));

/** The one party a text names, or null (none or several). */
function ownParty(text: string): SpaTemplateRole | null {
  const named = ROLE_RES.filter((r) => r.re.test(text));
  return named.length === 1 ? named[0]!.role : null;
}

const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

function instalmentKey(t: string): string | null {
  if (!/\binstal+ments?\b/.test(t)) return null;
  const m =
    /\binstal+ments?\s*(?:no\s*)?(\d{1,3})\b/.exec(t) ?? /\b(\d{1,3})\s*(?:st|nd|rd|th)?\s*instal+ments?\b/.exec(t);
  const word = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+instal+ments?\b/.exec(t);
  const n = m ? Number(m[1]) : word ? ORDINALS[word[1]!]! : null;
  if (n === null) return null;
  if (n < 1 || n > MAX_INSTALMENT) return "none";
  if (/\b(due|date)\b/.test(t)) return `instalment_${n}_due`;
  if (/\b(amount|aed|value|sum)\b/.test(t)) return `instalment_${n}_amount`;
  return null;
}

function buyerKey(t: string): string | null {
  if (/\bsignatory\b/.test(t)) {
    if (/\b(title|designation|position|capacity)\b/.test(t)) return "purchaser_signatory_title";
    if (/\bname\b/.test(t) || t.split(" ").length <= 3) return "purchaser_signatory_name";
    return null;
  }
  if (/\b(trade )?licen[cs]e\b/.test(t)) return "purchaser_licence_no";
  if (/\bnationality\b/.test(t)) return "purchaser_nationality";
  if (/\bpassport\b/.test(t)) return "purchaser_passport_no";
  if (/\b(emirates id|eid)\b/.test(t)) return "purchaser_eid_no";
  if (/\baddress\b/.test(t)) return "purchaser_address";
  if (/\be ?mail\b/.test(t)) return "purchaser_email";
  if (/\b(phone|mobile|tel|telephone)\b/.test(t)) return "purchaser_phone";
  if (/\bshare\b|%/.test(t)) return "purchaser_share";
  if (/\bname\b/.test(t)) return "purchaser_name";
  return null;
}

function sellerKey(t: string): string | null {
  if (/\bsignatory\b/.test(t)) {
    if (/\b(title|designation|position|capacity)\b/.test(t)) return "seller_signatory_title";
    if (/\bname\b/.test(t) || t.split(" ").length <= 3) return "seller_signatory_name";
    return null;
  }
  if (/\b(trade )?licen[cs]e\b/.test(t)) return "seller_licence_no";
  if (/\b(passport|emirates id|eid|id)\b/.test(t)) return "seller_id_no";
  if (/\baddress\b/.test(t)) return "seller_address";
  if (/\bshare\b|%/.test(t)) return "seller_share";
  if (/\bname\b/.test(t)) return "seller_name";
  return null;
}

function brokerKey(t: string): string | null {
  if (/\b(orn|office registration)\b/.test(t)) return "broker_orn";
  if (/\b(brn|broker registration)\b/.test(t)) return "broker_brn";
  if (/\bcommission\b/.test(t)) return "broker_commission";
  if (/\b(agency|brokerage|company|office)\b/.test(t) && /\bname\b|^\w+$/.test(t)) return "broker_agency";
  if (/\bname\b/.test(t)) return "broker_agent_name";
  return null;
}

/** Labels that name a key with no party. Order matters: specific before general. */
const GENERAL: [RegExp, string][] = [
  [/\b(orn|office registration number)\b/, "broker_orn"],
  [/\b(brn|broker registration number)\b/, "broker_brn"],
  [/\bin words\b/, "price_words"],
  [/\b(dld|registration|transfer) fees?\b/, "dld_fee"],
  [/\boqood fees?\b/, "oqood_fee"],
  [/\boqood (no|number|ref|reference)\b/, "oqood_no"],
  [/\btitle deed\b/, "title_deed_no"],
  [/\bnoc\b/, "noc_ref"],
  [/\b(booking|reservation) (amount|fee|deposit)\b/, "booking_amount"],
  [/\b(booking|reservation) (no|number|ref|reference)\b/, "booking_ref"],
  [/\bsecurity deposit\b|\bdeposit amount\b/, "deposit_amount"],
  [/\bloan amount\b|\bmortgage amount\b/, "loan_amount"],
  [/\bdiscount\b/, "discount"],
  [/\b(sale|purchase|total|selling) price\b|^price\b/, "price"],
  [/\bpayment (plan|schedule)\b/, "payment_plan"],
  [/\bsettlement (statement|table)\b/, "settlement_table"],
  [/\btransfer date\b|\bdate of transfer\b/, "transfer_date"],
  [/\b(anticipated|expected|estimated) (completion|handover)\b/, "anticipated_completion"],
  [/\b(agreement date|date of (this )?agreement)\b/, "agreement_date"],
  [/\bgoverning law\b/, "governing_law"],
  [/\bdispute\b/, "dispute_body"],
  [/\badditional (terms|conditions)\b|\bspecial conditions\b/, "additional_terms"],
  [/\bproject\b/, "project_name"],
  [/\bplot\b/, "plot_no"],
  [/\bfloor\b/, "floor"],
  [/\bparking\b/, "parking"],
  [/\b(sq ft|sqft|square feet|area)\b/, "area_sqft"],
  [/\bunit type\b|\bproperty type\b/, "unit_type"],
  [/\bunit\b|\bapartment no\b|\bvilla no\b/, "unit_no"],
  [/\bbuilding\b|\btower\b/, "building"],
  [/\bseller s bank\b|\bseller bank\b/, "seller_bank"],
  [/\bbuyer s bank\b|\bbuyer bank\b|\bpurchaser s bank\b|\bmortgage bank\b/, "buyer_bank"],
];

/** Code label rules: a data-sheet key, "leave_empty", or null when the label says nothing certain. */
export function matchLabel(label: string, party: string | null): string | null {
  const t = norm(label);
  if (!t) return null;
  const inst = instalmentKey(t);
  if (inst) return inst === "none" ? null : inst;
  const own = ownParty(t) ?? (party as SpaTemplateRole | null);
  // A bank belongs to a side, not to a party block.
  if (!/\bbank\b/.test(t)) {
    if (own === "broker") {
      const k = brokerKey(t);
      if (k) return k;
    } else if (own === "purchaser") {
      const k = buyerKey(t);
      if (k) return k;
    } else if (own === "seller") {
      const k = sellerKey(t);
      if (k) return k;
    }
  }
  for (const [re, key] of GENERAL) if (re.test(t)) return key;
  return null;
}

/** Code rule on the words right after a blank. */
export function matchAfter(after: string): string | null {
  return /^\s*(sq\.?\s?ft|sqft|square\s+feet)\b/i.test(after) ? "area_sqft" : null;
}

// ---- party slots ---------------------------------------------------------------------------------------------------

const SLOT_ROLES: { role: "purchaser" | "seller"; group: "buyer" | "seller"; words: string }[] = [
  { role: "purchaser", group: "buyer", words: "purchaser|buyer|transferee" },
  { role: "seller", group: "seller", words: "seller|vendor|transferor" },
];
const ORDINAL_WORDS = Object.keys(ORDINALS).join("|");

/** Every numbered mention of a party in a line, in order: "Purchaser 2", "Buyer (2)", "Second Purchaser". */
export function slotMarks(line: string): { group: "buyer" | "seller"; n: number; at: number }[] {
  const out: { group: "buyer" | "seller"; n: number; at: number }[] = [];
  for (const r of SLOT_ROLES) {
    const num = new RegExp(`\\b(?:${r.words})\\s*(?:no\\.?\\s*)?\\(?(\\d{1,3})\\)?(?!\\s*%)`, "gi");
    for (const m of line.matchAll(num)) out.push({ group: r.group, n: Number(m[1]), at: m.index });
    const ord = new RegExp(`\\b(${ORDINAL_WORDS})\\s+(?:${r.words})\\b`, "gi");
    for (const m of line.matchAll(ord)) out.push({ group: r.group, n: ORDINALS[m[1]!.toLowerCase()]!, at: m.index });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** A line naming the party with no number ("SELLER", "The Purchaser"): its later blanks are the repeatable block. */
const unnumberedRe = (words: string) => new RegExp(`\\b(?:${words})s?\\b(?!\\s*(?:no\\.?\\s*)?\\(?\\d)`, "i");

/**
 * After mapping, by code: a party key under a numbered party ("PURCHASER 2", "Second Purchaser") becomes its slot key
 * (`purchaser_name_2`); slots above 10 are left empty; unnumbered blocks keep the plain key (printed per party).
 */
function numberPartySlots<B extends { id: string; field: string }>(
  texts: readonly (string | null | undefined)[],
  blanks: B[],
): B[] {
  const slotOf = new Map<string, number>();
  const current: Record<"buyer" | "seller", number | null> = { buyer: null, seller: null };
  for (const text of texts) {
    for (const line of (text ?? "").split("\n")) {
      const marks = slotMarks(line);
      const tokens = [...line.matchAll(/\{\{(b\d+)\}\}/g)];
      // A line naming a party without a number, before any numbered mark, resets that side.
      for (const r of SLOT_ROLES) {
        const plain = unnumberedRe(r.words).exec(line);
        const firstMark = marks.find((m) => m.group === r.group);
        if (plain && (!firstMark || plain.index < firstMark.at) && !tokens.some((t) => t.index < plain.index))
          current[r.group] = null;
      }
      for (const tok of tokens) {
        for (const m of marks) if (m.at < tok.index) current[m.group] = m.n;
        const id = tok[1]!;
        const field = blanks.find((b) => b.id === id)?.field;
        const group = field ? plainInfo(field)?.repeat : undefined;
        const n = group ? current[group] : null;
        if (n !== null && n !== undefined) slotOf.set(id, n);
      }
      for (const m of marks) current[m.group] = m.n;
    }
  }
  return blanks.map((b) => {
    const n = slotOf.get(b.id);
    if (n === undefined) return b;
    return n >= 1 && n <= MAX_PARTY_SLOT ? { ...b, field: `${b.field}_${n}` } : { ...b, field: "leave_empty" };
  });
}

/** The parties a template names and the numbered slots it prints (C13 stores this; C14 checks slots vs buyers). */
export function partyBlocks(lines: readonly string[]): { role: SpaTemplateRole; slots: number[] }[] {
  const text = lines.join("\n");
  const out: { role: SpaTemplateRole; slots: number[] }[] = [];
  for (const p of PARTIES) {
    const role = p.role as SpaTemplateRole;
    if (!wordsRe(p.words).test(text.toLowerCase())) continue;
    const group = role === "purchaser" ? "buyer" : role === "seller" ? "seller" : null;
    const slots = group
      ? [
          ...new Set(
            lines.flatMap((l) =>
              slotMarks(l)
                .filter((m) => m.group === group)
                .map((m) => m.n),
            ),
          ),
        ].sort((a, b) => a - b)
      : [];
    out.push({ role, slots });
  }
  return out;
}

/** The party of each signature blank: from its label, else the last line before it; null when it names none. */
export function signatureRoles(
  blanks: readonly { id: string; role: string; label: string; before: string }[],
): Record<string, SpaTemplateRole | null> {
  const out: Record<string, SpaTemplateRole | null> = {};
  for (const b of blanks) {
    if (b.role !== "signature") continue;
    const lastLine =
      b.before
        .split("\n")
        .map((l) => l.trim())
        .findLast((l) => l.length > 0) ?? "";
    out[b.id] = ownParty(norm(b.label)) ?? ownParty(norm(lastLine));
  }
  return out;
}

const LABEL_WORDS: ReadonlySet<string> = new Set([
  "name",
  "nationality",
  "passport",
  "emirates",
  "id",
  "address",
  "email",
  "mail",
  "phone",
  "mobile",
  "tel",
  "telephone",
  "project",
  "building",
  "tower",
  "unit",
  "floor",
  "plot",
  "area",
  "parking",
  "price",
  "amount",
  "fee",
  "fees",
  "date",
  "licence",
  "license",
  "orn",
  "brn",
  "commission",
  "deposit",
  "share",
  "signatory",
  "designation",
  "bank",
  "noc",
  "deed",
  "oqood",
]);

const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  ...SPA_SHEET_ALIASES,
  buyer: "purchaser_name",
  purchaser: "purchaser_name",
  seller: "seller_name",
  vendor: "seller_name",
  developer: "seller_name",
  price: "price",
  paymentplan: "payment_plan",
  paymentschedule: "payment_plan",
  agencyname: "broker_agency",
  brokername: "broker_agent_name",
  agentname: "broker_agent_name",
});

export const spaTemplateProfile: TemplateProfile = Object.freeze({
  helperName: "spa_template",
  structureIntro:
    "You read a company's sample property sale agreement (SPA, MOU, assignment or listing agreement) and describe its structure so it can be reused as a template.",
  labelExamples: '"Purchase price", "Purchaser nationality", "Broker ORN"',
  mappingIntro: "You match blanks of a company's property sale agreement template to the data the system holds.",
  partyKeyRule:
    "A seller blank never takes a purchaser or broker key, a purchaser blank never takes a seller or broker key, and a broker blank never takes a seller or purchaser key.",
  parties: PARTIES,
  sheet: Object.freeze({ isKey, keyNames: KEY_NAMES, keyInfo, forPrompt }),
  placeholderAliases: ALIASES,
  matchLabel,
  matchAfter,
  labelWords: LABEL_WORDS,
  keyFitsParty,
  afterMapping: numberPartySlots,
});

/** The one party a piece of text names ("PURCHASER", "Seller signature"), or null (none or several). */
export const partyNamedIn = (text: string): SpaTemplateRole | null => ownParty(norm(text));

/** A data-sheet key split into its plain key and slot: `purchaser_name_2` is `purchaser_name`, slot 2. */
export function splitSlotKey(key: string): { key: string; slot: number | null } {
  const slot = SLOT_RE.exec(key);
  if (slot && Number(slot[2]) <= MAX_PARTY_SLOT && plainInfo(slot[1]!)?.repeat) {
    return { key: slot[1]!, slot: Number(slot[2]) };
  }
  return { key, slot: null };
}

/** The slot a party signature line is numbered with ("Purchaser 2 signature"), else null. */
export function signatureSlots(
  blanks: readonly { id: string; role: string; label: string; before: string }[],
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const b of blanks) {
    if (b.role !== "signature") continue;
    const lastLine =
      b.before
        .split("\n")
        .map((l) => l.trim())
        .findLast((l) => l.length > 0) ?? "";
    const mark = [...slotMarks(b.label), ...slotMarks(lastLine)].at(-1);
    out[b.id] = mark && mark.n <= MAX_PARTY_SLOT ? mark.n : null;
  }
  return out;
}
