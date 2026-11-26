import { cookies } from "next/headers";
import { engineUrl, sessionCookie } from "../../../../lib/env";

const back = (req: Request, error: string) => Response.redirect(new URL(`/compliance?error=${error}`, req.url), 303);

/**
 * A case-pack export (C23, S62): the form names a deal by its reference; this finds it and forwards the signed-in session to
 * `POST /api/compliance/deals/:id/export`. The engine checks the role, builds the pack and logs the export; a role that
 * isn't compliance gets the same "not found" as an unknown deal.
 */
export async function POST(req: Request) {
  const ref = String((await req.formData().catch(() => null))?.get("ref") ?? "").trim();
  if (!/^D-\d{4,}$/.test(ref)) return back(req, "deal");
  const token = (await cookies()).get(sessionCookie())?.value;
  if (!token) return Response.redirect(new URL("/sign-in", req.url), 303);
  const headers = { authorization: `Bearer ${token}` };
  const found = await fetch(`${engineUrl()}/api/deals?q=${encodeURIComponent(ref)}&limit=10`, {
    headers,
    cache: "no-store",
  });
  if (found.status === 401) return Response.redirect(new URL("/sign-in", req.url), 303);
  if (!found.ok) return back(req, "deal");
  const list = (await found.json()) as { items?: { id: string; ref: string }[] };
  const deal = list.items?.find((d) => d.ref === ref);
  if (!deal) return back(req, "deal");
  const res = await fetch(`${engineUrl()}/api/compliance/deals/${deal.id}/export`, {
    method: "POST",
    headers,
    cache: "no-store",
  });
  if (!res.ok) return back(req, res.status === 503 || res.status === 409 ? "export" : "deal");
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": res.headers.get("content-disposition") ?? 'attachment; filename="case.zip"',
      "cache-control": "no-store",
    },
  });
}
