import { readVoiceBody } from "../../../../lib/voice-body";
import { ENGINE_URL, sessionToken } from "../../../../lib/engine";

/** Staff voice to text: relays the recording to the engine with the staff session. The audio is not kept here. */
export async function POST(req: Request) {
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
  const read = await readVoiceBody(req);
  if ("response" in read) return read.response;
  const res = await fetch(`${ENGINE_URL}/api/voice/transcribe`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": req.headers.get("content-type") ?? "",
      "x-audio-duration-ms": req.headers.get("x-audio-duration-ms") ?? "",
      authorization: `Bearer ${token}`,
    },
    body: read.bytes as BodyInit,
  });
  const body = await res.json().catch(() => null);
  return Response.json(body ?? { error: "Voice input is unavailable." }, { status: res.status });
}
