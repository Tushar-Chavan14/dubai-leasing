"use client";

import { useEffect, useRef, useState } from "react";
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
}: {
  pills: readonly Pill[];
  onPick: (p: Pill) => void;
  disabled?: boolean | undefined;
  label: string;
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
  return (
    <div ref={row} className="qa-row" role="group" aria-label={label} data-fade={fade || undefined}>
      {pills.map((p) => (
        <button key={p.key} type="button" className="qa-pill" dir="auto" disabled={disabled} onClick={() => onPick(p)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
