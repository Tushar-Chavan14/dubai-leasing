import { cookies } from "next/headers";
import { engineUrl, sessionCookie } from "../../../../../lib/env";

/**
 * A report download (C23, S62): forwards the signed-in session to the engine, which checks the role (compliance only),
 * records the download and serves the file. Only a `<uuid>.csv|pdf` name is forwarded.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^[0-9a-f-]{36}\.(csv|pdf)$/.test(file)) return new Response("Not found", { status: 404 });
  const token = (await cookies()).get(sessionCookie())?.value;
  if (!token) return Response.redirect(new URL("/sign-in", _req.url), 303);
  const res = await fetch(`${engineUrl()}/api/compliance/reports/${file}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401) return Response.redirect(new URL("/sign-in", _req.url), 303);
  if (!res.ok) return new Response("Not found", { status: res.status === 403 ? 404 : res.status === 503 ? 503 : 404 });
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": res.headers.get("content-disposition") ?? "attachment",
      "cache-control": "no-store",
    },
  });
}
