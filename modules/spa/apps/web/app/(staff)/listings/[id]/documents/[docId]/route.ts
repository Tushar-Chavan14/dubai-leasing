import { cookies } from "next/headers";
import { engineUrl, sessionCookie } from "../../../../../../lib/env";

/**
 * A listing document is for signed-in sales staff: this streams it from the engine with the session's token, so the
 * browser never sees the engine address or a file path (S77).
 */
export async function GET(_req: Request, ctx: RouteContext<"/listings/[id]/documents/[docId]">) {
  const { id, docId } = await ctx.params;
  const token = (await cookies()).get(sessionCookie())?.value;
  if (!token) return new Response("Sign in to view documents", { status: 401 });
  const res = await fetch(
    `${engineUrl()}/api/listings/${encodeURIComponent(id)}/documents/${encodeURIComponent(docId)}/file`,
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!res.ok) return new Response(null, { status: res.status === 401 ? 401 : res.status === 403 ? 403 : 404 });
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, no-store",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
    },
  });
}
