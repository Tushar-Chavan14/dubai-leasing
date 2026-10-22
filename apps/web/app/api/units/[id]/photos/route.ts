import { ENGINE_URL, sessionToken } from "../../../../../lib/engine";

/**
 * Photo upload from the browser: forwards one multipart file to the engine as the signed-in user.
 * (A route handler rather than a server action, so large photos aren't limited by the action body size.)
 */
export async function POST(req: Request, ctx: RouteContext<"/api/units/[id]/photos">) {
  const { id } = await ctx.params;
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again to upload photos." }, { status: 401 });
  const form = await req.formData();
  const res = await fetch(`${ENGINE_URL}/api/units/${encodeURIComponent(id)}/photos`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json().catch(() => ({ error: `Engine returned ${res.status}` }));
  return Response.json(body, { status: res.status });
}
