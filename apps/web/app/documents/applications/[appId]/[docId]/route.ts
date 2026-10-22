import { ENGINE_URL, sessionToken } from "../../../../../lib/engine";

/**
 * An applicant's uploaded ID image, for signed-in leasing staff. The engine checks the role and
 * records every view on the application. Never cached.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ appId: string; docId: string }> }) {
  const { appId, docId } = await ctx.params;
  const token = await sessionToken();
  if (!token) return new Response("Sign in to view documents", { status: 401 });
  const res = await fetch(
    `${ENGINE_URL}/api/applications/${encodeURIComponent(appId)}/documents/${encodeURIComponent(docId)}`,
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!res.ok) return new Response(null, { status: res.status });
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
