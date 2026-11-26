import { ENGINE_URL } from "../../../../../lib/engine";

/** Asks the engine what a selected quote belongs to, and whether it may be changed here. Nothing is stored. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const body = await req.text();
  const res = await fetch(`${ENGINE_URL}/api/portal/${encodeURIComponent(token)}/change-requests/anchor`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    cache: "no-store",
  }).catch(() => null);
  if (!res) return Response.json({ error: "unreachable" }, { status: 502 });
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
}
