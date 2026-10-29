"use client";

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { VoiceOptions } from "../voice/voice-controls";
import { QuickActions } from "./quick-actions-row";
import type { Pill } from "./quick-actions.ts";

/**
 * The composer both chats share: one card holding the quick-action pills and, 8px below them with
 * the same left edge, the input row (field, mic, voice menu, send). The card draws the focus ring.
 */
export function Composer({
  pills,
  pillsLabel,
  onPick,
  pillsDisabled,
  onSubmit,
  className,
  children,
}: {
  pills: readonly Pill[];
  pillsLabel: string;
  onPick: (p: Pill) => void;
  pillsDisabled?: boolean | undefined;
  onSubmit: (e: FormEvent) => void;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={`ch-composer${className ? ` ${className}` : ""}`}>
      <QuickActions pills={pills} onPick={onPick} disabled={pillsDisabled} label={pillsLabel} />
      <form className="ch-row" onSubmit={onSubmit}>
        {children}
      </form>
    </div>
  );
}

/** Voice settings (auto-send, read replies aloud) in a small popover next to the mic. */
export function VoiceMenu(props: {
  auto: boolean;
  setAuto: (v: boolean) => void;
  read: boolean;
  setRead: (v: boolean) => void;
  canRead: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="vm" ref={box}>
      <button
        type="button"
        className="btn small icon"
        aria-label="Voice settings"
        aria-haspopup="true"
        aria-expanded={open}
        title="Voice settings"
        onClick={() => setOpen((o) => !o)}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div className="vm-pop" role="group" aria-label="Voice settings">
          <VoiceOptions {...props} />
        </div>
      )}
    </div>
  );
}
