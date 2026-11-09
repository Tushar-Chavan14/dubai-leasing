import { ENGINE_URL, sessionToken } from "../../../../../lib/engine";

/** One earlier copilot conversation with its messages, proposals and drafts. The engine checks it is the user's. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const res = await fetch(`${ENGINE_URL}/api/copilot/threads/${id}`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res) return Response.json({ error: "The copilot is unavailable." }, { status: 502 });
  const body = await res.json().catch(() => ({ error: `Engine returned ${res.status}` }));
  return Response.json(body, { status: res.status, headers: { "cache-control": "no-store" } });
}
