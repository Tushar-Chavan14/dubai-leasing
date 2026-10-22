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
