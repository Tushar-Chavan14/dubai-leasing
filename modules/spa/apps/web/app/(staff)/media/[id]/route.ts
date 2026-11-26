import { cookies } from "next/headers";
import { engineUrl, sessionCookie } from "../../../../lib/env";

/**
 * Marketing photos are for signed-in staff: this streams one from the engine with the session's token, so the browser
 * never sees the engine address or a file path (S75).
 */
export async function GET(_req: Request, ctx: RouteContext<"/media/[id]">) {
  const { id } = await ctx.params;
  const token = (await cookies()).get(sessionCookie())?.value;
  if (!token) return new Response("Sign in to view photos", { status: 401 });
  const res = await fetch(`${engineUrl()}/api/media/${encodeURIComponent(id)}/file`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return new Response(null, { status: res.status === 401 ? 401 : res.status === 403 ? 403 : 404 });
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": res.headers.get("cache-control") ?? "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
