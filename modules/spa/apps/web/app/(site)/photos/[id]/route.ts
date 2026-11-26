import { engineUrl } from "../../../../lib/env";

/**
 * A photo on the public site: streamed from the engine's public route, which serves it only while its owner is public.
 * No session, no engine address or file path in the browser. (Staff photos stay at `/media/<id>`.)
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await fetch(`${engineUrl()}/public/media/${encodeURIComponent(id)}/file`, { cache: "no-store" }).catch(
    () => null,
  );
  if (!res?.ok) return new Response(null, { status: res?.status === 429 ? 429 : 404 });
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": res.headers.get("cache-control") ?? "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
