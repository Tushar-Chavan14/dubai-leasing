import { engineUrl } from "../../../../../../lib/env";

const MAX_BYTES = 10 * 1024 * 1024 + 100_000;

/**
 * A party's file goes through this site, never straight from the browser to the engine. The form is plain HTML, so it
 * works without scripts and is not held to a server action's size limit. Only `kind` and `file` are passed on: whose
 * document it is comes from the token, so no other field is read.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = (q: string) => new Response(null, { status: 303, headers: { location: `/b/${token}/documents?${q}` } });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return back("error=invalid_file");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind");
  if (!(file instanceof File) || !file.size || typeof kind !== "string") return back("error=invalid_file");
  const out = new FormData();
  out.set("kind", kind);
  out.set("file", file, file.name);
  const res = await fetch(`${engineUrl()}/public/portal/${encodeURIComponent(token)}/documents`, {
    method: "POST",
    body: out,
    cache: "no-store",
  }).catch(() => null);
  if (res?.ok) return back("uploaded=1");
  const code = ((await res?.json().catch(() => null)) as { code?: string } | null)?.code;
  return back(`error=${encodeURIComponent(code ?? "internal")}`);
}
