"use client";

import { usePathname } from "next/navigation";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { Chat } from "../customer-chat/chat";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The floating "Chat with us" button and its modal. The chat stays mounted once opened, so a reply in flight survives closing. */
export function ChatLauncher() {
  const pathname = usePathname();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  // Following a link inside the chat (any navigation) closes the modal.
  if (openAt !== null && openAt !== pathname) setOpenAt(null);
  const [started, setStarted] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpenAt(null);
    opener.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    // The page behind the modal is inert: no focus, clicks or screen-reader reach.
    const behind = [...document.querySelectorAll<HTMLElement>(".pub > header, .pub > main, .pub > footer")];
    for (const el of behind) el.inert = true;
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onEsc);
    dialog.current?.querySelector<HTMLElement>("textarea")?.focus();
    return () => {
      document.body.style.overflow = "";
      for (const el of behind) el.inert = false;
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, close]);

  if (pathname === "/chat") return null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        ref={opener}
        type="button"
        className="pub-fab"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setStarted(true);
          setOpenAt(pathname);
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 5.5h12v7H9.5L6 15.5v-3H4Z" />
        </svg>
        Chat with us
      </button>
      {started && (
        <div className="pub-modal-scrim" hidden={!open} onClick={close} role="presentation">
          <div
            ref={dialog}
            className="pub-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pub-chat-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onKey}
          >
            <header>
              <h2 id="pub-chat-title">Chat with us</h2>
              <button type="button" className="btn ghost small" onClick={close}>
                Close
              </button>
            </header>
            <Chat onNavigate={close} inputId="cc-input-modal" />
          </div>
        </div>
      )}
    </>
  );
}
