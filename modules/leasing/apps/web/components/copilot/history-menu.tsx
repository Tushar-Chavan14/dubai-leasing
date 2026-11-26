"use client";

import { ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { dateTime, relativeTime } from "../../lib/format";
import type { ThreadDetail, ThreadRow } from "./thread";

/** Recent conversations of the signed-in user. Picking one loads it through the web app's proxy routes. */
export function HistoryMenu({
  currentId,
  today,
  onPick,
}: {
  currentId: string | null;
  today: string;
  onPick: (thread: ThreadDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ThreadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/copilot/threads", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("Could not load your conversations.");
        return (await r.json()) as ThreadRow[];
      })
      .then((d) => live && setRows(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load your conversations."));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); // the dock leaves Escape alone when it was already handled
      setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const pick = async (id: string) => {
    setLoading(id);
    setError(null);
    try {
      const r = await fetch(`/api/copilot/threads/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!r.ok) throw new Error("Could not open that conversation.");
      onPick((await r.json()) as ThreadDetail);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that conversation.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
        aria-label="History"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          setError(null);
          setOpen((o) => !o);
        }}
        title="Earlier conversations"
      >
        <ClockCounterClockwiseIcon size={18} aria-hidden />
      </button>
      {open && (
        <div
          role="region"
          aria-label="Earlier conversations"
          className="absolute right-0 top-full z-10 mt-1 w-72 max-w-[85vw] rounded-card border border-line bg-page p-1"
        >
          {error && (
            <p role="alert" className="m-0 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {!rows && !error && <p className="m-0 px-3 py-2 text-sm text-muted">Loading</p>}
          {rows && rows.length === 0 && (
            <p className="m-0 px-3 py-2 text-sm text-muted">No earlier conversations yet.</p>
          )}
          {rows && rows.length > 0 && (
            <ul className="m-0 flex max-h-80 list-none flex-col overflow-y-auto p-0">
              {rows.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={loading !== null}
                    aria-current={t.id === currentId ? "true" : undefined}
                    onClick={() => void pick(t.id)}
                    className="grid w-full gap-0.5 rounded-input bg-transparent px-3 py-2 text-left font-sans text-ink hover:bg-raised aria-[current=true]:bg-accent aria-[current=true]:text-on-accent"
                  >
                    <span className="truncate text-sm font-medium">{t.title}</span>
                    <span className="text-xs opacity-70">
                      {t.contextKind ? `About ${t.contextKind}` : "Anything"}
                      {" · "}
                      <time dateTime={t.createdAt}>
                        {today ? relativeTime(today, t.createdAt) : dateTime(t.createdAt)}
                      </time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
