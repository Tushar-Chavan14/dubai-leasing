import { readVoiceBody } from "../../../../lib/voice-body";
import { ENGINE_URL } from "../../../../lib/engine";
import { ensureVisitorId, forwardHeaders } from "../../../../lib/public";

/**
 * Public chat voice to text. Like the chat itself, the browser never calls the engine: this route
 * relays with CHANNEL_SECRET and the client address, for visitors that hold the chat cookie.
 */
export async function POST(req: Request) {
  await ensureVisitorId();
  const read = await readVoiceBody(req);
  if ("response" in read) return read.response;
  const res = await fetch(`${ENGINE_URL}/channel/web/voice`, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...(await forwardHeaders()),
      "content-type": req.headers.get("content-type") ?? "",
      "x-audio-duration-ms": req.headers.get("x-audio-duration-ms") ?? "",
    },
    body: read.bytes as BodyInit,
  }).catch(() => null);
  if (!res) return Response.json({ error: "Voice input is unavailable." }, { status: 502 });
  const body = await res.json().catch(() => null);
  if (res.status === 429)
    return Response.json({ error: "Too many recordings. Wait a while or type instead." }, { status: 429 });
  return Response.json(body ?? { error: "Voice input is unavailable." }, { status: res.status });
}
