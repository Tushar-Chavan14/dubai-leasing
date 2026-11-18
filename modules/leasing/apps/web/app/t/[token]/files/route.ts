import { ENGINE_URL } from "../../../../lib/engine";

/**
 * Tenancy photos from the portal (own move-in photos, payment proof, photos of an issue):
 * browser → this route → engine, authenticated by the link token only.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (Number(req.headers.get("content-length") ?? 0) > 11 * 1024 * 1024) {
    return Response.json({ error: "The photo is larger than 10 MB." }, { status: 413 });
  }
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(token)) return Response.json({ error: "This link isn't valid." }, { status: 404 });
  const res = await fetch(`${ENGINE_URL}/api/portal/${encodeURIComponent(token)}/files`, {
    method: "POST",
    body: await req.formData(),
    cache: "no-store",
  }).catch(() => null);
  if (!res)
    return Response.json({ error: "We couldn't reach the leasing system. Try again shortly." }, { status: 502 });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
}
