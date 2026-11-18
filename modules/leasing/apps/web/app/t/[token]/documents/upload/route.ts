import { ENGINE_URL } from "../../../../../lib/engine";

/**
 * Applicant ID uploads: browser → this route → engine (authenticated by the upload link token
 * only). A route handler, not a server action, so photo size isn't capped by the action limit.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  // Refuse oversized bodies before reading them (the engine checks again).
  if (Number(req.headers.get("content-length") ?? 0) > 11 * 1024 * 1024) {
    return Response.json({ error: "The photo is larger than 10 MB." }, { status: 413 });
  }
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(token)) return Response.json({ error: "This link isn't valid." }, { status: 404 });
  const res = await fetch(`${ENGINE_URL}/api/portal/${encodeURIComponent(token)}/documents`, {
    method: "POST",
    body: await req.formData(),
    cache: "no-store",
  }).catch(() => null);
  if (!res)
    return Response.json({ error: "We couldn't reach the leasing system. Try again shortly." }, { status: 502 });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const doc = new URL(req.url).searchParams.get("doc") ?? "";
  const res = await fetch(
    `${ENGINE_URL}/api/portal/${encodeURIComponent(token)}/documents/${encodeURIComponent(doc)}`,
    {
      method: "DELETE",
      cache: "no-store",
    },
  ).catch(() => null);
  if (!res) return Response.json({ error: "We couldn't reach the leasing system." }, { status: 502 });
  return new Response(res.status === 204 ? null : res.body, { status: res.status });
}
