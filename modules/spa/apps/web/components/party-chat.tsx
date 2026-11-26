"use client";

import { Button } from "@platform/ui/button";
import { FIELD, INPUT, LABEL } from "@platform/ui/form";
import { useState } from "react";

interface Line {
  who: "you" | "assistant";
  text: string;
}

const error = (status: number): string =>
  status === 429
    ? "You have sent a lot of messages. Please try again in a while, or ask your agent."
    : status === 404
      ? "This link is no longer valid, so the assistant cannot answer. Please ask your agent."
      : "The assistant isn't available right now. Please ask your agent.";

/** "Ask a question" on the portal pages (S24, S61): the party assistant, through this site's own route. */
export function PartyChat({ token }: { token: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setLines((l) => [...l, { who: "you", text }]);
    setDraft("");
    let reply: string;
    try {
      const res = await fetch(`/b/${token}/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      reply = res.ok ? String(((await res.json()) as { reply?: string }).reply ?? error(500)) : error(res.status);
    } catch {
      reply = error(0);
    }
    setLines((l) => [...l, { who: "assistant", text: reply }]);
    setBusy(false);
  };
  return (
    <section aria-labelledby="party-chat-title" className="grid gap-3 rounded-card border border-line bg-raised p-4">
      <h2 id="party-chat-title" className="m-0 text-[15px] font-semibold text-ink">
        Ask a question
      </h2>
      <p className="m-0 text-sm text-muted">
        The assistant answers about your own purchase only. Please do not type passport or ID numbers here.
      </p>
      <div role="log" aria-live="polite" aria-label="Conversation" className="grid max-h-80 gap-2 overflow-y-auto">
        {lines.map((l, i) => (
          <p
            key={i}
            className={`m-0 rounded-xl px-3 py-2 text-sm text-ink ${l.who === "you" ? "bg-page" : "border border-line"}`}
          >
            <span className="mr-1 text-xs font-semibold text-muted">{l.who === "you" ? "You" : "Assistant"}</span>
            {l.text}
          </p>
        ))}
      </div>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className={FIELD}>
          <label htmlFor="party-chat-text" className={LABEL}>
            Your question
          </label>
          <textarea
            id="party-chat-text"
            rows={2}
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <Button variant="primary" type="submit" disabled={busy || !draft.trim()}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </section>
  );
}
