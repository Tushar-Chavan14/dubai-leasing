"use client";

import { SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { askAiEvent } from "../lib/copilot/events";
import type { PageRef } from "./copilot/use-chat";

const PILL =
  "inline-flex cursor-pointer list-none h-9 items-center gap-1.5 rounded-full border-0 px-4 font-sans text-sm font-semibold text-on-accent";

const PILL_SM =
  "inline-flex cursor-pointer list-none h-7 items-center gap-1 rounded-full border-0 px-3 font-sans text-xs font-semibold text-on-accent";

const askAi = (text: string, page?: PageRef) => window.dispatchEvent(askAiEvent(text, page));

/**
 * Opens the docked agent with a request typed in for the user to finish and send. Nothing is sent, and the page
 * stays where it is. Give `page` when the request is about a record, so the agent starts a thread about it.
 */
export function AskAi({
  prompt,
  label,
  page,
  compact = false,
  onAccent = false,
}: {
  prompt: string;
  label: string;
  page?: PageRef;
  /** A smaller pill, for rows of a list. */
  compact?: boolean;
  /** On the tinted gate panel, where the usual tint would vanish. */
  onAccent?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${compact ? PILL_SM : PILL} ${onAccent ? "bg-black/10" : "bg-accent"} ask-ai`}
      onClick={() => askAi(prompt, page)}
    >
      <SparkleIcon size={compact ? 12 : 14} weight="fill" aria-hidden />
      {label}
    </button>
  );
}

/**
 * "Ask AI" with a short list of request templates: picking one opens the docked agent with it typed in, for the user
 * to finish and send. Nothing is sent.
 */
export function AskAiMenu({
  label,
  prompts,
  page,
}: {
  label: string;
  prompts: { label: string; prompt: string }[];
  page?: PageRef;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  // The menu is fixed to the viewport so scrolling columns can't clip it, and kept on screen near either edge.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const place = () => {
    const r = ref.current?.querySelector("summary")?.getBoundingClientRect();
    if (!r) return;
    const width = 280;
    // Right-aligned to the button, or left-aligned when that would run off the left edge.
    const want = r.right - width >= 8 ? r.right - width : r.left;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(want, window.innerWidth - width - 8)) });
  };
  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => {
      if (e.type === "mousedown" && ref.current?.contains(e.target as Node)) return;
      ref.current?.removeAttribute("open");
      setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(e);
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [pos]);
  return (
    <details ref={ref} className="ask-ai-menu" onToggle={(e) => (e.currentTarget.open ? place() : setPos(null))}>
      <summary className={`${PILL} bg-accent ask-ai`}>
        <SparkleIcon size={14} weight="fill" aria-hidden />
        {label}
      </summary>
      <ul
        role="menu"
        style={pos ? { position: "fixed", top: pos.top, left: pos.left, right: "auto", zIndex: 60 } : undefined}
      >
        {prompts.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.currentTarget.closest("details")?.removeAttribute("open");
                askAi(p.prompt, page);
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
