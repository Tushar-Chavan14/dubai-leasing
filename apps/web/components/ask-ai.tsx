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

/**
 * "Ask AI" with a short list of request templates: picking one opens the copilot panel with it typed in, for the user
 * to finish and send. Nothing is sent.
 */
export function AskAiMenu({ label, prompts }: { label: string; prompts: { label: string; prompt: string }[] }) {
  return (
    <details className="ask-ai-menu">
      <summary className="btn small ghost ask-ai">
        <IconSpark size={14} />
        {label}
      </summary>
      <ul role="menu">
        {prompts.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.currentTarget.closest("details")?.removeAttribute("open");
                window.dispatchEvent(new CustomEvent(COPILOT_PREFILL_EVENT, { detail: { text: p.prompt } }));
              }}
            >
              {p.label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
