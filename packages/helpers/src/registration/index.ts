import { EJARI_FIELDS, type EjariField, type Helper } from "@leasing/core";
import type { Llm } from "@leasing/llm";
import { isNameField, nameFix } from "./payload.ts";
import { fieldQuestion, rejectionState } from "./prompt.ts";
import { RegistrationContext, RegistrationData } from "./schema.ts";

export { buildEjariPayload, nameFix, type VerifiedValue } from "./payload.ts";
export { FIELD_LABELS, fieldQuestion, rejectionState } from "./prompt.ts";
export { RegistrationContext, RegistrationData } from "./schema.ts";

export const RegistrationSchemas = { context: RegistrationContext, data: RegistrationData };

const asField = (v: string | null | undefined): EjariField | null =>
  v && (EJARI_FIELDS as string[]).includes(v) ? (v as EjariField) : null;

/**
 * Registration helper (step 6), after Ejari rejects a submission. The decision model maps each
 * rejection to a payload field; pure code then looks for a typo-class fix (case, spacing,
 * punctuation, accents) from verified sources, for name fields only. It resubmits only on the
 * first attempt and only when every rejection is covered by such a fix; anything else goes to a
 * person. It never changes money, dates, ID numbers or property numbers, and never the contract.
 */
export function registrationHelper(llm: Llm): Helper<RegistrationContext, RegistrationData> {
  return {
    name: "registration",
    async run(input) {
      const c = input.context;
      const mappings: RegistrationData["mappings"] = [];
      let model = "";
      for (const r of c.rejections) {
        const res = await llm.decide(rejectionState(r), fieldQuestion());
        model = res.model;
        const a = res.answers.field;
        if (!a || a.type !== "choice") throw new Error("the decision model gave no field answer");
        const field = asField(a.choice);
        const hint = asField(r.field);
        // Confident, and agreeing with the registry's own hint when it gave one; a hint naming
        // something we don't recognise can't be checked, so the rejection goes to a person.
        const hintOk = r.field === null ? true : hint === field;
        const usable = field && a.confidence >= c.minConfidence && hintOk;
        mappings.push({ code: r.code, field: usable ? field : null, confidence: a.confidence, hint });
      }

      const reasons: string[] = [];
      const fixes: RegistrationData["fixes"] = [];
      if (c.attempt > 1) reasons.push("This was already the corrected resubmission; a person needs to look.");
      for (const m of mappings) {
        if (!m.field) {
          reasons.push(`Rejection ${m.code} could not be tied to one field with confidence.`);
          continue;
        }
        if (!isNameField(m.field)) {
          reasons.push(`Rejection ${m.code} is about ${m.field}, which is never corrected automatically.`);
          continue;
        }
        if (fixes.some((f) => f.field === m.field)) continue;
        const fix = nameFix(m.field, c.payload[m.field], c.verified[m.field]);
        if (!fix) {
          reasons.push(`No case or spacing correction of ${m.field} is supported by a verified source.`);
          continue;
        }
        fixes.push(fix);
      }
      const decision = reasons.length === 0 && fixes.length > 0 ? "resubmit" : "person";
      if (decision === "resubmit") {
        for (const f of fixes) reasons.push(`${f.field}: corrected "${f.from}" to "${f.to}" from ${f.source}.`);
      }
      return {
        status: "ok",
        data: { mappings, decision, fixes: decision === "resubmit" ? fixes : [] },
        reasons,
        sourceDocIds: [],
        model: { name: model, confidence: Math.min(...mappings.map((m) => m.confidence)) },
      };
    },
  };
}
