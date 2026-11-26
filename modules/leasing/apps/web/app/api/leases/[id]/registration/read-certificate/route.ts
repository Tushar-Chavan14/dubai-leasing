import { ENGINE_URL, sessionToken } from "../../../../../../lib/engine";

/** The certificate is up to 10 MB of PDF. */
const MAX_BYTES = 11 * 1024 * 1024;

/**
 * Reads the picked certificate to prefill the record form: streams the multipart form (certificate
 * PDF) to the engine as the signed-in user. Nothing is stored. The engine checks the PDF and the 10 MB cap; the
 * body is never buffered here.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/leases/[id]/registration/read-certificate">) {
  const { id } = await ctx.params;
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again to read the certificate." }, { status: 401 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return Response.json({ error: "The certificate is larger than 10 MB." }, { status: 413 });
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": req.headers.get("content-type") ?? "multipart/form-data",
  };
  if (length) headers["content-length"] = String(length);
  const res = await fetch(`${ENGINE_URL}/api/leases/${encodeURIComponent(id)}/registration/read-certificate`, {
    method: "POST",
    headers,
    body: req.body,
    // Node's fetch needs this to send a stream.
    duplex: "half",
  } as RequestInit);
  const body = await res.json().catch(() => ({ error: `Engine returned ${res.status}` }));
  return Response.json(body, { status: res.status });
}
