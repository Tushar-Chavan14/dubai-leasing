import { cookies } from "next/headers";
import { engineUrl, sessionCookie } from "../../../../../lib/env";

/**
 * Uploads one listing document (title deed, Oqood certificate, signed agreement or permit): the form goes to the engine
 * as the signed-in user, and a fixed sentence comes back on a refusal (S77).
 */
export async function POST(req: Request, ctx: RouteContext<"/listings/[id]/documents">) {
  const { id } = await ctx.params;
  const token = (await cookies()).get(sessionCookie())?.value;
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "The file wasn't sent." }, { status: 400 });
  const res = await fetch(`${engineUrl()}/api/listings/${encodeURIComponent(id)}/documents`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
    cache: "no-store",
  }).catch(() => null);
  if (!res) return Response.json({ error: "The sales engine didn't answer." }, { status: 502 });
  const body = (await res.json().catch(() => ({}))) as { code?: string; id?: string; duplicate?: boolean };
  if (res.ok) return Response.json({ id: body.id, duplicate: !!body.duplicate }, { status: res.status });
  const words: Record<string, string> = {
    too_large: "That file is larger than 10 MB.",
    unsupported_file: "Send a PDF, or a JPEG, PNG or WebP image.",
    forbidden: "Only a sales role adds listing documents.",
    listing_not_editable: "This listing is closed and takes no more documents.",
  };
  return Response.json(
    { error: words[body.code ?? ""] ?? "The file wasn't saved. Try again." },
    { status: res.status },
  );
}
