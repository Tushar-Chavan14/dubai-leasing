"use client";

import { ArrowsOutSimpleIcon, ChatCircleTextIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CustomerChat } from "../customer-chat/customer-chat";

/**
 * The floating "Ask about a home" pill on the customer pages. It opens the chat in a small panel above it
 * (kept mounted once opened, so the conversation survives closing); "Open full page" goes to /customer/chat.
 */
export function ChatLauncher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Leaving the page (a card's "View details") closes the panel.
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  if (pathname === "/customer/chat") return null;
  return (
    <>
      {mounted && (
        <section
          aria-label="Ask about a home"
          hidden={!open}
          className="fixed inset-x-3 z-40 flex h-[min(560px,calc(100dvh-132px))] flex-col overflow-hidden rounded-[22px] border border-line bg-page shadow-[0_18px_50px_rgb(0_0_0/0.18)] sm:inset-x-auto sm:right-5 sm:w-[390px]"
          style={{ bottom: "calc(76px + env(safe-area-inset-bottom))" }}
        >
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className="grid size-[26px] flex-none place-items-center rounded-lg bg-accent text-on-accent"
                aria-hidden="true"
              >
                <SparkleIcon size={14} weight="bold" />
              </span>
              <div className="min-w-0">
                <h2 className="m-0 text-[15px] leading-tight font-semibold tracking-tight">Ask about a home</h2>
                <p className="m-0 truncate text-[11.5px] text-muted">Replies in seconds</p>
              </div>
            </div>
            <div className="flex flex-none items-center gap-1">
              <Link
                href="/customer/chat"
                aria-label="Open the chat as a full page"
                title="Open full page"
                className="grid size-8 place-items-center rounded-full text-muted! hover:bg-raised focus-visible:outline-2 focus-visible:outline-ink"
              >
                <ArrowsOutSimpleIcon size={16} aria-hidden="true" />
              </Link>
              <button
                type="button"
                aria-label="Close the chat"
                title="Close"
                onClick={() => setOpen(false)}
                className="grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted hover:bg-raised focus-visible:outline-2 focus-visible:outline-ink"
              >
                <XIcon size={16} aria-hidden="true" />
              </button>
            </div>
          </header>
          <div className="min-h-0 flex-1">
            <CustomerChat inputId="cc-input-pop" onNavigate={() => setOpen(false)} compact />
          </div>
        </section>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setMounted(true);
          setOpen((o) => !o);
        }}
        className="fixed right-4 z-40 inline-flex h-12 cursor-pointer items-center gap-2.5 rounded-full border-0 bg-primary py-0 pr-5 pl-4 font-sans text-[15px] font-medium text-on-primary shadow-[0_10px_30px_rgb(0_0_0/0.22)] transition-transform duration-150 ease-out hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:right-5"
        style={{ bottom: "calc(16px + env(safe-area-inset-bottom))" }}
      >
        {open ? <XIcon size={20} aria-hidden="true" /> : <ChatCircleTextIcon size={20} aria-hidden="true" />}
        {open ? "Close" : "Ask about a home"}
      </button>
    </>
  );
}
