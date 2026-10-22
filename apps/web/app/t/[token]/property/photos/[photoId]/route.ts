import { ENGINE_URL } from "../../../../../../lib/engine";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/** A photo of the unit behind an applicant's link; the engine checks the token and the unit. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string; photoId: string }> }) {
  const { token, photoId } = await ctx.params;
  const res = await fetch(
    `${ENGINE_URL}/api/portal/${encodeURIComponent(token)}/photos/${encodeURIComponent(photoId)}`,
    { cache: "no-store" },
  );
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !ALLOWED.has(type)) return new Response("Not found.", { status: 404 });
  return new Response(res.body, {
    headers: {
      "content-type": type,
      "cache-control": "private, max-age=3600",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
