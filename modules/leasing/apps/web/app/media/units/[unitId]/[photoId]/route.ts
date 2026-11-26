import { ENGINE_URL, sessionToken } from "../../../../../lib/engine";

/** Unit photos are only visible to signed-in staff: this proxies the engine with the session. */
export async function GET(_req: Request, ctx: RouteContext<"/media/units/[unitId]/[photoId]">) {
  const { unitId, photoId } = await ctx.params;
  const token = await sessionToken();
  if (!token) return new Response("Sign in to view photos", { status: 401 });
  const res = await fetch(
    `${ENGINE_URL}/api/units/${encodeURIComponent(unitId)}/photos/${encodeURIComponent(photoId)}`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) return new Response(null, { status: res.status });
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": res.headers.get("cache-control") ?? "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}
