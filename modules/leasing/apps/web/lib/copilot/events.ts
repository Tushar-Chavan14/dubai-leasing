/** The record a request is about (same shape as the chat's `PageRef`). */
type PageRef = { kind: "lease" | "unit" | "approval"; id: string };

/** Sends a question once (the Workspace's "Draft a reply"). Detail: `{ text, page? }`. */
export const COPILOT_ASK_EVENT = "copilot:ask";
/** Opens the dock with text in the message box (not sent): the "Ask AI to …" buttons. Detail: `{ text, page? }`. */
export const COPILOT_PREFILL_EVENT = "copilot:prefill";

/** The event an Ask AI button dispatches: prefill only, so the user reads and sends the text themselves. */
export function askAiEvent(text: string, page?: PageRef): CustomEvent<{ text: string; page?: PageRef }> {
  return new CustomEvent(COPILOT_PREFILL_EVENT, { detail: page ? { text, page } : { text } });
}
