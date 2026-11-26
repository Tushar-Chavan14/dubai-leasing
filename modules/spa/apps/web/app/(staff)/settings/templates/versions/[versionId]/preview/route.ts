import { cookies } from "next/headers";
import { engineUrl, sessionCookie } from "../../../../../../../lib/env";

/**
 * The sample preview (C34, S66): forwards the signed-in session to the engine, which checks the role and renders the
 * template with fictional values and a "SAMPLE" mark on every page. Nothing is stored. Only a uuid is forwarded.
 */
export async function GET(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(versionId))
    return new Response("Not found", { status: 404 });
  const token = (await cookies()).get(sessionCookie())?.value;
  if (!token) return Response.redirect(new URL("/sign-in", req.url), 303);
  const res = await fetch(`${engineUrl()}/api/template-versions/${versionId}/preview`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401) return Response.redirect(new URL("/sign-in", req.url), 303);
  if (res.status === 422)
    return new Response("This template can't be previewed yet. Check its blanks and try again.", { status: 422 });
  if (!res.ok) return new Response("Not found", { status: 404 });
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="sample-preview.pdf"',
      "cache-control": "no-store",
    },
  });
}
