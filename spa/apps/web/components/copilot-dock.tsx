"use client";

import { EmptyState } from "@platform/ui/empty-state";
import { useEffect } from "react";

/** The copilot dock (design.md §2), docked on the right. A placeholder until the SPA copilot exists (P9). */
export function CopilotDock() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        document.getElementById("copilot-dock")?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <aside
      id="copilot-dock"
      tabIndex={-1}
      aria-label="Copilot"
      className="sticky top-0 hidden h-screen w-[340px] flex-none flex-col gap-3 border-l border-line bg-page p-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink xl:flex"
    >
      <h2 className="m-0 font-sans text-[15px] font-semibold text-ink">Copilot</h2>
      <EmptyState title="Not set up yet" body="The copilot will answer questions about deals and listings here." />
    </aside>
  );
}
