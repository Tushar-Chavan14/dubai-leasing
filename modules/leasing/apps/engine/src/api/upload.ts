import { unprocessable } from "../errors.ts";

/** Reads a request body, refusing more than `max` bytes without buffering the rest (Content-Length first, then the stream). */
export async function readLimited(req: Request, max: number): Promise<Uint8Array> {
  const tooBig = () => unprocessable("The file is larger than 10 MB.", [], "too_big");
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) throw tooBig();
  if (!req.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
