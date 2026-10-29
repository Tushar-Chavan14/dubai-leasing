/** Voice recorder state machine (pure, so it can be unit tested). The hook drives it from MediaRecorder events. */
export const MAX_SECONDS = 30;

export type VoiceState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "recording"; secondsLeft: number }
  | { status: "transcribing" }
  | { status: "denied" }
  | { status: "error"; message: string };

export type VoiceEvent =
  | { type: "start" }
  | { type: "granted" }
  | { type: "denied" }
  | { type: "tick" }
  | { type: "stop" }
  | { type: "done" }
  | { type: "fail"; message: string }
  | { type: "reset" };

export const initialVoice: VoiceState = { status: "idle" };

export const isStopEvent = (s: VoiceState, e: VoiceEvent) =>
  s.status === "recording" && (e.type === "stop" || (e.type === "tick" && s.secondsLeft <= 1));

export function voiceReducer(s: VoiceState, e: VoiceEvent): VoiceState {
  switch (e.type) {
    case "start":
      return s.status === "idle" || s.status === "denied" || s.status === "error" ? { status: "requesting" } : s;
    case "granted":
      return s.status === "requesting" ? { status: "recording", secondsLeft: MAX_SECONDS } : s;
    case "denied":
      return s.status === "requesting" ? { status: "denied" } : s;
    case "tick":
      if (s.status !== "recording") return s;
      return s.secondsLeft <= 1 ? { status: "transcribing" } : { status: "recording", secondsLeft: s.secondsLeft - 1 };
    case "stop":
      return s.status === "recording" ? { status: "transcribing" } : s;
    case "done":
      return s.status === "transcribing" ? { status: "idle" } : s;
    case "fail":
      return s.status === "requesting" || s.status === "recording" || s.status === "transcribing"
        ? { status: "error", message: e.message }
        : s;
    case "reset":
      return initialVoice;
  }
}

/** Text for the aria-live status line. */
export function voiceStatusText(s: VoiceState): string {
  switch (s.status) {
    case "idle":
      return "";
    case "requesting":
      return "Waiting for microphone permission.";
    case "recording":
      return `Recording, ${s.secondsLeft} seconds left. Press again to stop.`;
    case "transcribing":
      return "Turning your recording into text.";
    case "denied":
      return "Microphone access is blocked. Allow it in your browser settings, or type instead.";
    case "error":
      return s.message;
  }
}
