"use client";

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { localVoices } from "./speech";
import { initialVoice, isStopEvent, MAX_SECONDS, type VoiceEvent, voiceReducer } from "./state";

/** `endpoint` is a web-server route that relays to the engine. The audio is held in memory only. */
export function useVoice(endpoint: string, onText: (text: string) => void) {
  const [state, rawDispatch] = useReducer(voiceReducer, initialVoice);
  const [level, setLevel] = useState(0);
  const stateRef = useRef(state);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const meter = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const started = useRef(0);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  const dispatch = useCallback((e: VoiceEvent) => {
    if (isStopEvent(stateRef.current, e) && rec.current?.state === "recording") rec.current.stop();
    stateRef.current = voiceReducer(stateRef.current, e);
    rawDispatch(e);
  }, []);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (meter.current) {
      cancelAnimationFrame(meter.current.raf);
      void meter.current.ctx.close();
      meter.current = null;
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setLevel(0);
  }, []);

  useEffect(
    () => () => {
      if (rec.current?.state === "recording") {
        rec.current.onstop = null;
        rec.current.stop();
      }
      cleanup();
    },
    [cleanup],
  );

  const upload = useCallback(
    async (blob: Blob, ms: number) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": blob.type.split(";")[0] || "audio/webm", "x-audio-duration-ms": String(ms) },
          body: blob,
        });
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          text?: string;
          message?: string;
          error?: string;
        } | null;
        if (res.ok && body?.ok && body.text) {
          dispatch({ type: "done" });
          onTextRef.current(body.text);
        } else if (res.ok && body?.message) dispatch({ type: "fail", message: body.message });
        else dispatch({ type: "fail", message: body?.error ?? "We couldn't read that recording. Try again." });
      } catch {
        dispatch({ type: "fail", message: "Network problem. Try again." });
      }
    },
    [endpoint, dispatch],
  );

  const start = useCallback(async () => {
    dispatch({ type: "start" });
    if (stateRef.current.status !== "requesting") return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: "fail", message: "This browser can't record audio. Type instead." });
      return;
    }
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as DOMException).name;
      if (name === "NotAllowedError" || name === "SecurityError") dispatch({ type: "denied" });
      else dispatch({ type: "fail", message: "No microphone found. Type instead." });
      return;
    }
    stream.current = s;
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    if (!mime) {
      cleanup();
      dispatch({ type: "fail", message: "This browser can't record in a supported format. Type instead." });
      return;
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(s, { mimeType: mime });
    rec.current = r;
    r.ondataavailable = (ev) => {
      if (ev.data.size) chunks.push(ev.data);
    };
    r.onstop = () => {
      const ms = Math.min(Date.now() - started.current, MAX_SECONDS * 1000);
      cleanup();
      void upload(new Blob(chunks, { type: mime }), ms);
    };
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(s).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const m = { ctx, raf: 0 };
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        m.raf = requestAnimationFrame(loop);
      };
      m.raf = requestAnimationFrame(loop);
      meter.current = m;
    } catch {
      // The level meter is optional.
    }
    started.current = Date.now();
    r.start();
    dispatch({ type: "granted" });
    timer.current = setInterval(() => dispatch({ type: "tick" }), 1000);
  }, [cleanup, dispatch, upload]);

  const toggle = useCallback(() => {
    if (stateRef.current.status === "recording") dispatch({ type: "stop" });
    else void start();
  }, [dispatch, start]);

  return { state, level, toggle, reset: () => dispatch({ type: "reset" }) };
}

const AUTO_KEY = "leasing.voice.autosend";
const READ_KEY = "leasing.voice.readaloud";

const listeners = new Set<() => void>();

/** A boolean setting kept per browser (server render and first paint see false). */
export function useStored(key: "auto" | "read"): [boolean, (v: boolean) => void] {
  const k = key === "auto" ? AUTO_KEY : READ_KEY;
  const v = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => localStorage.getItem(k) === "1",
    () => false,
  );
  return [
    v,
    (n) => {
      localStorage.setItem(k, n ? "1" : "0");
      for (const l of listeners) l();
    },
  ];
}

/** True once a local speech voice exists (voices load late in some browsers). */
export function useHasLocalVoice() {
  const [has, setHas] = useState(false);
  useEffect(() => {
    const check = () => setHas(localVoices().length > 0);
    check();
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.addEventListener("voiceschanged", check);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", check);
  }, []);
  return has;
}
