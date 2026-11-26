import type { SpaAmlPolicy, SpaKycConfig } from "@spa/core";
import { SPA_TEMPLATE_KIND_LIST } from "./kinds";

/**
 * The Settings forms (C34, S66). Each builder reads the fields it needs and nothing else, so a `role`, `actor` or user id
 * stuffed into a form is never sent. The engine checks the role and every value again; this is never the rule.
 */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (s: unknown): s is string => typeof s === "string" && ID.test(s);

const text = (f: FormData, k: string, max = 200): string => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
const on = (f: FormData, k: string) => f.get(k) === "on";

export interface SettingsRequest {
  method: "POST" | "PUT";
  path: string;
  body: Record<string, unknown>;
}

export function templateRequest(f: FormData): SettingsRequest | null {
  const name = text(f, "name", 120);
  const documentKind = text(f, "documentKind", 30);
  if (!name || !(SPA_TEMPLATE_KIND_LIST as readonly string[]).includes(documentKind)) return null;
  const projectCodes = text(f, "projectCodes", 400)
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 50);
  return { method: "POST", path: "/api/templates", body: { name, documentKind, projectCodes } };
}

export function remapRequest(f: FormData): SettingsRequest | null {
  const versionId = text(f, "versionId", 40);
  const blankId = text(f, "blankId", 20);
  const key = text(f, "key", 80);
  if (!isId(versionId) || !/^b\d{1,4}$/.test(blankId) || !key) return null;
  return {
    method: "POST",
    path: `/api/template-versions/${versionId}/blanks/${blankId}/remap`,
    body: { key },
  };
}

/** The upload form: a file and the ticked box, sent as the multipart body the engine reads. Nothing else. */
export function uploadBody(f: FormData): { id: string; body: FormData } | null {
  const id = text(f, "templateId", 40);
  const file = f.get("file");
  if (!isId(id) || !(file instanceof File) || file.size === 0) return null;
  const body = new FormData();
  body.set("file", file);
  body.set("noRealData", on(f, "noRealData") ? "true" : "false");
  return { id, body };
}

const KYC_ROLES = ["buyer_person", "seller_person", "company_party", "beneficial_owner"];
const DEAL_TYPES = ["primary_offplan", "resale_ready", "resale_offplan"];
export function kycTarget(f: FormData): { role: string; dealType: string | null } | null {
  const role = text(f, "role", 30);
  const dealType = text(f, "dealType", 30);
  if (!KYC_ROLES.includes(role) || (dealType && !DEAL_TYPES.includes(dealType))) return null;
  return { role, dealType: dealType || null };
}

const SEVERITIES = ["off", "warning", "blocker"] as const;
const CROSS = ["required_documents", "names_consistent", "name_matches_deal"] as const;

/**
 * The KYC form editor's save: the labels, help, required flags, the confidence bar and the three cross-checks are read
 * from the form and laid over the config the page started from; everything else (keys, types, options, document rules,
 * custom rules) comes through unchanged. The engine validates the whole config again, including the protected-trait rule.
 */
export function applyKycForm(base: SpaKycConfig, f: FormData): SpaKycConfig | null {
  const conf = Number(text(f, "minConfidence", 6));
  if (!Number.isFinite(conf) || conf < 0.5 || conf > 1) return null;
  const cross = { ...base.rules.cross };
  for (const name of CROSS) {
    const sev = text(f, `cross_${name}`, 10);
    if (!(SEVERITIES as readonly string[]).includes(sev)) return null;
    cross[name] = { severity: sev as (typeof SEVERITIES)[number], emailApplicant: on(f, `cross_email_${name}`) };
  }
  return {
    form: base.form.map((field) => ({
      ...field,
      label: text(f, `label_${field.key}`, 80) || field.label,
      help: text(f, `help_${field.key}`, 200),
      required: on(f, `required_${field.key}`),
    })),
    rules: { ...base.rules, minConfidence: conf, cross },
  };
}

const RULE_IDS = [
  "sanctions",
  "pep",
  "third_party_payer",
  "cash",
  "high_risk_country",
  "missing_source_of_funds",
  "complex_ownership",
] as const;
const intIn = (s: string, lo: number, hi: number): number | null => {
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = Number(s);
  return n >= lo && n <= hi ? n : null;
};

/**
 * The compliance rules form: the rule switches, severities and points, the country list, the cut-offs and the re-check
 * points are read from the form and laid over the current policy. Evidence lists and risk factors come through unchanged.
 * The engine validates the whole policy again (a sanctions match always flags).
 */
export function applyPolicyForm(base: SpaAmlPolicy, f: FormData): SpaAmlPolicy | null {
  const rules = { ...base.rules };
  for (const id of RULE_IDS) {
    const points = intIn(text(f, `points_${id}`, 4), 0, 100);
    const severity = text(f, `severity_${id}`, 10);
    if (points === null || (severity !== "flag" && severity !== "warning")) return null;
    rules[id] = {
      on: id === "sanctions" ? true : on(f, `on_${id}`),
      severity: id === "sanctions" ? "flag" : severity,
      points,
    };
  }
  const countries = text(f, "highRiskCountries", 1000)
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((c) => c.toUpperCase());
  if (countries.some((c) => !/^[A-Z]{2}$/.test(c))) return null;
  const medium = intIn(text(f, "cutoffMedium", 4), 0, 100);
  const high = intIn(text(f, "cutoffHigh", 4), 0, 100);
  const every = text(f, "everyDays", 4);
  const everyDays = every ? intIn(every, 1, 365) : null;
  if (medium === null || high === null || (every && everyDays === null)) return null;
  return {
    ...base,
    rules,
    highRiskCountries: [...new Set(countries)],
    risk: { ...base.risk, cutoffs: { medium, high } },
    rescreen: {
      atOffer: on(f, "atOffer"),
      beforeAgreementApproval: on(f, "beforeAgreementApproval"),
      beforeTransfer: on(f, "beforeTransfer"),
      onPartyChange: on(f, "onPartyChange"),
      everyDays,
    },
  };
}

/** `hours_<key>` fields as the thresholds record the alert settings route takes; none filled is null. */
export function alertThresholds(f: FormData): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("hours_") || typeof v !== "string" || !v.trim()) continue;
    const n = intIn(v.trim(), 1, 720);
    if (n === null || !/^[a-z_]{2,40}$/.test(k.slice(6))) return null;
    out[k.slice(6)] = n;
  }
  return Object.keys(out).length ? out : null;
}

const COMPANY_KINDS = ["developer", "brokerage", "both"];
export function companyRequest(f: FormData): SettingsRequest | null {
  const name = text(f, "name", 200);
  const kind = text(f, "kind", 20);
  if (!name || !COMPANY_KINDS.includes(kind)) return null;
  return { method: "PUT", path: "/api/settings/company", body: { name, kind } };
}

/** "5.25" -> 525, by string arithmetic: a percentage with up to two decimals, 0 to 100, never a float. */
export function pctToBps(s: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}
/** 525 -> "5.25", 500 -> "5": the form field for a share in basis points, integer arithmetic. */
export function bpsToPct(bps: number): string {
  const frac = String(bps % 100)
    .padStart(2, "0")
    .replace(/0$/, "");
  return `${Math.floor(bps / 100)}${bps % 100 ? `.${frac}` : ""}`;
}
/** "14, 3" -> [14, 3]: whole numbers, at most five; the engine checks the order. */
const dayList = (s: string): number[] | null => {
  const parts = s.split(/[\s,]+/).filter(Boolean);
  if (parts.length > 5 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  return parts.map(Number);
};
const ORDER_TYPES = ["primary_offplan", "resale_ready", "resale_offplan"] as const;

/**
 * Plans and Signing (S72): the fields of the page are read and nothing else, with the version the page started from.
 * The engine allows only the page's keys, validates the whole policy and refuses a stale version.
 */
export function policyRequest(page: "plans" | "signing" | "viewings", f: FormData): SettingsRequest | null {
  const baseVersion = intIn(text(f, "baseVersion", 6), 0, 999_999);
  if (baseVersion === null) return null;
  const path = `/api/settings/policy/${page}`;
  if (page === "viewings") {
    const viewingDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => on(f, `day_${d}`));
    const viewingStartHour = intIn(text(f, "startHour", 2), 0, 23);
    const viewingEndHour = intIn(text(f, "endHour", 2), 1, 24);
    const viewingSlotMinutes = intIn(text(f, "slotMinutes", 3), 15, 120);
    const viewingLeadHours = intIn(text(f, "leadHours", 3), 0, 168);
    const viewingHorizonDays = intIn(text(f, "horizonDays", 2), 1, 60);
    const perEmailPerDay = intIn(text(f, "perEmailPerDay", 3), 1, 100);
    if (
      !viewingDays.length ||
      viewingStartHour === null ||
      viewingEndHour === null ||
      viewingStartHour >= viewingEndHour ||
      viewingSlotMinutes === null ||
      viewingLeadHours === null ||
      viewingHorizonDays === null ||
      perEmailPerDay === null
    )
      return null;
    return {
      method: "PUT",
      path,
      body: {
        baseVersion,
        values: {
          viewings: {
            viewingDays,
            viewingStartHour,
            viewingEndHour,
            viewingSlotMinutes,
            viewingLeadHours,
            viewingHorizonDays,
          },
          leads: { perEmailPerDay },
        },
      },
    };
  }
  if (page === "signing") {
    const days = intIn(text(f, "signingLinkDays", 3), 1, 60);
    if (days === null) return null;
    const signingOrder: Record<string, string[]> = {};
    for (const t of ORDER_TYPES) {
      const o = text(f, `order_${t}`, 12);
      if (o !== "buyer_first" && o !== "seller_first") return null;
      signingOrder[t] = o === "buyer_first" ? ["buyer", "seller"] : ["seller", "buyer"];
    }
    return { method: "PUT", path, body: { baseVersion, values: { signingLinkDays: days, signingOrder } } };
  }
  if (page !== "plans") return null;
  const maxDiscountBps = pctToBps(text(f, "maxDiscount", 7));
  const sellerSideBps = pctToBps(text(f, "commissionSeller", 7));
  const buyerSideBps = pctToBps(text(f, "commissionBuyer", 7));
  const depositBps = pctToBps(text(f, "deposit", 7));
  const holdDays = intIn(text(f, "holdDays", 3), 1, 60);
  const offerValidityDays = intIn(text(f, "offerDays", 3), 1, 30);
  const beforeDays = dayList(text(f, "remindBefore", 40));
  const afterDays = dayList(text(f, "remindAfter", 40));
  if ([maxDiscountBps, sellerSideBps, buyerSideBps, depositBps, holdDays, offerValidityDays].includes(null))
    return null;
  if (!beforeDays || !afterDays) return null;
  return {
    method: "PUT",
    path,
    body: {
      baseVersion,
      values: {
        maxDiscountBps,
        commission: { sellerSideBps, buyerSideBps },
        depositBps,
        holdDays,
        offerValidityDays,
        instalmentReminders: { beforeDays, afterDays },
      },
    },
  };
}

/** The Users page never names the second compliance role in a form: it travels as a neutral word and is mapped here. */
const FORM_ROLES: Record<string, string> = {
  sales_officer: "sales_officer",
  sales_manager: "sales_manager",
  sales_admin: "sales_admin",
  legal: "legal",
  finance: "finance",
  compliance_officer: "compliance_officer",
  compliance_senior: "mlro",
  admin: "admin",
};
export const formRoleKey = (role: string): string => (role === "mlro" ? "compliance_senior" : role);
export function userRoleRequest(f: FormData): SettingsRequest | null {
  const userId = text(f, "userId", 40);
  const word = text(f, "role", 30);
  const role = Object.hasOwn(FORM_ROLES, word) ? FORM_ROLES[word] : undefined;
  if (!isId(userId) || !role) return null;
  return { method: "PUT", path: `/api/settings/users/${userId}`, body: { role } };
}
export function userActiveRequest(f: FormData): SettingsRequest | null {
  const userId = text(f, "userId", 40);
  const a = text(f, "active", 4);
  if (!isId(userId) || (a !== "yes" && a !== "no")) return null;
  return { method: "PUT", path: `/api/settings/users/${userId}`, body: { active: a === "yes" } };
}

export function clockRequest(f: FormData): SettingsRequest | null {
  const path = "/api/demo/clock";
  if (text(f, "rewind", 4) === "yes") return { method: "POST", path, body: { rewind: true } };
  const days = intIn(text(f, "days", 3), 1, 365);
  return days === null ? null : { method: "POST", path, body: { days } };
}

export type SettingsOutcome = "done" | "exists" | "invalid" | "refused" | "signin";
/** An engine answer in fixed words: never the engine's text, which a person could hand-edit into the address bar. */
export const outcomeOf = (status: number | null): SettingsOutcome =>
  status === null
    ? "refused"
    : status === 401
      ? "signin"
      : status === 409
        ? "exists"
        : status === 422 || status === 400
          ? "invalid"
          : status >= 200 && status < 300
            ? "done"
            : "refused";

export type SettingsSend = (
  path: string,
  init: { method: "POST" | "PUT"; headers?: Record<string, string>; body: string | FormData },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export async function sendSettings(send: SettingsSend, req: SettingsRequest): Promise<SettingsOutcome> {
  const res = await send(req.path, {
    method: req.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body),
  }).catch(() => null);
  return outcomeOf(res ? res.status : null);
}

/** The only words a Settings error can show. No word here names a compliance subject. */
export const settingsError = (code: string): string =>
  ({
    invalid: "That wasn't saved. Check every field and try again.",
    exists: "That already exists, or someone changed it at the same moment. Look again and try once more.",
    refused: "That wasn't saved. Only an admin changes these settings.",
    stale: "Someone saved a newer version first. The page now shows it; make your change again.",
    blocked: "That change isn't allowed. You can't change yourself, and one admin must always stay active.",
    upload: "That file wasn't accepted. Upload a PDF up to 10 MB and tick the box that it holds no real customer data.",
  })[code] ?? "That wasn't saved. Try again.";

export const settingsSaved = (code: string): string | null =>
  ({
    template: "Template added. Upload a blank sample agreement to give it a first version.",
    upload: "Uploaded. It is being read; this page shows the result when it is done.",
    existing: "That file was already uploaded for this template. Showing the earlier upload.",
    remap: "Blank updated. The checks ran again.",
    draft: "Saved as a draft. Publish it when it is ready.",
    published: "Published. It is now the form in use.",
    alerts: "Alert settings saved.",
    policy: "Published as a new version.",
    company: "Company details saved.",
    user: "User updated.",
    clock: "Demo date set.",
  })[code] ?? null;
