"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Pill } from "./quick-actions.ts";

/**
 * A single row of pills that scrolls sideways when it doesn't fit (hidden scrollbar, a soft fade
 * on the right edge while more is hidden). Plain buttons: Tab and Enter work, and the row follows focus.
 */
export function QuickActions({
  pills,
  onPick,
  disabled,
  label,
  wrap,
}: {
  pills: readonly Pill[];
  onPick: (p: Pill) => void;
  disabled?: boolean | undefined;
  label: string;
  /** Wrap onto several lines instead of scrolling (the narrow staff dock). */
  wrap?: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(false);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => setFade(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [pills]);
  // Wrapped mode shows at most two rows: pills that would start a third row are hidden, never clipped or scrolled.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || !wrap) return;
    const fit = () => {
      const items = [...el.querySelectorAll<HTMLElement>("button")];
      for (const b of items) b.hidden = false;
      const tops = [...new Set(items.map((b) => b.offsetTop))].toSorted((a, b) => a - b);
      const limit = tops[1];
      if (limit === undefined) return;
      for (const b of items) if (b.offsetTop > limit) b.hidden = true;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pills, wrap]);
  return (
    <div
      ref={row}
      className="qa-row"
      role="group"
      aria-label={label}
      data-fade={!wrap && fade ? true : undefined}
      data-wrap={wrap || undefined}
    >
      {pills.map((p) => (
        <button key={p.key} type="button" className="qa-pill" dir="auto" disabled={disabled} onClick={() => onPick(p)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
