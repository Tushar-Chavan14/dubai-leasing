import { describe, expect, test } from "bun:test";
import { initialVoice, MAX_SECONDS, type VoiceEvent, voiceReducer, type VoiceState } from "../components/voice/state";

const run = (events: VoiceEvent[], from: VoiceState = initialVoice) => events.reduce(voiceReducer, from);

describe("voice recorder state machine", () => {
  test("happy path: start, grant, stop, transcribed", () => {
    expect(run([{ type: "start" }]).status).toBe("requesting");
    expect(run([{ type: "start" }, { type: "granted" }])).toEqual({ status: "recording", secondsLeft: MAX_SECONDS });
    expect(run([{ type: "start" }, { type: "granted" }, { type: "stop" }]).status).toBe("transcribing");
    expect(run([{ type: "start" }, { type: "granted" }, { type: "stop" }, { type: "done" }]).status).toBe("idle");
  });

  test("countdown stops the recording at 30 s", () => {
    const rec = run([{ type: "start" }, { type: "granted" }]);
    const ticks = Array.from({ length: MAX_SECONDS - 1 }, () => ({ type: "tick" }) as const);
    expect(run(ticks, rec)).toEqual({ status: "recording", secondsLeft: 1 });
    expect(run([...ticks, { type: "tick" }], rec).status).toBe("transcribing");
  });

  test("denied and error states can be retried; stray events are ignored", () => {
    const denied = run([{ type: "start" }, { type: "denied" }]);
    expect(denied.status).toBe("denied");
    expect(voiceReducer(denied, { type: "start" }).status).toBe("requesting");
    const err = run([{ type: "start" }, { type: "granted" }, { type: "fail", message: "x" }]);
    expect(err).toEqual({ status: "error", message: "x" });
    expect(voiceReducer(err, { type: "start" }).status).toBe("requesting");
    expect(voiceReducer(initialVoice, { type: "stop" })).toBe(initialVoice);
    expect(voiceReducer(initialVoice, { type: "tick" })).toBe(initialVoice);
    expect(run([{ type: "start" }, { type: "start" }]).status).toBe("requesting");
  });
});
