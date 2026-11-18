import { ENGINE_URL } from "../../../../lib/engine";

/** The tenant's notice PDF, fetched with the portal token. */
export async function GET(_req: Request, ctx: RouteContext<"/t/[token]/notice.pdf">) {
  const { token } = await ctx.params;
  const res = await fetch(`${ENGINE_URL}/api/portal/${encodeURIComponent(token)}/notice.pdf`, { cache: "no-store" });
  if (!res.ok) return new Response("This link has expired.", { status: 404 });
  return new Response(res.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="renewal-notice.pdf"',
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
