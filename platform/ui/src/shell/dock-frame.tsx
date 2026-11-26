"use client";

import { SidebarSimpleIcon, SparkleIcon as IconSpark } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

/** Below this width the dock is an overlay sheet, closed by default. */
export const DOCK_MIN_WIDTH = 1200;

const dockKey = (screen: string) => `dock:${screen}`;

function readStored(screen: string): string | null {
  try {
    return localStorage.getItem(dockKey(screen));
  } catch {
    return null;
  }
}

/** Open or closed before the user chose on this screen: overlay starts closed; docked uses the remembered choice, else the default. */
export function initialOpen(o: {
  stored: string | null;
  overlay: boolean;
  screen: string;
  defaultOpen: (screen: string, width: number) => boolean;
  width: number;
}): boolean {
  if (o.overlay) return false;
  if (o.stored !== null) return o.stored === "1";
  return o.defaultOpen(o.screen, o.width);
}

export interface DockState {
  ready: boolean;
  overlay: boolean;
  open: boolean;
  show(v: boolean): void;
  focusComposer(): void;
}

/**
 * Open/closed state of the docked agent. Docked mode remembers the choice per screen (`dock:<screen>`); the overlay starts
 * closed. Ctrl/Cmd+K opens and focuses the composer, Ctrl/Cmd+J toggles, Escape closes the overlay.
 */
export function useDockState(opts: {
  screen: string;
  defaultOpen: (screen: string, width: number) => boolean;
}): DockState {
  const { screen, defaultOpen } = opts;
  const [ready, setReady] = useState(false);
  const [overlay, setOverlay] = useState(true);
  const [choice, setChoice] = useState<{ key: string; open: boolean } | null>(null);

  const choiceKey = `${screen}|${overlay}`;
  const open =
    choice?.key === choiceKey
      ? choice.open
      : initialOpen({
          stored: overlay ? null : readStored(screen),
          overlay,
          screen,
          defaultOpen,
          width: DOCK_MIN_WIDTH,
        });

  const latest = useRef({ overlay, screen });
  const openRef = useRef(open);
  useEffect(() => {
    latest.current = { overlay, screen };
    openRef.current = open;
  });

  /** Open or close; in docked mode the choice is remembered for this screen. */
  const show = useCallback((v: boolean) => {
    const { overlay: o, screen: s } = latest.current;
    setChoice({ key: `${s}|${o}`, open: v });
    if (!o) {
      try {
        localStorage.setItem(dockKey(s), v ? "1" : "0");
      } catch {}
    }
  }, []);
  const focusComposer = useCallback(() => {
    setTimeout(() => document.querySelector<HTMLTextAreaElement>("#agent-dock .cp-chat textarea")?.focus(), 60);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`);
    const sync = () => {
      setOverlay(!mq.matches);
      setReady(true);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = typeof e.key === "string" ? e.key.toLowerCase() : "";
      if (mod && k === "j") {
        e.preventDefault();
        const next = !openRef.current;
        show(next);
        if (next) focusComposer();
      } else if (mod && k === "k") {
        e.preventDefault();
        show(true);
        focusComposer();
      } else if (e.key === "Escape" && !e.defaultPrevented && openRef.current && latest.current.overlay) {
        show(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, focusComposer]);

  return { ready, overlay, open, show, focusComposer };
}

/** Round icon button used in the dock header. */
export const DOCK_ICON_BTN =
  "grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink";

/**
 * The agent panel frame: scrim (overlay), the collapsed 48px tab, and the 380px aside with its header. The chat body
 * is passed as children and must contain `.cp-chat textarea` so the composer can be focused.
 */
export function DockFrame({
  state,
  title,
  contextLabel,
  headerActions,
  banner,
  children,
}: {
  state: DockState;
  title: string;
  contextLabel: string;
  headerActions?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const { ready, overlay, open, show, focusComposer } = state;
  if (!ready) return null;
  return (
    <>
      {overlay && open && (
        <div
          className="fixed inset-0 z-40 bg-ink/20 motion-safe:animate-[cp-fade_200ms_ease-out]"
          onClick={() => show(false)}
          aria-hidden="true"
        />
      )}
      {!open && (
        // A slim column in the layout (not floating), so the tab never covers page content.
        <div className="[position:sticky] top-0 flex h-screen w-12 flex-none flex-col items-center border-l border-line bg-page pt-3.5">
          <button
            type="button"
            onClick={() => {
              show(true);
              focusComposer();
            }}
            aria-expanded="false"
            aria-controls="agent-dock"
            aria-label="Open the agent"
            title="Open the agent (Ctrl+K)"
            className="grid size-8 cursor-pointer place-items-center rounded-lg border-0 bg-accent text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <IconSpark size={17} aria-hidden />
          </button>
        </div>
      )}
      <aside
        id="agent-dock"
        aria-label={title}
        aria-hidden={!open}
        {...(open ? {} : { inert: true })}
        className={[
          "flex flex-col border-l border-line bg-page font-sans text-ink",
          overlay
            ? "fixed inset-y-0 right-0 z-[41] w-[min(420px,100vw)] transition-transform duration-200 ease-out motion-reduce:transition-none " +
              (open ? "translate-x-0" : "invisible translate-x-full")
            : open
              ? "[position:sticky] top-0 h-screen w-[380px] flex-none"
              : "hidden",
        ].join(" ")}
      >
        <header className="flex items-center gap-2 border-b border-line px-4 py-3.5">
          <span
            className="grid size-7 flex-none place-items-center rounded-lg bg-accent text-on-accent"
            aria-hidden="true"
          >
            <IconSpark size={16} />
          </span>
          <h2 className="m-0 text-base font-semibold tracking-tight">{title}</h2>
          <span
            className="ml-auto min-w-0 truncate rounded-full bg-raised px-2.5 py-1 text-xs text-muted"
            title={contextLabel}
          >
            {contextLabel}
          </span>
          {headerActions}
          <button
            type="button"
            className={DOCK_ICON_BTN}
            onClick={() => show(false)}
            aria-label="Hide the agent"
            title="Hide the agent"
          >
            <SidebarSimpleIcon size={18} aria-hidden />
          </button>
        </header>
        {banner}
        {children}
      </aside>
    </>
  );
}
