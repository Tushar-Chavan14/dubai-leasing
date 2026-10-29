import { ENGINE_URL, sessionToken } from "../../../../../lib/engine";

/**
 * Sample contract upload from the browser: streams the PDF to the engine as the signed-in user. The engine
 * enforces admin only, PDF only and the 10 MB cap (it checks Content-Length and counts the stream), so the
 * file is never buffered here.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/contract-rules/[id]/sample">) {
  const { id } = await ctx.params;
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again to upload." }, { status: 401 });
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": req.headers.get("content-type") ?? "application/pdf",
  };
  const length = req.headers.get("content-length");
  if (length) headers["content-length"] = length;
  const res = await fetch(`${ENGINE_URL}/api/contract-rules/${encodeURIComponent(id)}/sample`, {
    method: "POST",
    headers,
    body: req.body,
    // Node's fetch needs this to send a stream.
    duplex: "half",
  } as RequestInit);
  const body = await res.json().catch(() => ({ error: `Engine returned ${res.status}` }));
  return Response.json(body, { status: res.status });
}
