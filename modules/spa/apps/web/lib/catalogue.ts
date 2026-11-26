import { SPA_TEMPLATE_KIND_LIST } from "./kinds";

/**
 * The Inventory and Listings forms (C32, S64). Each builder reads the fields it needs and nothing else, so a `role`,
 * `actor` or company id stuffed into a form is never sent. Money is typed in dirhams and becomes whole fils by integer
 * arithmetic. The engine checks the role, the company kind and every value again; this is never the rule.
 */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const text = (f: FormData, k: string, max = 200): string => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};

/** "1,500,000" or "1500000.5" as whole fils; anything else (sign, exponent, three decimals, zero, huge) is null. */
export function parseAedToFils(input: string): number | null {
  const s = input.replace(/[,\s]/g, "");
  const m = /^(\d{1,11})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const fils = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return fils > 0 ? fils : null;
}

export interface CatalogueRequest {
  path: string;
  body: Record<string, unknown>;
}

export function projectRequest(f: FormData): CatalogueRequest | null {
  const code = text(f, "code", 40);
  const name = text(f, "name", 120);
  if (!code || !name) return null;
  const body: Record<string, unknown> = { code, name };
  const day = text(f, "anticipatedCompletionOn", 10);
  if (day) {
    if (!DAY.test(day)) return null;
    body.anticipatedCompletionOn = day;
  }
  for (const [k, max] of [
    ["community", 80],
    ["location", 120],
    ["description", 2000],
  ] as const) {
    const v = text(f, k, max);
    if (v) body[k] = v;
  }
  const kind = text(f, "templateKind", 30);
  if (kind) {
    if (!(SPA_TEMPLATE_KIND_LIST as readonly string[]).includes(kind)) return null;
    body.templateKind = kind;
  }
  return { path: "/api/projects", body };
}

/** Edits a project (S75): a field left empty clears it. The code and the template don't change here. */
export function projectUpdateRequest(f: FormData): (CatalogueRequest & { id: string }) | null {
  const id = text(f, "id", 40);
  const name = text(f, "name", 120);
  if (!ID.test(id) || !name) return null;
  const day = text(f, "anticipatedCompletionOn", 10);
  if (day && !DAY.test(day)) return null;
  // S79: the sales agent for new units, sent only when the form carries the select (empty clears it).
  const agent = f.has("salesAgentUserId") ? text(f, "salesAgentUserId", 40) : null;
  if (agent && !ID.test(agent)) return null;
  return {
    id,
    path: `/api/projects/${id}`,
    body: {
      name,
      anticipatedCompletionOn: day || null,
      community: text(f, "community", 80) || null,
      location: text(f, "location", 120) || null,
      description: text(f, "description", 2000) || null,
      ...(agent !== null ? { salesAgentUserId: agent || null } : {}),
    },
  };
}

const projectId = (f: FormData): string | null => {
  const id = text(f, "projectId", 40);
  return ID.test(id) ? id : null;
};

export function buildingRequest(f: FormData): CatalogueRequest | null {
  const id = projectId(f);
  const code = text(f, "code", 40);
  const name = text(f, "name", 120);
  return id && code && name ? { path: `/api/projects/${id}/buildings`, body: { code, name } } : null;
}

export function unitRequest(f: FormData): CatalogueRequest | null {
  const id = projectId(f);
  const buildingId = text(f, "buildingId", 40);
  const code = text(f, "code", 40);
  return id && ID.test(buildingId) && code ? { path: `/api/projects/${id}/units`, body: { buildingId, code } } : null;
}

/** One `price_<unitId>` field per unit: a filled one is a price, an empty one means "no price in this version". */
export function priceListRequest(f: FormData): CatalogueRequest | null {
  const id = projectId(f);
  if (!id) return null;
  const items: { unitId: string; priceFils: number }[] = [];
  for (const [key, value] of f.entries()) {
    if (!key.startsWith("price_") || typeof value !== "string" || !value.trim()) continue;
    const unitId = key.slice(6);
    const priceFils = parseAedToFils(value);
    if (!ID.test(unitId) || priceFils === null) return null;
    items.push({ unitId, priceFils });
  }
  return items.length ? { path: `/api/projects/${id}/price-lists`, body: { items } } : null;
}

export function publishRequest(f: FormData): CatalogueRequest | null {
  const id = text(f, "id", 40);
  return ID.test(id) ? { path: `/api/price-lists/${id}/publish`, body: {} } : null;
}

export type Outcome = { result: "done"; id?: string } | { result: "exists" | "invalid" | "refused" | "signin" };
export type SendJson = (
  path: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ status: number; json(): Promise<unknown> }>;

/**
 * Sends one request and reads the answer in fixed words (never the engine's text, which a person could hand-edit into
 * the address bar): done (with the new id), exists (409), invalid (422), refused (403 or anything else), signin (401).
 */
export async function postCatalogue(send: SendJson, req: CatalogueRequest): Promise<Outcome> {
  const res = await send(req.path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body),
  }).catch(() => null);
  if (!res) return { result: "refused" };
  if (res.status === 401) return { result: "signin" };
  if (res.status === 409) return { result: "exists" };
  if (res.status === 422) return { result: "invalid" };
  if (res.status >= 200 && res.status < 300) {
    const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return typeof body?.id === "string" ? { result: "done", id: body.id } : { result: "done" };
  }
  return { result: "refused" };
}

/** Words for a permit's last valid day (design §4.7): the warning is the engine's `expiring` (seven days or fewer). */
export function permitText(p: { status: string; daysLeft: number | null }, validTo: string): string {
  const n = p.daysLeft;
  if (p.status === "none" || n === null) return "No permit";
  if (p.status === "expired") return n === -1 ? "Expired 1 day ago" : `Expired ${-n} days ago`;
  if (p.status === "expiring") return n === 0 ? "Expires today" : n === 1 ? "Expires in 1 day" : `Expires in ${n} days`;
  return `Valid to ${validTo}`;
}
