import { publicEngine } from "../../../../../lib/engine";

/** The agreement PDF for a signer's link: the engine is reachable only from the server, so this passes it on. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await publicEngine()
    .public["sign-links"][":token"].document.$get({ param: { token } })
    .catch(() => null);
  if (!res?.ok) return new Response("This link isn't valid.", { status: res?.status ?? 502 });
  return new Response(await res.arrayBuffer(), {
    headers: { "content-type": "application/pdf", "cache-control": "no-store" },
  });
}
