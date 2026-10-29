"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { IconClose, IconSpark } from "../../lib/icons";
import { CopilotChat } from "./chat";
import type { PageRef } from "./use-chat";

export const COPILOT_ASK_EVENT = "copilot:ask";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The record the current page shows, so "this lease" means something to the copilot. */
export function pageRefFor(path: string): PageRef | undefined {
  const [pathname = "", search = ""] = path.split("?");
  const params = new URLSearchParams(search);
  // The Workspace keeps its selection in the URL: /work?kind=lease&id=… or /work?approval=…
  if (pathname === "/work") {
    const id = params.get("id") ?? "";
    const approval = params.get("approval") ?? "";
    if (params.get("kind") === "lease" && new RegExp(`^${UUID}$`, "i").test(id)) return { kind: "lease", id };
    if (new RegExp(`^${UUID}$`, "i").test(approval)) return { kind: "approval", id: approval };
    return undefined;
  }
  const m = new RegExp(`^/(leases|units)/(${UUID})(?:/|$)`, "i").exec(pathname);
  if (!m) return undefined;
  // /inbox/<id> now redirects to /work?approval=<id>, handled above.
  const kind = m[1] === "leases" ? "lease" : "unit";
  return { kind, id: m[2]! };
}

const noSubscribe = () => () => {};

/** "Ask" button in the top bar and the slide-over chat it opens. Hidden on Home, which hosts the full-page chat. */
export function CopilotPanel() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const path = search ? `${pathname}?${search}` : pathname;
  const [open, setOpen] = useState(false);
  // "Draft a reply" in the Workspace asks the copilot here. It only drafts; the user sends.
  const [ask, setAsk] = useState<{ id: number; text: string } | undefined>();
  useEffect(() => {
    const onAsk = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (!text) return;
      setAsk({ id: Date.now(), text });
      setOpen(true);
    };
    window.addEventListener(COPILOT_ASK_EVENT, onAsk);
    return () => window.removeEventListener(COPILOT_ASK_EVENT, onAsk);
  }, []);
  // The top bar's backdrop-filter makes it the containing block for fixed children, so the
  // panel is rendered into <body> (after mount, since there is no document on the server).
  const mounted = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const button = useRef<HTMLButtonElement>(null);
  const page = pageRefFor(path);

  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (pathname === "/") return null;
  return (
    <>
      <button
        ref={button}
        type="button"
        className="btn small cp-launch"
        aria-expanded={open}
        aria-controls="copilot-panel"
        onClick={() => setOpen((o) => !o)}
        title="Ask the copilot (Ctrl+J)"
      >
        <IconSpark size={16} />
        <span>Ask</span>
      </button>
      {mounted &&
        createPortal(
          <>
            {open && <div className="cp-scrim" onClick={close} aria-hidden="true" />}
            <aside
              id="copilot-panel"
              className="cp-panel"
              data-open={open}
              aria-label="Copilot"
              aria-hidden={!open}
              {...(open ? {} : { inert: true })}
            >
              <header className="cp-panel-head">
                <div>
                  <h2>Copilot</h2>
                  <span>{page ? `About this ${page.kind}` : "Ask about anything in the system"}</span>
                </div>
                <button type="button" className="btn ghost icon" onClick={close} aria-label="Close the copilot">
                  <IconClose size={17} />
                </button>
              </header>
              {/* A new conversation per page, so "this lease" always means the page you're on. */}
              <CopilotChat key={page?.id ?? "global"} page={page} autoFocus={open} ask={ask} />
            </aside>
          </>,
          document.body,
        )}
    </>
  );
}
