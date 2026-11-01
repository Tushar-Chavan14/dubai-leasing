import { afterEach, describe, expect, test } from "bun:test";
import { whisperTranscriber } from "../src/whisper.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const answer = (body: unknown, status = 200) => {
  const seen: { url: string; form: FormData }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), form: init.body as FormData });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return seen;
};

describe("whisper transcriber", () => {
  test("posts the clip to /inference and maps verbose_json", async () => {
    const seen = answer({
      text: " two bedroom in marina ",
      language: "en",
      segments: [{ no_speech_prob: 0.05 }, { no_speech_prob: 0.2 }],
    });
    const r = await whisperTranscriber("http://127.0.0.1:8178").transcribe(new Uint8Array([1, 2]), "audio/webm");
    expect(r).toEqual({ text: "two bedroom in marina", language: "en", confidence: 0.8 });
    expect(seen[0]!.url).toBe("http://127.0.0.1:8178/inference");
    expect(seen[0]!.form.get("response_format")).toBe("verbose_json");
    expect(seen[0]!.form.get("file")).toBeInstanceOf(Blob);
  });

  test("Arabic, other languages, and text with no segments", async () => {
    answer({ text: "مرحبا", language: "arabic", segments: [] });
    expect(await whisperTranscriber("http://localhost:8178").transcribe(new Uint8Array([1]), "audio/ogg")).toEqual({
      text: "مرحبا",
      language: "ar",
      confidence: 1,
    });
    answer({ text: "bonjour", language: "fr" });
    expect(
      (await whisperTranscriber("http://localhost:8178").transcribe(new Uint8Array([1]), "audio/ogg")).language,
    ).toBe("other");
  });

  test("an error status throws (the caller retries once, then asks to try again)", async () => {
    answer({ error: "busy" }, 500);
    expect(whisperTranscriber("http://127.0.0.1:8178").transcribe(new Uint8Array([1]), "audio/webm")).rejects.toThrow();
  });

  test("a non-loopback whisper-server is refused (audio stays local)", () => {
    expect(() => whisperTranscriber("http://10.0.0.5:8178")).toThrow("local");
    expect(() => whisperTranscriber("https://whisper.example.com")).toThrow("local");
  });
});
