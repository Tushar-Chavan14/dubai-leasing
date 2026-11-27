"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * The avatar at the foot of the rail. Its popover holds what used to crowd the rail footer: the date, demo clock,
 * theme and sign out. The content comes from the server shell as children.
 */
export function AvatarMenu({
  initials,
  name,
  children,
  placement = "rail",
}: {
  initials: string;
  name: string;
  children: ReactNode;
  /** "rail" opens beside the rail's foot; "top" opens below a top-bar avatar, aligned right. */
  placement?: "rail" | "top";
}) {
  const top = placement === "top";
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
    <div ref={box} className={top ? "relative" : "relative mt-1.5"}>
      <button
        type="button"
        aria-label={`Account menu, ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={
          top
            ? "grid size-[38px] cursor-pointer place-items-center rounded-full border-0 bg-[linear-gradient(135deg,#f3a6c8,#b98cf0)] font-sans text-[13px] font-bold text-white shadow-[0_0_0_3px_var(--color-page),0_0_0_4px_var(--color-line)] transition-shadow hover:shadow-[0_0_0_3px_var(--color-page),0_0_0_5px_var(--color-primary)] aria-expanded:shadow-[0_0_0_3px_var(--color-page),0_0_0_5px_var(--color-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            : "grid size-9 cursor-pointer place-items-center rounded-full border-2 border-white/20 bg-[linear-gradient(135deg,#f5a3c7,#c9a2f2)] font-sans text-[12px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        }
      >
        {initials}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Account"
          className={`absolute z-50 grid gap-3 rounded-card border border-line bg-page p-4 font-sans text-sm text-ink ${
            top
              ? "right-0 top-[calc(100%+10px)] w-[280px] shadow-[0_24px_60px_-24px_rgb(16_30_80/0.35)]"
              : "bottom-0 left-[calc(100%+28px)] w-64 shadow-card"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
