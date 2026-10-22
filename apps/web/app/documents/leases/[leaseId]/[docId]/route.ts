import { ENGINE_URL, sessionToken } from "../../../../../lib/engine";

/** Generated lease documents (notice PDFs) for signed-in staff. */
export async function GET(_req: Request, ctx: RouteContext<"/documents/leases/[leaseId]/[docId]">) {
  const { leaseId, docId } = await ctx.params;
  const token = await sessionToken();
  if (!token) return new Response("Sign in to view documents", { status: 401 });
  const res = await fetch(
    `${ENGINE_URL}/api/leases/${encodeURIComponent(leaseId)}/documents/${encodeURIComponent(docId)}`,
    {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  if (!res.ok) return new Response(null, { status: res.status });
  return new Response(res.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": res.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
