import { engineUrl } from "../../../../../lib/env";

/** The portal chat's way in: the browser posts here, never to the engine. The answer is passed through as it came. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.text();
  if (body.length > 8192) return Response.json({ error: "too long", code: "invalid_request" }, { status: 400 });
  try {
    const res = await fetch(`${engineUrl()}/public/party/${encodeURIComponent(token)}/assistant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "unavailable", code: "assistant_unavailable" }, { status: 503 });
  }
}
