import { cookies } from "next/headers";
import { copilotTarget } from "../../../../lib/copilot-proxy";
import { engineUrl, sessionCookie } from "../../../../lib/env";

/**
 * The dock's way in (C36, S68): the browser posts here, never to the engine, and the signed-in session goes along. Which
 * paths pass is `copilotTarget`'s decision; anything else is 404. The answer is passed through as it came.
 */
async function pass(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = copilotTarget(req.method, `/copilot/${path.join("/")}`);
  if (!target) return Response.json({ error: "not found", code: "not_found" }, { status: 404 });
  const token = (await cookies()).get(sessionCookie())?.value;
  if (!token) return Response.json({ error: "unauthorised", code: "unauthorised" }, { status: 401 });
  const body = req.method === "POST" ? await req.text() : undefined;
  if (body !== undefined && body.length > 8192)
    return Response.json({ error: "too long", code: "invalid_request" }, { status: 400 });
  try {
    const res = await fetch(`${engineUrl()}${target}`, {
      method: req.method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body !== undefined ? { body } : {}),
      cache: "no-store",
    });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "unavailable", code: "assistant_unavailable" }, { status: 503 });
  }
}
export const GET = pass;
export const POST = pass;
