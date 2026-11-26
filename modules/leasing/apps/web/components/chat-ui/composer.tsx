"use client";

import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from "react";
import { ComposerCard, FIELD_BARE, SEND_BTN, TOOL_BTN } from "@platform/ui/shell/composer";
import { VoiceOptions } from "../voice/voice-controls";
import { QuickActions } from "./quick-actions-row";
import type { Pill } from "./quick-actions.ts";

export { FIELD_BARE, SEND_BTN, TOOL_BTN };

/**
 * The composer both chats share (staff dock and public chat): a rounded card with the field on top, tools (mic, voice settings) bottom left and the
 * round send button bottom right. Suggestion chips (children) and quick-action pills sit below the card.
 */
export function StaffComposer({
  pills,
  pillsLabel,
  onPick,
  pillsDisabled,
  onSubmit,
  field,
  tools,
  send,
  children,
}: {
  pills: readonly Pill[];
  pillsLabel: string;
  onPick: (p: Pill) => void;
  pillsDisabled?: boolean | undefined;
  onSubmit: (e: SyntheticEvent) => void;
  field: ReactNode;
  tools: ReactNode;
  send: ReactNode;
  /** Suggestion chips shown below the card. */
  children?: ReactNode;
}) {
  const chips = Array.isArray(children) ? children.flat().filter(Boolean).length > 0 : !!children;
  return (
    <ComposerCard
      onSubmit={onSubmit}
      field={field}
      tools={tools}
      send={send}
      below={
        <>
          {pills.length > 0 && (
            <QuickActions pills={pills} onPick={onPick} disabled={pillsDisabled} label={pillsLabel} wrap />
          )}
          {chips && <div className="flex flex-wrap gap-1.5">{children}</div>}
        </>
      }
    />
  );
}

/** Voice settings (auto-send, read replies aloud) in a small popover next to the mic. */
export function VoiceMenu({
  buttonClassName,
  ...props
}: {
  auto: boolean;
  setAuto: (v: boolean) => void;
  read: boolean;
  setRead: (v: boolean) => void;
  canRead: boolean;
  /** Replaces the default button look. */
  buttonClassName?: string;
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
        className={buttonClassName ?? TOOL_BTN}
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
