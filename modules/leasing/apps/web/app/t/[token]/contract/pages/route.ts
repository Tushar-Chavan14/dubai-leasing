import { ENGINE_URL } from "../../../../../lib/engine";

/** How many pages the read-only contract viewer shows, fetched with the signing link. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const res = await fetch(`${ENGINE_URL}/api/portal/${encodeURIComponent(token)}/contract/pages`, {
    cache: "no-store",
  });
  if (res.status === 429) return new Response("Too many requests", { status: 429, headers: { "retry-after": "60" } });
  if (!res.ok) return new Response("This link has expired.", { status: 404 });
  return new Response(res.body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
