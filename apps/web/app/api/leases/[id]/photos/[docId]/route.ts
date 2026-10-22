import { ENGINE_URL, sessionToken } from "../../../../../../lib/engine";

/** A tenancy photo (condition, proof, issue) for staff; the engine records every view. */
export async function GET(_req: Request, ctx: RouteContext<"/api/leases/[id]/photos/[docId]">) {
  const { id, docId } = await ctx.params;
  const token = await sessionToken();
  if (!token) return new Response("Sign in again.", { status: 401 });
  const res = await fetch(`${ENGINE_URL}/api/leases/${encodeURIComponent(id)}/photos/${encodeURIComponent(docId)}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return new Response("Not found", { status: res.status });
  return new Response(res.body, {
    headers: { "content-type": res.headers.get("content-type") ?? "image/jpeg", "cache-control": "private, no-store" },
  });
}
