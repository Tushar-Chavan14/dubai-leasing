"use client";

import { IconSpark } from "../lib/icons";
import { COPILOT_PREFILL_EVENT } from "./copilot/panel";

/**
 * Opens the copilot side panel on this page with a request typed in for the user to finish and send. Nothing is
 * sent, and the page stays where it is.
 */
export function AskAi({ prompt, label }: { prompt: string; label: string }) {
  return (
    <button
      type="button"
      className="btn small ghost ask-ai"
      onClick={() => window.dispatchEvent(new CustomEvent(COPILOT_PREFILL_EVENT, { detail: { text: prompt } }))}
    >
      <IconSpark size={14} />
      {label}
    </button>
  );
}
