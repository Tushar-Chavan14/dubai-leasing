"use server";

import { revalidatePath } from "next/cache";
import { engine } from "../../../../lib/engine";
import { type RuleResult, ruleError } from "../../../../lib/portfolio";

/** Create (no `id`) or replace (`id`) a contract rule. Clause ids on an existing rule are kept. */
export async function saveContractRule(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const fieldErrors: Record<string, string> = {};
  const tenures = formData.getAll("tenures").map(String);
  const minCheques = Number(formData.get("minCheques"));
  const maxCheques = Number(formData.get("maxCheques"));
  if (tenures.length === 0) fieldErrors.tenures = "Choose at least one tenure";
  if (!Number.isInteger(minCheques) || minCheques < 1 || minCheques > 12) fieldErrors.minCheques = "Enter 1 to 12";
  if (!Number.isInteger(maxCheques) || maxCheques < 1 || maxCheques > 12) fieldErrors.maxCheques = "Enter 1 to 12";
  if (Object.keys(fieldErrors).length) return { error: "Some fields need attention.", fieldErrors };

  const id = String(formData.get("id") ?? "");
  const subtype = String(formData.get("subtype") ?? "");
  const clauseIds = String(formData.get("clauseIds") ?? "")
    .split(",")
    .filter(Boolean);
  const sampleDocumentId = String(formData.get("sampleDocumentId") ?? "");
  const rule = {
    sampleDocumentId: sampleDocumentId || null,
    // The select's value: empty means the standard contract (clears the template on a replace).
    templateId: String(formData.get("templateId") ?? "") || null,
    category: String(formData.get("category")),
    subtype: subtype || null,
    tenures,
    minCheques,
    maxCheques,
    clauseIds,
  };
  const r = id
    ? await engine(`/api/contract-rules/${id}`, { method: "PUT", body: JSON.stringify(rule) })
    : await engine("/api/contract-rules", {
        method: "POST",
        body: JSON.stringify({ ...rule, companyId: String(formData.get("companyId") ?? "") }),
      });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/contracts");
  return { ok: true };
}

export async function removeContractRule(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const r = await engine(`/api/contract-rules/${String(formData.get("id"))}`, { method: "DELETE" });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/contracts");
  return { ok: true };
}

/** Approve (optionally with edited wording) or reject one proposed clause. Admin only (the engine checks). */
export async function decideClause(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const editedText = formData.get("editedText");
  const body: Record<string, unknown> = { decision };
  if (decision === "approve") {
    if (formData.get("confirmValues") === "on") body.confirmValues = true;
    if (typeof editedText === "string") body.editedText = editedText;
  }
  const r = await engine(`/api/company-clauses/${id}/decide`, { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) {
    if (r.error?.code === "confirm_values")
      return { error: "This clause includes amounts or dates. Tick the box to say you checked them." };
    if (r.error?.code === "already_decided") return { error: "This clause was already decided. Reload the page." };
    return ruleError(r);
  }
  revalidatePath("/settings/contracts");
  return { ok: true };
}

/** Add an approved company clause to a contract rule, or take it off. Replaces the rule row, like any edit. */
export async function toggleRuleClause(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const ruleId = String(formData.get("ruleId"));
  const ref = String(formData.get("ref"));
  const on = formData.get("on") === "on";
  const current = String(formData.get("clauseIds") ?? "")
    .split(",")
    .filter(Boolean);
  const clauseIds = on ? [...current.filter((c) => c !== ref), ref] : current.filter((c) => c !== ref);
  const subtype = String(formData.get("subtype") ?? "");
  const rule = {
    category: String(formData.get("category")),
    subtype: subtype || null,
    tenures: String(formData.get("tenures") ?? "")
      .split(",")
      .filter(Boolean),
    minCheques: Number(formData.get("minCheques")),
    maxCheques: Number(formData.get("maxCheques")),
    clauseIds,
    sampleDocumentId: String(formData.get("sampleDocumentId") ?? "") || null,
    // The list the page showed: the engine refuses if the rule was replaced or changed since.
    expectedClauseIds: current,
  };
  const r = await engine(`/api/contract-rules/${ruleId}`, { method: "PUT", body: JSON.stringify(rule) });
  if (!r.ok) {
    if (r.error?.code === "rule_inactive" || r.error?.code === "rule_changed")
      return { error: "This rule changed; reload." };
    return ruleError(r);
  }
  revalidatePath("/settings/contracts");
  return { ok: true };
}

/** "Try again" after a failed or stopped reading of the sample (no re-upload). */
export async function retrySample(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const r = await engine(`/api/contract-rules/${String(formData.get("ruleId"))}/sample/retry`, {
    method: "POST",
    body: "{}",
  });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/contracts");
  return { ok: true };
}

/** Admin edits of a proposed company template: one review toggle (mappings are never edited by hand). Wording is never editable. */
export async function reviewTemplateAction(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const id = String(formData.get("templateId"));
  const body: Record<string, unknown> = {};
  const toggle = String(formData.get("toggle") ?? "");
  const key = String(formData.get("key") ?? "");
  if (toggle === "valuesConfirmed" || toggle === "authorityBodyConfirmed" || toggle === "droppedParagraphs") {
    if (key) body[toggle] = { [key]: formData.get("on") === "on" };
  } else if (toggle) body[toggle] = formData.get("on") === "on";
  const r = await engine(`/api/contract-templates/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/contracts");
  return { ok: true };
}

export async function approveTemplateAction(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const r = await engine(`/api/contract-templates/${String(formData.get("templateId"))}/approve`, {
    method: "POST",
    body: "{}",
  });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/contracts");
  return { ok: true };
}

/** "Re-suggest mappings" on a proposed template: code rules and the model choose each blank's source again. */
export async function resuggestTemplateAction(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const r = await engine(`/api/contract-templates/${String(formData.get("templateId"))}/resuggest`, {
    method: "POST",
    body: "{}",
  });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/contracts");
  return { ok: true };
}

export async function retireTemplateAction(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const r = await engine(`/api/contract-templates/${String(formData.get("templateId"))}/retire`, {
    method: "POST",
    body: "{}",
  });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/contracts");
  return { ok: true };
}

/** "Try again" after the template reading failed or stopped. */
export async function retryTemplateAction(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const r = await engine(`/api/companies/${String(formData.get("companyId"))}/contract-template/retry`, {
    method: "POST",
    body: "{}",
  });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/contracts");
  return { ok: true };
}
