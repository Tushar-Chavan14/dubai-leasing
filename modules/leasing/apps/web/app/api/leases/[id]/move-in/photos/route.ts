import { ENGINE_URL, sessionToken } from "../../../../../../lib/engine";

/** A move-in condition photo from the browser, forwarded to the engine as the signed-in user. */
export async function POST(req: Request, ctx: RouteContext<"/api/leases/[id]/move-in/photos">) {
  const { id } = await ctx.params;
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again to upload photos." }, { status: 401 });
  const form = await req.formData();
  const res = await fetch(`${ENGINE_URL}/api/leases/${encodeURIComponent(id)}/move-in/photos`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json().catch(() => ({ error: `Engine returned ${res.status}` }));
  return Response.json(body, { status: res.status });
}
