import { ENGINE_URL, sessionToken } from "../../../../../lib/engine";

/** The template preview PDF (sample values, watermarked "Preview"), fetched from the engine as the signed-in admin. */
export async function GET(_req: Request, ctx: RouteContext<"/api/contract-templates/[id]/preview">) {
  const { id } = await ctx.params;
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again to preview." }, { status: 401 });
  const res = await fetch(`${ENGINE_URL}/api/contract-templates/${encodeURIComponent(id)}/preview`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `Engine returned ${res.status}` }));
    return Response.json(body, { status: res.status });
  }
  return new Response(res.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="template-preview.pdf"',
      "cache-control": "private, no-store",
    },
  });
}
