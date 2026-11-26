import { clientBucket } from "../../../../../lib/client-address";
import { engineUrl, webEnv } from "../../../../../lib/env";

/**
 * The listing chat's way in (S61): the browser posts here, never to the engine. The visitor's bucket (the last hop of our own
 * proxy, never an entry the visitor wrote; see `clientBucket`) goes on as `x-forwarded-for` so the engine can rate-limit them. The answer is passed through as it came, status and all.
 */
export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const ip = clientBucket(req.headers, webEnv().SPA_TRUSTED_PROXY);
  const body = await req.text();
  if (body.length > 8192) return Response.json({ error: "too long", code: "invalid_request" }, { status: 400 });
  try {
    const res = await fetch(`${engineUrl()}/public/listings/${encodeURIComponent(ref)}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body,
      cache: "no-store",
    });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "unavailable", code: "assistant_unavailable" }, { status: 503 });
  }
}
