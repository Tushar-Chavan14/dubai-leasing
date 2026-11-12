"use server";

import { revalidatePath } from "next/cache";
import { engine } from "../../../../lib/engine";
import { parsePctBp, parseWholeAedFils, type RuleResult, ruleError } from "../../../../lib/portfolio";

const PCT_HINT = "Enter a percent like -5 or 7.5";
const AED_HINT = "Enter whole dirhams like 80,000";

/** Create (no `id`) or replace (`id`) a rent rule. Percent inputs become bp; AED inputs become fils. */
export async function saveRentRule(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const fieldErrors: Record<string, string> = {};
  const minPctBp = parsePctBp(String(formData.get("minPct") ?? ""));
  const maxPctBp = parsePctBp(String(formData.get("maxPct") ?? ""));
  const minRentFils = parseWholeAedFils(String(formData.get("minRent") ?? ""));
  const maxRentFils = parseWholeAedFils(String(formData.get("maxRent") ?? ""));
  if (minPctBp === null) fieldErrors.minPctBp = PCT_HINT;
  if (maxPctBp === null) fieldErrors.maxPctBp = PCT_HINT;
  if (Number.isNaN(minRentFils)) fieldErrors.minRentFils = AED_HINT;
  if (Number.isNaN(maxRentFils)) fieldErrors.maxRentFils = AED_HINT;
  const discountRaw = String(formData.get("offerDiscount") ?? "").trim();
  const maxOfferDiscountPct = discountRaw === "" ? null : Number(discountRaw);
  if (
    maxOfferDiscountPct !== null &&
    (!Number.isInteger(maxOfferDiscountPct) || maxOfferDiscountPct < 0 || maxOfferDiscountPct > 50)
  )
    fieldErrors.maxOfferDiscountPct = "Enter a whole percent from 0 to 50, or leave it empty";
  if (Object.keys(fieldErrors).length) return { error: "Some fields need attention.", fieldErrors };

  const id = String(formData.get("id") ?? "");
  const subtype = String(formData.get("subtype") ?? "");
  const community = String(formData.get("community") ?? "").trim();
  const rule = {
    category: String(formData.get("category")),
    subtype: subtype || null,
    emirate: String(formData.get("emirate") ?? "") || "dubai",
    community: community || null,
    minPctBp,
    maxPctBp,
    minRentFils,
    maxRentFils,
    maxOfferDiscountPct,
  };
  const r = id
    ? await engine(`/api/rent-rules/${id}`, { method: "PUT", body: JSON.stringify(rule) })
    : await engine("/api/rent-rules", {
        method: "POST",
        body: JSON.stringify({ ...rule, companyId: String(formData.get("companyId") ?? "") }),
      });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/rent-rules");
  return { ok: true };
}

export async function removeRentRule(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const r = await engine(`/api/rent-rules/${String(formData.get("id"))}`, { method: "DELETE" });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/rent-rules");
  return { ok: true };
}

/** Company-wide negotiation limit: how far below the asking rent an offer or counter may go without a manager. */
export async function saveOfferDiscount(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const raw = String(formData.get("maxRentDiscountPercent") ?? "").trim();
  const n = Number(raw);
  if (raw === "" || !Number.isInteger(n) || n < 0 || n > 50)
    return {
      error: "Some fields need attention.",
      fieldErrors: { maxRentDiscountPercent: "Enter a whole percent from 0 to 50" },
    };
  const r = await engine("/api/policy/offers", { method: "PUT", body: JSON.stringify({ maxRentDiscountPercent: n }) });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/rent-rules");
  return { ok: true };
}
