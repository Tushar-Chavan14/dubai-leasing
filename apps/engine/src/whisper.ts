import { z } from "zod";

/** Speech to text for voice input (D39): a local whisper.cpp `whisper-server`. */
export interface Transcriber {
  transcribe(
    bytes: Uint8Array,
    mime: string,
  ): Promise<{ text: string; language: "en" | "ar" | "other"; confidence: number }>;
  /** Whether the speech server answers right now (the microphone is shown only then). */
  ready?(): Promise<boolean>;
}

/** The whisper-server isn't running or can't be reached (not a problem with the recording). */
const unavailable = (url: string) =>
  Object.assign(new Error(`whisper-server at ${url} isn't reachable; start it with: bun run voice`), {
    name: "VoiceUnavailable",
  });

/** How long a "ready" answer is reused, so pages that check it don't probe the server on every request. */
const READY_CACHE_MS = 15_000;

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
  const base = url.replace(/\/$/, "");
  const endpoint = `${base}/inference`;
  let readyCache: { at: number; ok: boolean } | null = null;
  return {
    async ready() {
      // performance.now() is a monotonic timer for the cache, not a domain date (rule 5).
      if (readyCache && performance.now() - readyCache.at < READY_CACHE_MS) return readyCache.ok;
      const ok = await fetch(`${base}/`, { redirect: "error", signal: AbortSignal.timeout(1500) })
        .then((r) => (void r.body?.cancel(), true))
        .catch(() => false);
      readyCache = { at: performance.now(), ok };
      return ok;
    },
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
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          body: form,
          redirect: "error",
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        // A timeout is a slow server (the caller asks to try again); anything else means it isn't there.
        if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw e;
        readyCache = { at: performance.now(), ok: false };
        throw unavailable(base);
      }
      if (!res.ok) throw new Error(`whisper-server answered ${res.status}`);
      const v = Verbose.parse(await res.json());
      // Whisper's markers for silence or noise ("[BLANK_AUDIO]", "(music)") are not speech.
      const text = v.text
        .replace(/\[[A-Z_ ]+\]|\((?:music|noise|silence|applause|laughs?)\)/gi, "")
        // whisper breaks long segments with newlines; the composer wants one line of text.
        .replace(/\s+/g, " ")
        .trim();
      const lang = (v.language ?? "").toLowerCase();
      const language = lang === "en" || lang === "english" ? "en" : lang === "ar" || lang === "arabic" ? "ar" : "other";
      const noSpeech = Math.max(0, ...(v.segments ?? []).map((s) => s.no_speech_prob ?? 0));
      const confidence = text ? Math.round((1 - noSpeech) * 100) / 100 : 0;
      return { text, language, confidence };
    },
  };
}
