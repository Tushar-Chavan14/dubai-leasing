import { ENGINE_URL } from "../../../../lib/engine";

/** Whether voice input is set up (the engine has a whisper-server in VOICE_URL); the microphone shows only then. */
export async function GET() {
  const res = await fetch(`${ENGINE_URL}/health`, { cache: "no-store" }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { voice?: boolean } | null;
  return Response.json({ enabled: body?.voice === true });
}
