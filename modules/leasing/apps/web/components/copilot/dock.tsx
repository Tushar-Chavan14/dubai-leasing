"use client";

import { PlusCircleIcon, SidebarSimpleIcon, SparkleIcon as IconSpark } from "@phosphor-icons/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getHomeStarters, HOME_STARTERS_EVENT } from "../../lib/copilot/home-starters";
import { COPILOT_ASK_EVENT, COPILOT_PREFILL_EVENT } from "../../lib/copilot/events";
import { nextThreadFor, type DockThread } from "../../lib/copilot/thread-context";
import { DOCK_KEY, DOCK_MIN_WIDTH, dockDefault } from "../../lib/shell/dock";
import { type Screen, screenOf } from "../../lib/shell/nav";
import { CopilotChat } from "./chat";
import { HistoryMenu } from "./history-menu";
import { type ThreadDetail, toChat } from "./thread";
import type { ChatMessage, PageRef } from "./use-chat";

export { COPILOT_ASK_EVENT, COPILOT_PREFILL_EVENT };
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

function readStored(screen: Screen): boolean | null {
  try {
    const v = localStorage.getItem(DOCK_KEY(screen));
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
}

type Request = { id: number; text: string };
const KINDS = new Set<string>(["lease", "unit", "approval"]);
const samePage = (a: PageRef | null | undefined, b: PageRef | null | undefined) =>
  a?.kind === b?.kind && a?.id === b?.id;

/**
 * The staff copilot, docked on the right of the shell (380px). It is mounted once in the staff layout, so the
 * conversation and any answer still streaming survive moving between screens. Below 1200px it is an overlay sheet.
 */
export function CopilotDock({ today }: { today: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const page = pageRefFor(search ? `${pathname}?${search}` : pathname);
  const screen = screenOf(pathname);

  const [ready, setReady] = useState(false);
  const [overlay, setOverlay] = useState(true);
  const [choice, setChoice] = useState<{ key: string; open: boolean } | null>(null);
  const [thread, setThread] = useState<DockThread>({ id: null, context: null });
  // An unsent chat that was not started on purpose follows the page, so the first question on a lease is about it.
  const [follow, setFollow] = useState(true);
  const [chatKey, setChatKey] = useState(0);
  const [loaded, setLoaded] = useState<ChatMessage[] | undefined>();
  const [ask, setAsk] = useState<Request | undefined>();
  const [prefill, setPrefill] = useState<Request | undefined>();
  const [homeStarters, setHomeStarters] = useState<string[] | null>(null);
  useEffect(() => {
    const sync = () => setHomeStarters(getHomeStarters());
    sync();
    window.addEventListener(HOME_STARTERS_EVENT, sync);
    return () => window.removeEventListener(HOME_STARTERS_EVENT, sync);
  }, []);

  // Open or closed: this screen's choice, else (docked only) the remembered one, else the default. The overlay starts closed.
  const choiceKey = `${screen}|${overlay}`;
  const open =
    choice?.key === choiceKey
      ? choice.open
      : overlay
        ? false
        : (readStored(screen) ?? dockDefault(screen, DOCK_MIN_WIDTH));

  const context: PageRef | null = thread.id === null && follow ? (page ?? null) : thread.context;
  const latest = useRef({ page, context, thread, overlay, screen });
  const openRef = useRef(open);
  useEffect(() => {
    latest.current = { page, context, thread, overlay, screen };
    openRef.current = open;
  });

  /** Open or close; in docked mode the choice is remembered for this screen. */
  const show = useCallback(
    (v: boolean) => {
      const { overlay: o, screen: s } = latest.current;
      setChoice({ key: `${s}|${o}`, open: v });
      if (!o) {
        try {
          localStorage.setItem(DOCK_KEY(s), v ? "1" : "0");
        } catch {}
      }
    },
    [setChoice],
  );
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

  const startNew = useCallback(
    (ctx: PageRef | null) => {
      setThread({ id: null, context: ctx });
      setFollow(false);
      setLoaded(undefined);
      setAsk(undefined);
      setPrefill(undefined);
      setChatKey((k) => k + 1);
    },
    [setThread, setFollow, setLoaded, setAsk, setPrefill, setChatKey],
  );

  const onThread = useCallback(
    (id: string) => {
      setThread((t) => (t.id === id ? t : { id, context: latest.current.context }));
    },
    [setThread],
  );

  const openThread = useCallback(
    (d: ThreadDetail) => {
      const kind = d.contextKind;
      setThread({
        id: d.id,
        context: kind && KINDS.has(kind) && d.contextId ? { kind: kind as PageRef["kind"], id: d.contextId } : null,
      });
      setFollow(false);
      setAsk(undefined);
      setPrefill(undefined);
      setLoaded(toChat(d));
      setChatKey((k) => k + 1);
    },
    [setThread, setFollow, setAsk, setPrefill, setLoaded, setChatKey],
  );

  // Deep link `/?thread=<id>`: open that conversation once, on load.
  const threadParam = useRef(new URLSearchParams(search).get("thread"));
  useEffect(() => {
    const id = threadParam.current;
    if (!id || !new RegExp(`^${UUID}$`, "i").test(id)) return;
    let live = true;
    void fetch(`/api/copilot/threads/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ThreadDetail>) : null))
      .then((d) => {
        if (!live || !d) return;
        threadParam.current = null;
        openThread(d);
        show(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [openThread, show]);

  // Ask AI buttons and "Draft a reply". They open the dock; a question sent by "ask" is only ever a draft request.
  useEffect(() => {
    const handle = (set: typeof setAsk, fallbackToPage: boolean) => (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; page?: PageRef }>).detail;
      if (!d?.text) return;
      const { page: here, context: ctx, thread: t } = latest.current;
      const target = d.page ?? (fallbackToPage ? here : undefined);
      const next = nextThreadFor({ id: t.id, context: ctx }, target, "ask");
      if (next.action === "new") startNew(next.context);
      show(true);
      focusComposer();
      set({ id: Date.now(), text: d.text });
    };
    const onAsk = handle(setAsk, true);
    const onPrefill = handle(setPrefill, false);
    window.addEventListener(COPILOT_ASK_EVENT, onAsk);
    window.addEventListener(COPILOT_PREFILL_EVENT, onPrefill);
    return () => {
      window.removeEventListener(COPILOT_ASK_EVENT, onAsk);
      window.removeEventListener(COPILOT_PREFILL_EVENT, onPrefill);
    };
  }, [show, startNew, focusComposer]);

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
  const differs = !!page && !samePage(context, page);
  const label = context ? `About ${context.kind}` : "Anything";
  const starters = pathname.startsWith("/settings/kyc")
    ? "kyc"
    : pathname.startsWith("/settings")
      ? "settings"
      : undefined;

  // Home's ready-made questions replace the generic starters in the empty state (only on Home itself).
  const onHome = pathname === "/" && !context && homeStarters && homeStarters.length > 0;

  if (!ready) return null;
  const iconBtn =
    "grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink";
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
        aria-label="Agent"
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
          <h2 className="m-0 text-base font-semibold tracking-tight">Agent</h2>
          <span
            className="ml-auto min-w-0 truncate rounded-full bg-raised px-2.5 py-1 text-xs text-muted"
            title={label}
          >
            {label}
          </span>
          <button
            type="button"
            className={iconBtn}
            onClick={() => startNew(nextThreadFor({ id: thread.id, context }, page, "new").context)}
            aria-label="New chat"
            title="Start a new conversation"
          >
            <PlusCircleIcon size={18} aria-hidden />
          </button>
          <HistoryMenu currentId={thread.id} today={today} onPick={openThread} />
          <button
            type="button"
            className={iconBtn}
            onClick={() => show(false)}
            aria-label="Hide the agent"
            title="Hide the agent"
          >
            <SidebarSimpleIcon size={18} aria-hidden />
          </button>
        </header>
        {differs && page && (
          <div className="flex items-center gap-2 border-b border-line bg-raised px-4 py-2 text-sm">
            <span className="min-w-0 flex-1">You&apos;re on a {page.kind}.</span>
            <button
              type="button"
              className="h-8 cursor-pointer rounded-full border border-line bg-transparent px-3 font-sans text-sm font-semibold text-ink"
              onClick={() => startNew(nextThreadFor({ id: thread.id, context }, page, "new").context)}
            >
              New chat about it
            </button>
          </div>
        )}
        <CopilotChat
          key={chatKey}
          layout="dock"
          page={context ?? undefined}
          {...(thread.id && loaded ? { threadId: thread.id, initial: loaded } : {})}
          onThread={onThread}
          ask={ask}
          prefill={prefill}
          starters={starters}
          {...(onHome ? { heading: "What needs your attention today?", suggestions: homeStarters ?? [] } : {})}
        />
      </aside>
    </>
  );
}
