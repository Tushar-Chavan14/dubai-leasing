"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type Dispatch } from "react";
import { P_INPUT, SMALL_GHOST } from "../../../../components/ui/portal";
import {
  dedupeRects,
  MARK_REFUSAL_FALLBACK,
  type Mark,
  type MarkRect,
  type MarksAction,
  normaliseQuote,
  rectsRelativeTo,
  spaceAfter,
} from "../../../../lib/mark-changes";

/** What the viewer needs to let the signer mark words. State lives in MarkChanges. */
export interface Marking {
  marks: Mark[];
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  dispatch: Dispatch<MarksAction>;
  /** A page came back without a text layer: the old request form is offered instead. */
  onNoText: () => void;
}

interface PageText {
  width: number;
  height: number;
  items: { str: string; x: number; y: number; w: number; h: number }[];
}

interface Pending {
  quote: string;
  label: string | null;
  rects: MarkRect[];
}

const MAX_QUOTE = 500;
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

/** Where a note box opens: under the last box of the selection, or the bottom sheet on phones. */
function anchorStyle(rects: MarkRect[]): CSSProperties {
  const last = rects[rects.length - 1];
  if (!last) return {};
  return {
    "--t": `calc(${pct(last.y + last.h)} + 8px)`,
    "--l": `clamp(0px, ${pct(last.x)}, calc(100% - 20rem))`,
  } as CSSProperties;
}

const POP =
  "fixed inset-x-0 bottom-0 z-30 grid gap-2 rounded-t-xl border border-[#d4a000] bg-page p-4 text-sm text-ink shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-(--t) sm:left-(--l) sm:w-80 sm:rounded-lg sm:p-3";

function NoteBox({
  title,
  quote,
  initial,
  rects,
  onSave,
  onCancel,
  onRemove,
}: {
  title: string;
  quote: string;
  initial: string;
  rects: MarkRect[];
  onSave: (note: string) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const [note, setNote] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const ok = note.trim().length > 0;
  return (
    <div
      role="dialog"
      aria-label={title}
      className={POP}
      style={anchorStyle(rects)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <p className="m-0 font-semibold">{title}</p>
      <p className="m-0 line-clamp-3 italic text-muted">&ldquo;{quote}&rdquo;</p>
      <label className="grid gap-1">
        <span className="text-[13px]">What would you like instead?</span>
        <textarea
          ref={ref}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          rows={3}
          className={P_INPUT}
        />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        {onRemove && (
          <button type="button" className={SMALL_GHOST} onClick={onRemove}>
            Remove mark
          </button>
        )}
        <button type="button" className={SMALL_GHOST} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={SMALL_GHOST} disabled={!ok} onClick={() => onSave(note.trim())}>
          Save note
        </button>
      </div>
    </div>
  );
}

/**
 * Sits over one page image: a transparent text layer the signer can select from, the highlights of the marks already
 * made on this page, and the note box. Selected words are checked with the engine (anchor) before a note box opens.
 */
export function MarkLayer({ token, n, marking }: { token: string; n: number; marking: Marking }) {
  const { marks, editingId, setEditingId, dispatch, onNoText } = marking;
  const box = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<PageText | null>(null);
  const [scale, setScale] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [refusal, setRefusal] = useState<{ text: string; rects: MarkRect[] } | null>(null);
  const mouseDown = useRef(false);
  const lastQuote = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setLoadFailed(false);
    const load = (again: boolean) => {
      fetch(`/t/${encodeURIComponent(token)}/contract/pages/${n}/text`, { cache: "no-store" })
        .then(async (r) => {
          if (!live) return;
          if (!r.ok) throw new Error(String(r.status));
          const d = (await r.json()) as PageText;
          if (!live) return;
          // Only a successful answer with no words means the page has no text layer.
          if (d.items.length) setText(d);
          else onNoText();
        })
        .catch(() => {
          if (!live) return;
          // A rate limit or a dropped connection: one retry after 5 s (like the page image), then a retry button.
          if (again) retry = setTimeout(() => load(false), 5000);
          else setLoadFailed(true);
        });
    };
    load(true);
    return () => {
      live = false;
      clearTimeout(retry);
    };
    // onNoText is stable enough: it only flips a flag in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, n, attempt]);

  // Spans are sized in pixels from the rendered width, so the text stays under the words when the window resizes.
  useEffect(() => {
    const el = box.current;
    if (!el || !text) return;
    const update = () => setScale(el.clientWidth / text.width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  const handle = useCallback(async () => {
    const el = box.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    const quote = normaliseQuote(sel.toString());
    if (quote.length < 2 || quote === lastQuote.current) return;
    lastQuote.current = quote;
    const b = el.getBoundingClientRect();
    const rects = dedupeRects(
      rectsRelativeTo(Array.from(range.getClientRects()), b).filter((r) => !(r.w > 0.98 && r.h > 0.9)),
    );
    if (!rects.length) return;
    setPending(null);
    setRefusal(null);
    setEditingId(null);
    if (quote.length > MAX_QUOTE) {
      setRefusal({ text: `Select a shorter piece of text (up to ${MAX_QUOTE} characters).`, rects });
      return;
    }
    const res = await fetch(`/t/${encodeURIComponent(token)}/change-requests/anchor`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: n, quote }),
    }).catch(() => null);
    const d = res?.ok
      ? ((await res.json().catch(() => null)) as { label: string | null; refused: string | null } | null)
      : null;
    if (!d) {
      lastQuote.current = "";
      setRefusal({ text: "We couldn't check that selection. Please try again.", rects });
      return;
    }
    if (d.refused) {
      setRefusal({ text: d.refused || MARK_REFUSAL_FALLBACK, rects });
      return;
    }
    sel.removeAllRanges();
    setPending({ quote, label: d.label, rects });
  }, [token, n, setEditingId]);

  // Touch screens have no mouseup that ends a selection: follow selectionchange once it settles.
  useEffect(() => {
    const onChange = () => {
      clearTimeout(timer.current);
      if (mouseDown.current) return;
      timer.current = setTimeout(() => void handle(), 600);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      clearTimeout(timer.current);
    };
  }, [handle]);

  const close = () => {
    setPending(null);
    setRefusal(null);
    setEditingId(null);
    lastQuote.current = "";
  };

  const here = marks.filter((m) => m.page === n);
  const editing = here.find((m) => m.id === editingId);

  return (
    <div ref={box} className="absolute inset-0">
      {loadFailed && (
        <div
          role="alert"
          className="absolute inset-x-0 top-2 z-10 mx-auto flex w-fit items-center gap-2 rounded-lg bg-page p-2 text-xs text-ink shadow"
        >
          <span>Couldn&apos;t load the selectable text, try again.</span>
          <button type="button" className={SMALL_GHOST} onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </button>
        </div>
      )}
      {text && scale > 0 && (
        <div
          data-text-layer={n}
          className="absolute inset-0 cursor-text overflow-hidden"
          style={{ userSelect: "text", WebkitUserSelect: "text" }}
          onMouseDown={() => {
            mouseDown.current = true;
          }}
          onMouseUp={() => {
            mouseDown.current = false;
            clearTimeout(timer.current);
            void handle();
          }}
        >
          {text.items.map((it, i) => (
            <span
              key={i}
              className="absolute whitespace-pre text-transparent selection:bg-[#ffe58a]/70 selection:text-transparent"
              style={{
                left: it.x * scale,
                top: it.y * scale,
                width: it.w * scale,
                height: it.h * scale,
                fontSize: it.h * scale,
                lineHeight: `${it.h * scale}px`,
              }}
            >
              {it.str}
              {spaceAfter(text.items, i) ? " " : ""}
            </span>
          ))}
        </div>
      )}
      {here.map((m) => (
        <div key={m.id} className="pointer-events-none absolute inset-0">
          {m.rects.map((r, i) => (
            <div
              key={i}
              className="absolute border-b-2 border-[#d4a000] bg-[#ffe58a]/60"
              style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
            />
          ))}
          {m.rects.length > 0 && (
            <button
              type="button"
              data-mark={m.id}
              aria-label={`Change ${m.n}: ${m.quote}. Edit note`}
              onClick={() => setEditingId(m.id)}
              className="pointer-events-auto absolute grid size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 bg-[#d4a000] text-xs font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              style={{
                left: pct(m.rects[m.rects.length - 1]!.x + m.rects[m.rects.length - 1]!.w),
                top: pct(m.rects[0]!.y),
              }}
            >
              {m.n}
            </button>
          )}
        </div>
      ))}
      {pending && (
        <>
          {pending.rects.map((r, i) => (
            <div
              key={i}
              className="pointer-events-none absolute border-b-2 border-[#d4a000] bg-[#ffe58a]/40"
              style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
            />
          ))}
          <NoteBox
            title="Your note on this change"
            quote={pending.quote}
            initial=""
            rects={pending.rects}
            onCancel={close}
            onSave={(note) => {
              dispatch({
                type: "add",
                mark: {
                  id: crypto.randomUUID(),
                  page: n,
                  quote: pending.quote,
                  note,
                  label: pending.label,
                  rects: pending.rects,
                },
              });
              close();
            }}
          />
        </>
      )}
      {editing && (
        <NoteBox
          title={`Your note on change ${editing.n}`}
          quote={editing.quote}
          initial={editing.note}
          rects={editing.rects}
          onCancel={close}
          onRemove={() => {
            dispatch({ type: "remove", id: editing.id });
            close();
          }}
          onSave={(note) => {
            dispatch({ type: "edit", id: editing.id, note });
            close();
          }}
        />
      )}
      {refusal && (
        <div role="alert" className={POP} style={anchorStyle(refusal.rects)}>
          <p className="m-0">{refusal.text}</p>
          <div className="flex justify-end">
            <button type="button" className={SMALL_GHOST} onClick={close}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
