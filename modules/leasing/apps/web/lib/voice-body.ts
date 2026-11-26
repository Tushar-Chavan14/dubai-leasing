/** Same cap as the engine's VOICE_MAX_BYTES. */
export const VOICE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Reads a recording from the browser for the voice relay routes. A missing Content-Length is
 * refused (411); the body is read as a stream and dropped past the cap (413). Nothing is kept.
 */
export async function readVoiceBody(req: Request): Promise<{ bytes: Uint8Array } | { response: Response }> {
  const len = req.headers.get("content-length");
  if (len === null || len.trim() === "" || !Number.isFinite(Number(len)))
    return { response: Response.json({ error: "Content-Length is required." }, { status: 411 }) };
  const tooBig = () =>
    ({ response: Response.json({ error: "The recording is too large (2 MB at most)." }, { status: 413 }) }) as const;
  if (Number(len) > VOICE_MAX_BYTES) return tooBig();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > VOICE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return tooBig();
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { bytes };
}
