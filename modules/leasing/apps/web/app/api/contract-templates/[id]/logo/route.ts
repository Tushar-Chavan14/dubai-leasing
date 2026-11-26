import { ENGINE_URL, sessionToken } from "../../../../../lib/engine";

/** The logo image read from a sample contract, for the admin to confirm or drop. */
export async function GET(_req: Request, ctx: RouteContext<"/api/contract-templates/[id]/logo">) {
  const { id } = await ctx.params;
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const res = await fetch(`${ENGINE_URL}/api/contract-templates/${encodeURIComponent(id)}/logo`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return new Response(null, { status: res.status });
  return new Response(res.body, {
    headers: { "content-type": res.headers.get("content-type") ?? "image/png", "cache-control": "private, max-age=60" },
  });
}
