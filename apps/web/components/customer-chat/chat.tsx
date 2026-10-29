"use client";

import type { ChannelReply } from "@leasing/core";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { MicButton, useReadAloud } from "../voice/voice-controls";
import { useHasLocalVoice, useStored } from "../voice/use-voice";
import { StatusTracker } from "./status-tracker";
import { ChoiceCardView } from "../chat-ui/choice-card";
import { UnitCardView } from "../chat-ui/unit-card";
import { Composer, VoiceMenu } from "../chat-ui/composer";
import { customerPills } from "../chat-ui/quick-actions.ts";
import { type ChatController, isArabicChat } from "./use-chat";

/** The chat view. The parent holds the state (`useChat`), so it can also send a button on load. */
export function ChatView({
  chat,
  onNavigate,
  inputId = "cc-input",
}: {
  chat: ChatController;
  onNavigate?: (() => void) | undefined;
  inputId?: string;
}) {
  const { bubbles, loading, loadFailed, reload, typing, notice, sendText, press, retry } = chat;
  const [draft, setDraft] = useState("");
  const [code, setCode] = useState("");
  const [codeOff, setCodeOff] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const ar = isArabicChat(bubbles);
  const [auto, setAuto] = useStored("auto");
  const [read, setRead] = useStored("read");
  const canRead = useHasLocalVoice();
  const lastBotBubble = bubbles.findLast((b) => b.role === "bot");
  useReadAloud(read && canRead, lastBotBubble ? { key: lastBotBubble.key, text: lastBotBubble.text } : undefined);
  /** A transcript lands in the field for the visitor to edit and send, or goes straight out with auto-send. */
  const heard = (text: string) => {
    if (auto && !typing) sendText(text);
    else setDraft((d) => `${d ? `${d} ` : ""}${text}`.slice(0, 1000));
  };

  // Keep the newest message in view: scroll this container only (never the page), and only when the thread changes.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubbles.length, typing]);

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
  const last = bubbles[lastBot];
  const lastIsLast = lastBot === bubbles.length - 1;
  const askingCode =
    !!last && lastIsLast && !last.reply?.status && last.reply?.input === "code" && codeOff !== last.key;

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    const digits = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(digits) || typing) return;
    sendText(digits, ar ? "تم إدخال الرمز" : "Code entered");
    setCode("");
  };

  return (
    <div className="cc">
      <div ref={scroller} className="cc-scroll" role="log" aria-live="polite">
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
            </>
          )}
          {bubbles.map((b, i) => (
            <div key={b.key} className="cc-row" data-role={b.role}>
              <div className="cc-bubble" dir="auto" data-failed={b.status === "failed" || undefined}>
                {b.reply?.status ? (b.text.split("\n")[0] ?? b.text) : b.text}
              </div>
              {b.status === "failed" && (
                <button type="button" className="btn small" onClick={() => retry(b.key)}>
                  Not sent. Retry
                </button>
              )}
              {b.reply?.status ? (
                <StatusTracker status={b.reply.status} disabled={i !== lastBot || typing} onPress={press} />
              ) : null}
              {b.reply?.cards?.length ? (
                <div className="cc-cards">
                  {b.reply.cards.map((c) => (
                    <UnitCardView
                      key={c.unitId}
                      card={c}
                      disabled={i !== lastBot || typing}
                      onNavigate={onNavigate}
                      onBook={() => press({ label: "Book a viewing", data: `unit:${c.unitId}` })}
                      onApply={() => press({ label: "Apply now", data: `apply:${c.unitId}` })}
                    />
                  ))}
                </div>
              ) : null}
              {b.reply?.choices ? (
                <ChoiceCardView
                  question={b.reply.choices.question}
                  options={b.reply.choices.options.map((o) => ({ key: o.data, label: o.label }))}
                  disabled={i !== lastBot || typing}
                  onPick={(o) => {
                    const option = b.reply?.choices?.options.find((x) => x.data === o.key);
                    if (option) press(option);
                  }}
                  otherLabel={ar ? "اكتب شيئاً آخر" : "Type something else"}
                  onOther={() => document.getElementById(inputId)?.focus()}
                />
              ) : null}
              {chips(b.reply).length ? (
                <div className="cc-buttons">
                  {chips(b.reply).map((btn) => (
                    <button
                      key={btn.data}
                      type="button"
                      className="cc-chip"
                      dir="auto"
                      disabled={i !== lastBot || typing || btn.disabled}
                      {...(btn.disabled ? { title: "Coming soon" } : {})}
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
              <div
                className="cc-bubble cc-typing"
                aria-label={ar ? "المساعد يفكر" : "Assistant is working on it"}
                role="status"
              >
                <i />
                <i />
                <i />
              </div>
            </div>
          )}
        </div>
      </div>

      {notice && (
        <p className="cc-notice" role="alert">
          {notice}
        </p>
      )}
      <div className="cc-composer">
        <Composer
          pills={customerPills(ar)}
          pillsLabel={ar ? "إجراءات سريعة" : "Quick actions"}
          pillsDisabled={typing}
          onPick={(p) =>
            p.action.kind === "press" ? press({ label: p.label, data: p.action.data }) : sendText(p.action.text)
          }
          onSubmit={askingCode ? submitCode : submit}
          className={askingCode ? "cc-code" : undefined}
        >
          {askingCode ? (
            <div className="field">
              <label className="field-label" htmlFor={`${inputId}-code`}>
                {ar ? "الرمز المكون من 6 أرقام من بريدك الإلكتروني" : "6-digit code from your email"}
              </label>
              <div className="cc-code-row">
                <input
                  id={`${inputId}-code`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  dir="ltr"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <button type="submit" className="btn primary" disabled={code.length !== 6 || typing}>
                  {ar ? "تحقق" : "Verify"}
                </button>
              </div>
              <button type="button" className="btn ghost small" onClick={() => setCodeOff(last?.key ?? null)}>
                {ar ? "اكتب رسالة بدلاً من ذلك" : "Type a message instead"}
              </button>
            </div>
          ) : (
            <>
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
              <MicButton endpoint="/api/public/voice" onText={heard} disabled={typing} />
              <VoiceMenu auto={auto} setAuto={setAuto} read={read} setRead={setRead} canRead={canRead} />
              <button type="submit" className="btn primary small" disabled={!draft.trim() || typing}>
                Send
              </button>
            </>
          )}
        </Composer>
      </div>
    </div>
  );
}

/** A reply's chips. The tracker shows its own actions as buttons, so they are not repeated here. */
function chips(reply: ChannelReply | undefined) {
  const own = new Set(reply?.status?.apps.flatMap((a) => a.actions.map((x) => x.data)));
  return (reply?.buttons ?? []).filter((b) => !own.has(b.data));
}
