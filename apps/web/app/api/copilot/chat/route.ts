import { ENGINE_URL, sessionToken } from "../../../../lib/engine";

/**
 * Staff copilot chat: forwards the question to the engine with the staff session and streams
 * the engine's NDJSON events back unchanged. The copilot runs in the engine, as this user.
 */
export async function POST(req: Request) {
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const res = await fetch(`${ENGINE_URL}/api/copilot/chat`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: await req.text(),
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return Response.json({ error: body?.error ?? "The copilot is unavailable." }, { status: res.status });
  }
  return new Response(res.body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
