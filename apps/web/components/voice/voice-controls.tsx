"use client";

import { useEffect, useRef } from "react";
import { speak, stopSpeaking } from "./speech";
import { voiceStatusText } from "./state";
import { useVoice } from "./use-voice";

/** Mic button: tap to start, tap again to stop (or hold-free "press to talk" with Space/Enter). */
export function MicButton({
  endpoint,
  onText,
  disabled,
}: {
  endpoint: string;
  onText: (t: string) => void;
  disabled?: boolean;
}) {
  const { state, level, toggle } = useVoice(endpoint, onText);
  const recording = state.status === "recording";
  const busy = state.status === "requesting" || state.status === "transcribing";
  const label = recording ? "Stop recording" : "Record a voice message";
  return (
    <>
      <button
        type="button"
        className="btn small voice-mic"
        data-recording={recording || undefined}
        aria-label={label}
        aria-pressed={recording}
        title={label}
        disabled={disabled || busy}
        onClick={toggle}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          {recording ? (
            <rect x="6" y="6" width="12" height="12" rx="2" />
          ) : (
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2Z" />
          )}
        </svg>
        {recording && (
          <span className="voice-meter" aria-hidden="true">
            <i style={{ transform: `scaleX(${Math.max(0.05, level)})` }} />
          </span>
        )}
        {recording && <span className="voice-count">{state.secondsLeft}s</span>}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {voiceStatusText(state)}
      </span>
      {(state.status === "denied" || state.status === "error") && (
        <span className="voice-note" role="alert">
          {voiceStatusText(state)}
        </span>
      )}
    </>
  );
}

/** Per-browser voice options: auto-send and (when a local voice exists) read replies aloud. */
export function VoiceOptions({
  auto,
  setAuto,
  read,
  setRead,
  canRead,
}: {
  auto: boolean;
  setAuto: (v: boolean) => void;
  read: boolean;
  setRead: (v: boolean) => void;
  canRead: boolean;
}) {
  return (
    <div className="voice-options">
      <label>
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-send voice
      </label>
      {canRead && (
        <label>
          <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} /> Read replies aloud
        </label>
      )}
    </div>
  );
}

/** Reads each new reply aloud when the option is on. The first message seen (loaded history) is skipped. */
export function useReadAloud(enabled: boolean, latest: { key: string; text: string } | undefined) {
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) stopSpeaking();
  }, [enabled]);
  useEffect(() => {
    if (seen.current === undefined) {
      seen.current = latest?.key ?? null;
      return;
    }
    if (!latest || latest.key === seen.current) return;
    seen.current = latest.key;
    if (enabled) speak(latest.text);
  }, [enabled, latest]);
}
