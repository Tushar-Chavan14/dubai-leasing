"use client";

import { CaretDownIcon } from "@phosphor-icons/react";
import { useState } from "react";

/**
 * Collapses the record card it sits in (UI rule: every record section can be folded to its title). It only shows on
 * the outermost cards of a `.record-cards` pane (globals.css); elsewhere it is hidden and does nothing.
 */
export function SectionToggle({ headingId }: { headingId: string }) {
  const [open, setOpen] = useState(true);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={open ? "Collapse" : "Expand"}
      aria-describedby={headingId}
      title={open ? "Collapse" : "Expand"}
      onClick={(e) => {
        const card = e.currentTarget.closest<HTMLElement>("[data-section]");
        if (!card) return;
        const next = !open;
        setOpen(next);
        if (next) delete card.dataset.collapsed;
        else card.dataset.collapsed = "";
      }}
      className="section-toggle size-8 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
    >
      <CaretDownIcon
        size={15}
        weight="bold"
        aria-hidden
        className={`transition-transform ${open ? "" : "-rotate-90"}`}
      />
    </button>
  );
}
