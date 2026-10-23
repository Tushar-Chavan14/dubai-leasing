import { ENGINE_URL, sessionToken } from "../../../../../lib/engine";

/** The dispute case pack zip, fetched from the engine as the signed-in user (each export is recorded). */
export async function GET(_req: Request, ctx: RouteContext<"/api/leases/[id]/case-pack">) {
  const { id } = await ctx.params;
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again to export." }, { status: 401 });
  const res = await fetch(`${ENGINE_URL}/api/leases/${encodeURIComponent(id)}/case-pack.zip`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `Engine returned ${res.status}` }));
    return Response.json(body, { status: res.status });
  }
  return new Response(res.body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": res.headers.get("content-disposition") ?? 'attachment; filename="case-pack.zip"',
      "cache-control": "private, no-store",
    },
  });
}
