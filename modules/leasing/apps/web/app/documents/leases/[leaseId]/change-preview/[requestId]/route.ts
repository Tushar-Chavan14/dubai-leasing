import { ENGINE_URL, sessionToken } from "../../../../../../lib/engine";

/** Preview PDF of a contract with the officer's decided marks applied (watermarked, nothing stored). */
export async function POST(req: Request, ctx: RouteContext<"/documents/leases/[leaseId]/change-preview/[requestId]">) {
  const { leaseId, requestId } = await ctx.params;
  const token = await sessionToken();
  if (!token) return new Response("Sign in to view documents", { status: 401 });
  const body = await req.text();
  const res = await fetch(
    `${ENGINE_URL}/api/leases/${encodeURIComponent(leaseId)}/contract/change-requests/${encodeURIComponent(requestId)}/preview`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
      cache: "no-store",
    },
  );
  if (!res.ok)
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  return new Response(res.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": "inline",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
