import { ENGINE_URL, sessionToken } from "../../../lib/engine";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Change markers for live updates, fetched from the engine as the signed-in user (same access as the record reads).
 * `?scope=list` (record list), `?scope=record&kind=application|lease&id=...` (one record), `?scope=home` (Home tile
 * counts, the full view, fetched only after the list marker changed).
 */
export async function GET(req: Request) {
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const scope = q.get("scope");
  let path: string | null = null;
  if (scope === "list") path = "/api/records/version";
  else if (scope === "home") path = "/api/home";
  else if (scope === "record") {
    const kind = q.get("kind");
    const id = q.get("id") ?? "";
    if ((kind === "application" || kind === "lease") && UUID.test(id)) path = `/api/records/${kind}/${id}/version`;
  }
  if (!path) return Response.json({ error: "Unknown scope." }, { status: 400 });
  const res = await fetch(`${ENGINE_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  if (!res) return Response.json({ error: "Engine unreachable." }, { status: 502 });
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
}
