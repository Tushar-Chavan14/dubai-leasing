import { ENGINE_URL, sessionToken } from "../../../../lib/engine";

/** The user's recent copilot conversations, for the dock's History menu. Read only; runs as the signed-in user. */
export async function GET() {
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const res = await fetch(`${ENGINE_URL}/api/copilot/threads`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res) return Response.json({ error: "The copilot is unavailable." }, { status: 502 });
  const body = await res.json().catch(() => ({ error: `Engine returned ${res.status}` }));
  return Response.json(body, { status: res.status, headers: { "cache-control": "no-store" } });
}
