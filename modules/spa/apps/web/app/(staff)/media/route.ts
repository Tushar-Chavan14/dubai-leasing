import { cookies } from "next/headers";
import { engineUrl, sessionCookie } from "../../../lib/env";

/**
 * Uploads one photo for a project, unit or listing: the form goes to the engine as the signed-in user, and its answer
 * (a small JSON with the new photo's id, or a fixed sentence on a refusal) comes back (S75).
 */
export async function POST(req: Request) {
  const token = (await cookies()).get(sessionCookie())?.value;
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "The photo wasn't sent." }, { status: 400 });
  const res = await fetch(`${engineUrl()}/api/media`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
    cache: "no-store",
  }).catch(() => null);
  if (!res) return Response.json({ error: "The sales engine didn't answer." }, { status: 502 });
  const body = (await res.json().catch(() => ({}))) as { code?: string; media?: { id: string } };
  if (res.ok && body.media) return Response.json({ photo: { id: body.media.id } }, { status: res.status });
  const words: Record<string, string> = {
    too_large: "That photo is larger than 10 MB.",
    unsupported_type: "Only JPEG, PNG or WebP photos.",
    too_many: "At most 24 photos each.",
    forbidden: "Only an admin changes inventory photos.",
  };
  return Response.json(
    { error: words[body.code ?? ""] ?? "The photo wasn't saved. Try again." },
    { status: res.status },
  );
}
