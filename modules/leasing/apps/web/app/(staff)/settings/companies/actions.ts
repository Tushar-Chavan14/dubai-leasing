"use server";

import { revalidatePath } from "next/cache";
import { engine } from "../../../../lib/engine";
import { legalBody } from "../../../../lib/company-legal";
import { type RuleResult, ruleError } from "../../../../lib/portfolio";

export async function createCompany(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Some fields need attention.", fieldErrors: { name: "Enter the company name." } };
  const r = await engine("/api/companies", {
    method: "POST",
    body: JSON.stringify({
      name,
      kind: String(formData.get("kind") ?? ""),
      emirates: formData.getAll("emirates").map(String),
      categories: formData.getAll("categories").map(String),
      legal: legalBody(formData),
    }),
  });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/companies");
  return { ok: true };
}

export async function saveCompanyLegal(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const id = String(formData.get("id"));
  const r = await engine(`/api/companies/${id}/legal`, { method: "PUT", body: JSON.stringify(legalBody(formData)) });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/companies");
  revalidatePath(`/settings/companies/${id}`);
  return { ok: true };
}

export async function setCompanyActive(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const r = await engine(`/api/companies/${String(formData.get("id"))}`, {
    method: "PATCH",
    body: JSON.stringify({ active: formData.get("active") === "true" }),
  });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/companies");
  return { ok: true };
}

export async function saveCompanyEmirates(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const id = String(formData.get("id"));
  const emirates = formData.getAll("emirates").map(String);
  if (!emirates.length)
    return { error: "Some fields need attention.", fieldErrors: { emirates: "Pick at least one emirate." } };
  const r = await engine(`/api/companies/${id}`, { method: "PATCH", body: JSON.stringify({ emirates }) });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings", "layout");
  return { ok: true };
}

export async function saveCompanyCategories(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const id = String(formData.get("id"));
  const categories = formData.getAll("categories").map(String);
  if (!categories.length)
    return { error: "Some fields need attention.", fieldErrors: { categories: "Pick at least one property type." } };
  const r = await engine(`/api/companies/${id}`, { method: "PATCH", body: JSON.stringify({ categories }) });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings", "layout");
  return { ok: true };
}
