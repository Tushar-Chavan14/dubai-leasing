import { ENGINE_URL } from "../../../../../../../lib/engine";
import { forwardHeaders, isUuid } from "../../../../../../../lib/public";

/** Unit photo for the public site: the engine's public photo route, fetched with the channel secret. */
export async function GET(_req: Request, ctx: RouteContext<"/api/public/units/[id]/photos/[photoId]">) {
  const { id, photoId } = await ctx.params;
  if (!isUuid(id) || !isUuid(photoId)) return new Response(null, { status: 404 });
  const res = await fetch(`${ENGINE_URL}/public/units/${id}/photos/${photoId}`, {
    headers: await forwardHeaders(),
  }).catch(() => null);
  if (!res?.ok) return new Response(null, { status: res?.status ?? 502 });
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}
