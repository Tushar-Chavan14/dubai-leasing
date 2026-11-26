import { ENGINE_URL, sessionToken } from "../../../../../../lib/engine";

/** The manual registration pack (PDF) for signed-in leasing staff. Each open is audited by the engine. */
export async function GET(_req: Request, ctx: RouteContext<"/api/leases/[id]/registration/pack">) {
  const { id } = await ctx.params;
  const token = await sessionToken();
  if (!token) return new Response("Sign in to view the pack", { status: 401 });
  const res = await fetch(`${ENGINE_URL}/api/leases/${encodeURIComponent(id)}/registration/pack.pdf`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
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
