import { z } from "zod";

/** Speech to text for voice input (D39): a local whisper.cpp `whisper-server`. */
export interface Transcriber {
  transcribe(
    bytes: Uint8Array,
    mime: string,
  ): Promise<{ text: string; language: "en" | "ar" | "other"; confidence: number }>;
}

const Verbose = z.object({
  text: z.string(),
  language: z.string().optional(),
  segments: z.array(z.object({ no_speech_prob: z.number().optional() }).passthrough()).optional(),
});

function isLoopback(url: string): boolean {
  const host = new URL(url).hostname;
  const octets = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number);
  return host === "localhost" || host === "::1" || host === "[::1]" || (!!octets && octets.every((o) => o <= 255));
}

/**
 * `whisper-server -m ggml-base.bin --host 127.0.0.1 --port 8178 --convert`. Visitor and staff speech is personal
 * data, so the server must be on a loopback address (AGENTS rule 8); anything else throws at start-up. The clip is
 * sent in memory and never written by the engine. Confidence is 1 − the highest segment no-speech probability.
 */
export function whisperTranscriber(url: string): Transcriber {
  if (!isLoopback(url))
    throw new Error(`Voice can only go to a local whisper-server; VOICE_URL points at ${new URL(url).hostname}`);
  const endpoint = `${url.replace(/\/$/, "")}/inference`;
  return {
    async transcribe(bytes, mime) {
      const form = new FormData();
      form.set(
        "file",
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }),
        mime.includes("ogg") ? "clip.ogg" : "clip.webm",
      );
      form.set("response_format", "verbose_json");
      form.set("temperature", "0");
      // whisper-server defaults to English; detect the language so Arabic is transcribed as Arabic.
      form.set("language", "auto");
      const res = await fetch(endpoint, {
        method: "POST",
        body: form,
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`whisper-server answered ${res.status}`);
      const v = Verbose.parse(await res.json());
      // Whisper's markers for silence or noise ("[BLANK_AUDIO]", "(music)") are not speech.
      const text = v.text.replace(/\[[A-Z_ ]+\]|\((?:music|noise|silence|applause|laughs?)\)/gi, "").trim();
      const lang = (v.language ?? "").toLowerCase();
      const language = lang === "en" || lang === "english" ? "en" : lang === "ar" || lang === "arabic" ? "ar" : "other";
      const noSpeech = Math.max(0, ...(v.segments ?? []).map((s) => s.no_speech_prob ?? 0));
      const confidence = text ? Math.round((1 - noSpeech) * 100) / 100 : 0;
      return { text, language, confidence };
    },
  };
}
