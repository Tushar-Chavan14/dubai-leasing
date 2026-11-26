/**
 * Template checks (S45), by code only: run on every template version before `template_approval` and again whenever an
 * admin remaps a blank. A blocker refuses approval; a warning is shown to legal. Messages never repeat a sample value.
 */
import { fixedValueKinds } from "@platform/readers/structure/values";
import type { TemplateBlank } from "@platform/readers/structure/schema";
import { isPending, pendingReason, type SalesRulebook } from "@spa/rulebook";

export const SPA_DOCUMENT_KINDS = ["spa", "mou", "assignment", "listing_agreement"] as const;
export type SpaDocumentKind = (typeof SPA_DOCUMENT_KINDS)[number];

export type TemplateCheckCode =
  | "sample_value"
  | "authority_marks"
  | "fee_rate"
  | "missing_core_key"
  | "no_payment_plan"
  | "unmapped_blank";

export interface TemplateCheck {
  code: TemplateCheckCode;
  severity: "blocker" | "warning";
  message: string;
  blankId?: string;
}

export interface TemplateCheckInput {
  documentKind: SpaDocumentKind;
  /** The fixed wording: title, headings and paragraphs, blanks as `{{bN}}`. */
  paragraphs: readonly string[];
  blanks: readonly TemplateBlank[];
  /** The reader's header/footer/logo-area flag (rule 9). */
  authorityMarks: boolean;
  rulebook: SalesRulebook;
}

/** Keys a template of each kind must print somewhere (slot keys count: `purchaser_name_1` is a `purchaser_name`). */
export const REQUIRED_TEMPLATE_KEYS: Readonly<Record<SpaDocumentKind, readonly string[]>> = Object.freeze({
  spa: ["seller_name", "purchaser_name", "unit_no", "price"],
  mou: ["seller_name", "purchaser_name", "unit_no", "price"],
  assignment: ["seller_name", "purchaser_name", "unit_no", "price"],
  listing_agreement: ["seller_name", "unit_no", "price"],
});

/** Grouped amounts with no currency word next to them ("1,250,000"). */
const GROUPED_NUMBER = /\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b/;
const FEE_WORDS = /\b(?:registration|transfer)\s+fees?\b|\bDLD\b|\bland department\b/gi;
/** A rate counts as the fee rate only this close to the fee words (a booking % in the same sentence doesn't). */
const FEE_NEAR = 40;
const PERCENT = /(\d{1,2}(?:\.\d{1,2})?)\s*%/g;

const baseOf = (field: string): string => field.replace(/_(?:[1-9]|10)$/, "");

export function templateChecks(input: TemplateCheckInput): TemplateCheck[] {
  const out: TemplateCheck[] = [];
  const wording = input.paragraphs.map((p) => p.replace(/\{\{b\d+\}\}/g, " "));

  const kinds = new Set<string>();
  for (const w of wording) {
    for (const k of fixedValueKinds(w)) kinds.add(k);
    if (GROUPED_NUMBER.test(w)) kinds.add("an amount");
  }
  for (const k of kinds)
    out.push({
      code: "sample_value",
      severity: "blocker",
      message: `The fixed wording still holds ${k} from the sample; make it a blank or remove it.`,
    });

  if (input.authorityMarks)
    out.push({
      code: "authority_marks",
      severity: "blocker",
      message: "The header, footer or logo area carries DLD, RERA or other authority marks; remove them.",
    });

  const feePending = isPending(input.rulebook, "registrationFeeBps");
  let feeReported = false;
  for (const w of wording) {
    for (const sentence of w.split(/(?<=[.;])\s+/)) {
      if (feeReported) continue;
      const feeAt = [...sentence.matchAll(FEE_WORDS)].map((f) => [f.index, f.index + f[0].length] as const);
      if (!feeAt.length) continue;
      const near = [...sentence.matchAll(PERCENT)].filter((m) =>
        feeAt.some(([a, b]) => m.index + m[0].length >= a - FEE_NEAR && m.index <= b + FEE_NEAR),
      );
      for (const m of near) {
        const bps = Math.round(Number(m[1]) * 100);
        if (feePending) {
          out.push({
            code: "fee_rate",
            severity: "blocker",
            message: `The fee rate can't be checked: ${pendingReason("registrationFeeBps")}.`,
          });
          feeReported = true;
          break;
        }
        if (bps !== input.rulebook.registrationFeeBps) {
          out.push({
            code: "fee_rate",
            severity: "blocker",
            message: `The template states a registration fee of ${m[1]}%; rulebook ${input.rulebook.version} says ${input.rulebook.registrationFeeBps / 100}%.`,
          });
          feeReported = true;
          break;
        }
      }
    }
  }

  const fields = input.blanks.filter((b) => b.role === "field");
  const mapped = new Set(fields.map((b) => baseOf(b.field)));
  const missing = REQUIRED_TEMPLATE_KEYS[input.documentKind].filter((k) => !mapped.has(k));
  if (missing.length)
    out.push({
      code: "missing_core_key",
      severity: "blocker",
      message: `No blank prints ${missing.join(", ")}.`,
    });
  if (input.documentKind === "spa" && !mapped.has("payment_plan"))
    out.push({
      code: "no_payment_plan",
      severity: "warning",
      message: "No blank prints the payment plan: use this template for resale only.",
    });

  for (const b of fields)
    if (b.field === "leave_empty" || b.field === "unmapped")
      out.push({
        code: "unmapped_blank",
        severity: "warning",
        message: `Blank "${b.label}" prints as an empty line, filled by hand.`,
        blankId: b.id,
      });
  return out;
}

export const hasBlocker = (checks: readonly TemplateCheck[]): boolean => checks.some((c) => c.severity === "blocker");
