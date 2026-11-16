import { ENGINE_URL } from "../../../../../../../lib/engine";

/** Where the words sit on one contract page (pixel space of the page image), so the viewer can make them selectable. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string; n: string }> }) {
  const { token, n } = await ctx.params;
  const res = await fetch(
    `${ENGINE_URL}/api/portal/${encodeURIComponent(token)}/contract/pages/${encodeURIComponent(n)}/text`,
    { cache: "no-store" },
  ).catch(() => null);
  if (!res) return new Response("The service is unreachable.", { status: 502 });
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
