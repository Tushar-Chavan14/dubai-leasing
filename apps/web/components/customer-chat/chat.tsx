"use client";

import { type FormEvent, type KeyboardEvent, useState } from "react";
import { UnitCardView } from "./unit-card";
import { useChat } from "./use-chat";

export function Chat({
  onNavigate,
  inputId = "cc-input",
}: {
  onNavigate?: (() => void) | undefined;
  inputId?: string;
}) {
  const { bubbles, loading, loadFailed, reload, typing, notice, sendText, press, retry } = useChat();
  const [draft, setDraft] = useState("");

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || typing) return;
    sendText(text);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) submit(e);
  };

  // Buttons and cards stay live only on the latest bot message.
  const lastBot = bubbles.findLastIndex((b) => b.role === "bot");

  return (
    <div className="cc">
      <div className="cc-scroll" role="log" aria-live="polite">
        <div className="cc-thread">
          {loading && <p className="muted cc-center">Loading…</p>}
          {loadFailed && (
            <p className="muted cc-center">
              Couldn&apos;t load your chat.{" "}
              <button type="button" className="btn small" onClick={reload}>
                Retry
              </button>
            </p>
          )}
          {!loading && !loadFailed && bubbles.length === 0 && (
            <>
              <p className="muted cc-center">Tell us what kind of home you&apos;re looking for, or ask a question.</p>
              <div className="cc-buttons">
                <button
                  type="button"
                  className="cc-chip"
                  disabled={typing}
                  onClick={() => press({ label: "Find a home", data: "units" })}
                >
                  Find a home
                </button>
              </div>
            </>
          )}
          {bubbles.map((b, i) => (
            <div key={b.key} className="cc-row" data-role={b.role}>
              <div className="cc-bubble" dir="auto" data-failed={b.status === "failed" || undefined}>
                {b.text}
              </div>
              {b.status === "failed" && (
                <button type="button" className="btn small" onClick={() => retry(b.key)}>
                  Not sent. Retry
                </button>
              )}
              {b.reply?.cards?.length ? (
                <div className="cc-cards">
                  {b.reply.cards.map((c) => (
                    <UnitCardView
                      key={c.unitId}
                      card={c}
                      disabled={i !== lastBot || typing}
                      onNavigate={onNavigate}
                      onBook={() => press({ label: "Book a viewing", data: `unit:${c.unitId}` })}
                    />
                  ))}
                </div>
              ) : null}
              {b.reply?.buttons?.length ? (
                <div className="cc-buttons">
                  {b.reply.buttons.map((btn) => (
                    <button
                      key={btn.data}
                      type="button"
                      className="cc-chip"
                      dir="auto"
                      disabled={i !== lastBot || typing}
                      onClick={() => press(btn)}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {typing && (
            <div className="cc-row" data-role="bot">
              <div className="cc-bubble cc-typing" aria-label="Assistant is typing" role="status">
                <i />
                <i />
                <i />
              </div>
            </div>
          )}
          <div ref={(el) => el?.scrollIntoView({ block: "end" })} />
        </div>
      </div>

      {notice && (
        <p className="cc-notice" role="alert">
          {notice}
        </p>
      )}
      <form className="cc-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor={inputId}>
          Message
        </label>
        <textarea
          id={inputId}
          rows={1}
          dir="auto"
          maxLength={1000}
          placeholder="Type a message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <button type="submit" className="btn primary" disabled={!draft.trim() || typing}>
          Send
        </button>
      </form>
    </div>
  );
}
