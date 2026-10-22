import { ENGINE_URL, sessionToken } from "../../../../../../lib/engine";

/**
 * The user's Confirm or Cancel click on a copilot proposal card (decision D25). Forwards to the
 * engine with the staff session; the engine checks the owner, role, status and expiry.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  if (action !== "confirm" && action !== "cancel") return Response.json({ error: "Not found." }, { status: 404 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const res = await fetch(`${ENGINE_URL}/api/copilot/proposals/${id}/${action}`, {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({ error: `Engine returned ${res.status}` }));
  return Response.json(body, { status: res.status });
}
