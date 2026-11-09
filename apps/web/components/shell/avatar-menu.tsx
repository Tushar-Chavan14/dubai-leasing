"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * The avatar at the foot of the rail. Its popover holds what used to crowd the rail footer: the date, demo clock,
 * theme and sign out. The content comes from the server shell as children.
 */
export function AvatarMenu({ initials, name, children }: { initials: string; name: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative mt-1.5">
      <button
        type="button"
        aria-label={`Account menu, ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="grid size-8 cursor-pointer place-items-center rounded-full border border-line bg-raised font-sans text-[11px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        {initials}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Account"
          className="absolute bottom-0 left-[calc(100%+28px)] z-50 grid w-64 gap-3 rounded-card border border-line bg-page p-4 font-sans text-sm text-ink"
        >
          {children}
        </div>
      )}
    </div>
  );
}
