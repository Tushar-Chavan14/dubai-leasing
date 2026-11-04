import { z } from "zod";
import {
  AppliesTo,
  checksFor,
  CROSS_CHECKS,
  defaultDocRules,
  effectiveCross,
  expiryFor,
  fieldRules,
  type FormField,
  FormDocumentKind,
  FormFieldType,
  issueFor,
  KycCompanyRule,
  type KycDocRules,
  type KycRules,
  KycSeverity,
  type ReadDocKind,
} from "./kyc-config.ts";

/**
 * Edits to a company's document form and KYC rules, as the staff copilot sends them (D50). Each names a field by its
 * key, its label or its category ("passport"), and is applied to the draft by `applyKycOps`, then validated exactly
 * like a save from the settings page.
 */
const Ref = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .describe('The form field: its label as shown on the form (e.g. "Emirates ID, front"), its key, or "passport"');

/** Words the model may use for a number setting, mapped to the setting. */
const SETTING_WORDS: [RegExp, "validity_days" | "read_confidence_pct" | "issued_within_days"][] = [
  [/issu/i, "issued_within_days"],
  [/confiden|read|clear/i, "read_confidence_pct"],
  [/valid|expir|days/i, "validity_days"],
];
const Setting = z.preprocess(
  (v) => (typeof v === "string" ? (SETTING_WORDS.find(([re]) => re.test(v))?.[1] ?? v) : v),
  z.enum(["validity_days", "read_confidence_pct", "issued_within_days"]),
);
const Check = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .describe(
    "expired, valid_long_enough, issued_recently, readable, right_document, id_number, birth_year, mrz, mrz_matches_page, visa_number, passport_matches, name_matches; across documents: required_documents, names_consistent, applicant_name",
  );
export const KycOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set_check"),
    /** A document field, or "across documents" for the checks across documents. */
    field: Ref.describe(
      'The form field, or "across documents" for required_documents, names_consistent, applicant_name',
    ),
    check: Check,
    severity: KycSeverity.optional(),
    emailApplicant: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("set_number"),
    field: Ref,
    setting: Setting.describe(
      "validity_days (valid at least N days after the lease starts), read_confidence_pct (50-100), issued_within_days",
    ),
    value: z.coerce.number().int().min(0).max(3650),
  }),
  z.object({ op: z.literal("set_name_match"), mode: z.enum(["lenient", "exact"]) }),
  z.object({
    op: z.literal("add_document_field"),
    label: z.string().trim().min(1).max(80),
    category: FormDocumentKind,
    customName: z.string().trim().min(2).max(60).optional(),
    customDescription: z.string().trim().max(200).optional(),
    hasExpiry: z.boolean().optional(),
    required: z.boolean().default(true),
    shownTo: AppliesTo.default("both"),
    help: z.string().trim().max(200).optional(),
  }),
  z.object({
    op: z.literal("add_question_field"),
    label: z.string().trim().min(1).max(80),
    type: FormFieldType.exclude(["document"]),
    required: z.boolean().default(false),
    shownTo: AppliesTo.default("both"),
    options: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    help: z.string().trim().max(200).optional(),
  }),
  z.object({
    op: z.literal("update_field"),
    field: Ref,
    label: z.string().trim().min(1).max(80).optional(),
    required: z.boolean().optional(),
    shownTo: AppliesTo.optional(),
    help: z.string().trim().max(200).optional(),
  }),
  z.object({ op: z.literal("remove_field"), field: Ref }),
  z.object({
    op: z.literal("add_rule"),
    /** A custom check as the settings page saves it, without its id. */
    rule: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal("set_rule"),
    rule: Ref,
    severity: KycSeverity.optional(),
    emailApplicant: z.boolean().optional(),
  }),
  z.object({ op: z.literal("remove_rule"), rule: Ref }),
  z.object({ op: z.literal("publish") }),
]);
export type KycOp = z.infer<typeof KycOp>;

/** Thrown when an edit can't be applied as asked (unknown field or check); the message says why. */
export class KycOpError extends Error {}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[,.:;()'"?!]/g, " ")
    .replace(/[\s_-]+/g, " ")
    .trim();
const CATEGORY_WORDS: Record<string, string[]> = {
  emirates_id_front: ["emirates id", "emirates id front", "eid", "eid front"],
  emirates_id_back: ["emirates id back", "eid back"],
  passport: ["passport"],
  visa: ["visa", "residence visa"],
  trade_licence: ["trade licence", "trade license", "licence", "license"],
};

/** Check names the model may use: the setting key, or the question shown on the settings page. */
const CHECK_WORDS: Record<string, string[]> = {
  expired: ["has it expired", "expiry", "expired"],
  valid_long_enough: ["valid long enough", "validity", "valid"],
  issued_recently: ["issued recently", "issue date", "issued"],
  readable: ["read clearly", "readable", "read confidence", "clear"],
  right_document: ["right document", "wrong document", "document type"],
  id_number: ["id number valid", "id number", "eid number"],
  birth_year: ["birth year matches", "birth year"],
  mrz: ["bottom two lines valid", "mrz"],
  mrz_matches_page: ["bottom lines match the page", "mrz matches page"],
  visa_number: ["visa file number valid", "visa number", "file number"],
  passport_matches: ["same passport", "passport matches"],
  name_matches: ["holder is the applicant", "name matches", "holder"],
  required_documents: ["everything uploaded", "required documents"],
  names_consistent: ["same name everywhere", "names consistent"],
  applicant_name: ["applicant s name matches", "applicant name"],
};
/** The check id a name means (unknown names are returned as given, so the error lists the real ones). */
export function checkId(ref: string): string {
  const r = norm(ref);
  const key = r.replace(/ /g, "_");
  if (CHECK_WORDS[key]) return key;
  return Object.entries(CHECK_WORDS).find(([, words]) => words.includes(r))?.[0] ?? ref;
}

/** Every name a field is known by: its label, key, custom name and its category's usual names. */
export function fieldAliases(f: FormField): string[] {
  return [
    f.label,
    f.key,
    ...(f.customCategory ? [f.customCategory.name] : []),
    ...((f.documentKind && CATEGORY_WORDS[f.documentKind]) || []),
  ];
}

/** The field a reference names: its key, its label, its custom name, or its category's usual name. */
export function findField(form: readonly FormField[], ref: string): FormField {
  const r = norm(ref);
  const hits = form.filter(
    (f) =>
      norm(f.key) === r ||
      norm(f.label) === r ||
      (f.customCategory && norm(f.customCategory.name) === r) ||
      (f.documentKind && CATEGORY_WORDS[f.documentKind]?.includes(r)),
  );
  if (hits.length === 1) return hits[0]!;
  if (!hits.length && r.length >= 4) {
    const loose = form.filter((f) => norm(f.label).includes(r) || r.includes(norm(f.label)));
    if (loose.length === 1) return loose[0]!;
  }
  if (hits.length > 1)
    throw new KycOpError(`"${ref}" matches more than one field: ${hits.map((h) => h.label).join(", ")}`);
  throw new KycOpError(
    `no field "${ref}" on the form. "field" must be one of the form's fields: ${form.map((f) => `"${f.label}"`).join(", ")}${
      checkId(ref) !== ref || /days|confiden|valid|issu/i.test(ref)
        ? `; "${ref}" looks like a check or setting, not a field`
        : ""
    }`,
  );
}

function findRule(rules: KycRules, ref: string) {
  const r = norm(ref);
  const hits = rules.company.filter((x) => x.id === ref || norm(x.label) === r);
  if (hits.length === 1) return hits[0]!;
  throw new KycOpError(
    hits.length
      ? `"${ref}" matches more than one custom check`
      : `no custom check "${ref}" (custom checks: ${rules.company.map((x) => x.label).join(", ") || "none"})${
          checkId(ref) !== ref || CHECK_WORDS[norm(ref).replace(/ /g, "_")]
            ? `. "${ref}" is a document check: use {"op":"set_check","field":"<the document field>","check":"${checkId(ref)}"}`
            : ""
        }`,
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 36) || "field";

function uniqueKey(form: readonly FormField[], label: string): string {
  const base = slug(label).length >= 2 ? slug(label) : "field";
  let k = base;
  for (let n = 2; form.some((f) => f.key === k); n++) k = `${base}_${n}`;
  return k;
}

/** A field's rules with the change applied (starting from its defaults when it has none yet). */
function withRules(
  f: FormField,
  change: (r: KycDocRules, kind: ReadDocKind | "custom") => void,
  base: KycRules["base"],
): FormField {
  const kind = f.type === "document" ? f.documentKind : undefined;
  if (!kind || kind === "other")
    throw new KycOpError(`"${f.label}" isn't a document the helper reads, so it has no checks`);
  const r = structuredClone(f.rules ?? defaultDocRules(kind, base, f.customCategory));
  change(r, kind);
  return { ...f, rules: r };
}

/**
 * Applies edits to a config, in order. Pure: the caller validates the result (`validateKycConfig`) and saves it as the
 * draft. `publish` is returned, not applied here.
 */
export function applyKycOps(
  config: { form: FormField[]; rules: KycRules },
  ops: readonly KycOp[],
): { form: FormField[]; rules: KycRules; publish: boolean } {
  let form = structuredClone(config.form);
  const rules = structuredClone(config.rules);
  let publish = false;
  const replace = (f: FormField, next: FormField) => (form = form.map((x) => (x.key === f.key ? next : x)));
  for (const given of ops) {
    const op: KycOp = given.op === "set_check" ? { ...given, check: checkId(given.check) } : given;
    switch (op.op) {
      case "set_check": {
        if (norm(op.field) === "across documents" || (CROSS_CHECKS as readonly string[]).includes(op.check)) {
          if (!(CROSS_CHECKS as readonly string[]).includes(op.check))
            throw new KycOpError(`"${op.check}" isn't a check across documents (${CROSS_CHECKS.join(", ")})`);
          const cross = rules.base.checks ?? effectiveCross(rules.base);
          const cur = cross.cross[op.check]!;
          const severity = op.severity ?? cur.severity;
          cross.cross[op.check] = {
            severity,
            emailApplicant: severity === "blocker" && (op.emailApplicant ?? cur.emailApplicant),
          };
          rules.base.checks = cross;
          break;
        }
        const f = findField(form, op.field);
        replace(
          f,
          withRules(
            f,
            (r, kind) => {
              if (!checksFor(kind, f.customCategory).includes(op.check))
                throw new KycOpError(
                  `"${f.label}" has no check "${op.check}" (checks: ${checksFor(kind, f.customCategory).join(", ")})`,
                );
              if (op.severity === undefined && op.emailApplicant === undefined)
                throw new KycOpError(`say what to change on "${op.check}": a severity or the email switch`);
              // A check the field doesn't list yet starts from its default, not from off.
              const cur = r.checks[op.check] ?? fieldRules(f, kind, rules.base).checks[op.check]!;
              const severity = op.severity ?? cur.severity;
              r.checks[op.check] = {
                severity,
                emailApplicant: severity === "blocker" && (op.emailApplicant ?? cur.emailApplicant),
              };
            },
            rules.base,
          ),
        );
        break;
      }
      case "set_number": {
        const f = findField(form, op.field);
        replace(
          f,
          withRules(
            f,
            (r, kind) => {
              if (op.setting === "validity_days") {
                if (!expiryFor(kind, f.customCategory)) throw new KycOpError(`"${f.label}" has no expiry date`);
                r.validityDays = op.value;
              } else if (op.setting === "issued_within_days") {
                if (!issueFor(kind)) throw new KycOpError(`"${f.label}" has no issue date the helper reads`);
                r.issuedWithinDays = op.value;
              } else {
                if (op.value < 50 || op.value > 100)
                  throw new KycOpError("read confidence is a percentage from 50 to 100");
                r.minConfidence = op.value / 100;
              }
            },
            rules.base,
          ),
        );
        break;
      }
      case "set_name_match": {
        const cross = rules.base.checks ?? effectiveCross(rules.base);
        rules.base.checks = { ...cross, applicantNameMode: op.mode };
        break;
      }
      case "add_document_field": {
        const custom =
          op.category === "custom"
            ? {
                name: op.customName ?? op.label,
                description: op.customDescription ?? "",
                hasExpiry: op.hasExpiry ?? true,
              }
            : undefined;
        const read = op.category !== "other";
        form.push({
          key: uniqueKey(form, op.label),
          label: op.label,
          placeholder: "",
          help: op.help ?? "",
          type: "document",
          required: op.required,
          appliesTo: op.shownTo,
          options: [],
          documentKind: op.category,
          nameAsPerDocuments: false,
          ...(custom ? { customCategory: custom } : {}),
          ...(read ? { rules: defaultDocRules(op.category as ReadDocKind | "custom", rules.base, custom) } : {}),
        });
        break;
      }
      case "add_question_field":
        form.push({
          key: uniqueKey(form, op.label),
          label: op.label,
          placeholder: "",
          help: op.help ?? "",
          type: op.type,
          required: op.required,
          appliesTo: op.shownTo,
          options: op.options ?? [],
          nameAsPerDocuments: false,
        });
        break;
      case "update_field": {
        const f = findField(form, op.field);
        replace(f, {
          ...f,
          ...(op.label !== undefined ? { label: op.label } : {}),
          ...(op.required !== undefined ? { required: op.required } : {}),
          ...(op.shownTo !== undefined ? { appliesTo: op.shownTo } : {}),
          ...(op.help !== undefined ? { help: op.help } : {}),
        });
        break;
      }
      case "remove_field": {
        const f = findField(form, op.field);
        const users = rules.company.filter(
          (r) => (r.type === "answer_matches_document" || r.type === "answer_required") && r.fieldKey === f.key,
        );
        if (users.length)
          throw new KycOpError(
            `custom checks use "${f.label}" (${users.map((r) => r.label).join(", ")}); remove them first`,
          );
        form = form.filter((x) => x.key !== f.key);
        break;
      }
      case "add_rule": {
        const raw = {
          severity: "warning",
          emailApplicant: false,
          ...op.rule,
          id: `r${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
        };
        const parsed = KycCompanyRule.safeParse(raw);
        if (!parsed.success)
          throw new KycOpError(
            `the custom check isn't valid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
          );
        rules.company.push(parsed.data);
        break;
      }
      case "set_rule": {
        const r = findRule(rules, op.rule);
        const severity = op.severity ?? r.severity;
        Object.assign(r, {
          severity,
          emailApplicant: severity === "blocker" && (op.emailApplicant ?? r.emailApplicant),
        });
        break;
      }
      case "remove_rule": {
        const r = findRule(rules, op.rule);
        rules.company = rules.company.filter((x) => x.id !== r.id);
        break;
      }
      case "publish":
        publish = true;
        break;
    }
  }
  return { form, rules, publish };
}
