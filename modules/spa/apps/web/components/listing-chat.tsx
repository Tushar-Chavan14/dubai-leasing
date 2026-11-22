"use client";

import { Button } from "@platform/ui/button";
import { FIELD, HINT, INPUT, LABEL } from "@platform/ui/form";
import { useRef, useState } from "react";
import { CHAT_MAX_CHARS, type ChatLine, postChat, segments } from "../lib/listing-chat";

interface BoxProps {
  lines: ChatLine[];
  draft: string;
  consent: boolean;
  busy: boolean;
  onDraft: (v: string) => void;
  onConsent: (v: boolean) => void;
  onSend: () => void;
}

/** The chat's markup (design.md §7.5), without state, so it renders the same on the server. */
export function ChatBox({ lines, draft, consent, busy, onDraft, onConsent, onSend }: BoxProps) {
  return (
    <section aria-labelledby="chat-title" className="grid gap-3 rounded-card border border-line bg-raised p-4">
      <header className="grid gap-1">
        <h2 id="chat-title" className="m-0 text-[15px] font-semibold text-ink">
          Ask about this property
        </h2>
        <p className="m-0 text-sm text-muted">
          The assistant answers from this listing only and can send your enquiry to the agent. Please do not type
          passport or ID numbers here.
        </p>
      </header>
      <div role="log" aria-live="polite" aria-label="Conversation" className="grid max-h-80 gap-2 overflow-y-auto">
        {lines.map((l, i) => (
          <p
            key={i}
            className={`m-0 rounded-xl px-3 py-2 text-sm text-ink ${l.who === "visitor" ? "bg-page" : "border border-line"}`}
          >
            <span className="mr-1 text-xs font-semibold text-muted">{l.who === "visitor" ? "You" : "Assistant"}</span>
            {segments(l.text, l.unverified ?? []).map((s, j) =>
              s.unverified ? (
                <mark
                  key={j}
                  className="rounded bg-transparent text-warning underline decoration-dotted"
                  title="Not confirmed by the listing"
                >
                  {s.text}
                  <span className="sr-only"> (Not confirmed by the listing)</span>
                </mark>
              ) : (
                <span key={j}>{s.text}</span>
              ),
            )}
          </p>
        ))}
      </div>
      {lines.some((l) => l.unverified?.length) ? (
        <p className="m-0 text-xs text-muted">
          Values underlined are not confirmed by the listing. Ask the agent before relying on them.
        </p>
      ) : null}
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <div className={FIELD}>
          <label htmlFor="chat-text" className={LABEL}>
            Your message
          </label>
          <textarea
            id="chat-text"
            name="text"
            rows={3}
            maxLength={CHAT_MAX_CHARS}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            className={INPUT}
          />
        </div>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={consent} onChange={(e) => onConsent(e.target.checked)} className="mt-1" />
          <span>
            I agree the agent may contact me by email about my enquiry.
            <span className={`${HINT} block`}>
              Tick this only if you want the agent to receive your name, email and messages.
            </span>
          </span>
        </label>
        <div>
          <Button variant="primary" type="submit" disabled={busy || !draft.trim()}>
            {busy ? "Sending…" : "Send message"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** The listing page chat (S24, S61). The conversation lives in this tab only; the engine stores it, masked. */
export function ListingChat({ listingRef }: { listingRef: string }) {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  // A random id for this tab, so two visitors behind one address keep two conversations.
  const session = useRef<string | null>(null);
  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    session.current ??= crypto.randomUUID();
    setBusy(true);
    setLines((l) => [...l, { who: "visitor", text }]);
    setDraft("");
    const answer = await postChat(listingRef, { text, consent, session: session.current });
    setLines((l) => [...l, answer]);
    setBusy(false);
  };
  return (
    <ChatBox
      lines={lines}
      draft={draft}
      consent={consent}
      busy={busy}
      onDraft={setDraft}
      onConsent={setConsent}
      onSend={send}
    />
  );
}
