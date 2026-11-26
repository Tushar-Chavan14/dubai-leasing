import { EngineError, type EngineClient } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SearchRow {
  leaseId: string | null;
  leaseRef: string | null;
  unitCode: string;
  tenant: string | null;
}

/**
 * Turns what staff type ("MRN-1204", "MRN-1204/2026-03", a lease id or a tenant name) into a
 * lease id. Ambiguous answers fail with the candidates so the model can ask the user.
 */
export async function resolveLeaseId(engine: EngineClient, ref: string): Promise<string> {
  const q = ref.trim();
  if (UUID.test(q)) return q;
  const rows = await engine.get<SearchRow[]>(`/api/search?q=${encodeURIComponent(q)}`);
  const withLease = rows.filter((r) => r.leaseId);
  const norm = q.toLowerCase();
  const exact = withLease.filter(
    (r) => r.unitCode.toLowerCase() === norm || r.leaseRef?.toLowerCase() === norm || r.tenant?.toLowerCase() === norm,
  );
  const pick = exact.length === 1 ? exact[0] : withLease.length === 1 ? withLease[0] : undefined;
  if (pick?.leaseId) return pick.leaseId;
  if (!withLease.length) throw new EngineError(404, `no lease found for "${q}"`);
  throw new EngineError(
    409,
    `"${q}" matches several leases: ${withLease
      .slice(0, 5)
      .map((r) => `${r.unitCode} (${r.leaseRef})`)
      .join(", ")}. Ask which one.`,
  );
}

interface RecordHit {
  kind: "application" | "lease";
  id: string;
  ref: string;
  title: string;
  unitCode: string;
  stage: string;
}

/**
 * Turns an application reference (A-7KQ2MX), unit code or applicant name into an application id.
 * Several matches fail with the candidates so the model can ask the user.
 */
export async function resolveApplication(engine: EngineClient, ref: string): Promise<RecordHit> {
  const q = ref.trim();
  const found = await engine.get<{ rows: RecordHit[] }>(`/api/copilot/records?q=${encodeURIComponent(q)}&limit=20`);
  const apps = found.rows.filter((r) => r.kind === "application");
  const norm = q.toLowerCase();
  const exact = apps.filter((r) => r.ref.toLowerCase() === norm || r.unitCode.toLowerCase() === norm);
  const pick = exact.length === 1 ? exact[0] : apps.length === 1 ? apps[0] : undefined;
  if (pick) return pick;
  if (!apps.length) throw new EngineError(404, `no application found for "${q}"`);
  throw new EngineError(
    409,
    `"${q}" matches several applications: ${apps
      .slice(0, 5)
      .map((r) => `${r.ref} (${r.unitCode})`)
      .join(", ")}. Ask which one.`,
  );
}
