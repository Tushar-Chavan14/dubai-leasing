"use client";

import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from "react";
import { VoiceOptions } from "../voice/voice-controls";
import { QuickActions } from "./quick-actions-row";
import type { Pill } from "./quick-actions.ts";

export const TOOL_BTN =
  "inline-flex h-[34px] min-w-[34px] cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-transparent px-1.5 text-muted shadow-none hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 data-[recording]:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink";
export const SEND_BTN =
  "grid size-[34px] cursor-pointer place-items-center rounded-full border-0 bg-primary p-0 text-on-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
/** The text field inside the composer card: bare, so the card draws the border and focus. */
export const FIELD_BARE =
  "max-h-36 min-h-6 w-full resize-none !rounded-none !border-0 !bg-transparent !p-0 font-sans text-sm leading-normal text-ink !shadow-none !outline-none [field-sizing:content] placeholder:text-muted focus:!shadow-none focus-visible:!shadow-none";

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
    <div className="grid min-w-0 gap-2.5 px-3 pb-1 pt-2">
      <form
        onSubmit={onSubmit}
        className="rounded-[18px] border border-line bg-page py-2.5 pl-4 pr-2.5 focus-within:border-ink"
      >
        {field}
        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex items-center gap-0.5 [&_.vm-pop]:!end-auto [&_.vm-pop]:!start-0">{tools}</div>
          {send}
        </div>
      </form>
      {pills.length > 0 && (
        <QuickActions pills={pills} onPick={onPick} disabled={pillsDisabled} label={pillsLabel} wrap />
      )}
      {chips && <div className="flex flex-wrap gap-1.5">{children}</div>}
    </div>
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
