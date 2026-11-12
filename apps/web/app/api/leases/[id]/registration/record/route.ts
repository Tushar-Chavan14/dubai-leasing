import { ENGINE_URL, sessionToken } from "../../../../../../lib/engine";

/** Certificate + the portal's reference are 10 MB of PDF plus a few text fields. */
const MAX_BYTES = 11 * 1024 * 1024;

/**
 * Records a manual registration from the browser: streams the multipart form (reference, date, fee, certificate
 * PDF) to the engine as the signed-in user. The engine validates every field and the 10 MB certificate cap; the
 * body is never buffered here.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/leases/[id]/registration/record">) {
  const { id } = await ctx.params;
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again to record the registration." }, { status: 401 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return Response.json({ error: "The certificate is larger than 10 MB." }, { status: 413 });
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": req.headers.get("content-type") ?? "multipart/form-data",
  };
  if (length) headers["content-length"] = String(length);
  const res = await fetch(`${ENGINE_URL}/api/leases/${encodeURIComponent(id)}/registration/record`, {
    method: "POST",
    headers,
    body: req.body,
    // Node's fetch needs this to send a stream.
    duplex: "half",
  } as RequestInit);
  const body = await res.json().catch(() => ({ error: `Engine returned ${res.status}` }));
  return Response.json(body, { status: res.status });
}
