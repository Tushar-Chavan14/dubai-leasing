"use client";

import type { ChannelReply } from "@leasing/core";
import { type KeyboardEvent, type SyntheticEvent, useEffect, useRef, useState } from "react";
import { MicButton, useReadAloud } from "../voice/voice-controls";
import { useHasLocalVoice, useStored } from "../voice/use-voice";
import { StatusTracker } from "./status-tracker";
import { ChoiceCardView } from "../chat-ui/choice-card";
import { CARD_RAIL, UnitCardView } from "../chat-ui/unit-card";
import { FIELD_BARE, SEND_BTN, StaffComposer, TOOL_BTN, VoiceMenu } from "../chat-ui/composer";
import { CUSTOMER_STARTERS, customerPills, type Pill } from "../chat-ui/quick-actions.ts";
import { ArrowUpIcon, SparkleIcon } from "@phosphor-icons/react";
import { Thinking } from "../chat-ui/thinking";
import { buttonClass } from "../ui/button";
import { type ChatController, isArabicChat } from "./use-chat";

/** The visitor's wait for a reply: the light "Working" block with a seconds counter (the public chat has no tool steps to show). */
function Waiting({ ar }: { ar: boolean }) {
  const [startedAt] = useState(() => performance.now());
  return (
    <Thinking
      tools={[]}
      streaming
      answerStarted={false}
      startedAt={startedAt}
      {...(ar ? { labels: { working: "جارٍ العمل", seconds: (n: number) => `${n} ثانية` } } : {})}
    />
  );
}

/** The small accent mark that starts an assistant message. */
function Mark() {
  return (
    <span
      className="flex size-7 flex-none items-center justify-center rounded-lg bg-accent text-on-accent"
      aria-hidden="true"
    >
      <SparkleIcon size={14} weight="bold" />
    </span>
  );
}

/** The chat view. The parent holds the state (`useChat`), so it can also send a button on load. */
export function ChatView({
  chat,
  onNavigate,
  inputId = "cc-input",
  compact = false,
}: {
  chat: ChatController;
  onNavigate?: (() => void) | undefined;
  inputId?: string;
  /** The narrow launcher panel: tighter padding. */
  compact?: boolean | undefined;
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

  /** A pill or start-screen prompt: presses an engine button, or sends the text as the visitor's message. */
  const pick = (p: Pill) =>
    p.action.kind === "press" ? press({ label: p.label, data: p.action.data }) : sendText(p.action.text);

  const submit = (e?: SyntheticEvent) => {
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

  const submitCode = (e: SyntheticEvent) => {
    e.preventDefault();
    const digits = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(digits) || typing) return;
    sendText(digits, ar ? "تم إدخال الرمز" : "Code entered");
    setCode("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-page text-ink">
      <div
        ref={scroller}
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${compact ? "p-3.5" : "px-5 py-5"}`}
        role="log"
        aria-live="polite"
      >
        <div className="grid gap-5">
          {loading && <p className="text-center text-sm text-muted">Loading…</p>}
          {loadFailed && (
            <p className="text-center text-sm text-muted">
              Couldn&apos;t load your chat.{" "}
              <button type="button" className={buttonClass("ghost", "sm")} onClick={reload}>
                Retry
              </button>
            </p>
          )}
          {!loading && !loadFailed && bubbles.length === 0 && (
            <div className={`grid max-w-[640px] justify-items-start gap-4 ${compact ? "py-2" : "py-4"}`}>
              <Mark />
              <p className="m-0 text-base leading-relaxed">
                <strong>Hello, welcome to Dubai Leasing.</strong> I can find homes that suit you, book a site visit,
                start your application and tell you where an application stands. Ask in English or Arabic.
              </p>
              <div className="flex flex-wrap gap-2" role="list" aria-label="Things you can ask">
                {CUSTOMER_STARTERS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    role="listitem"
                    className={buttonClass("ghost", "sm")}
                    disabled={typing}
                    onClick={() => pick(p)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="m-0 text-[12.5px] text-muted">
                Prices, dates and documents always come from our records. Documents are only ever uploaded through a
                secure link we email you.
              </p>
            </div>
          )}
          {bubbles.map((b, i) => (
            <div
              key={b.key}
              className={`grid gap-2 ${b.role === "user" ? "justify-items-end" : "justify-items-start"}`}
            >
              <div className={`flex max-w-[88%] items-start gap-2.5 ${b.role === "user" ? "flex-row-reverse" : ""}`}>
                {b.role === "bot" && <Mark />}
                <div
                  className={`text-[15px] leading-relaxed break-words whitespace-pre-wrap ${
                    b.role === "user"
                      ? "rounded-[16px_16px_4px_16px] bg-raised px-3.5 py-2.5 text-ink"
                      : "pt-0.5 text-ink"
                  } ${b.status === "failed" ? "outline-2 outline-danger" : ""}`}
                  dir="auto"
                  data-failed={b.status === "failed" || undefined}
                >
                  {b.reply?.status ? (b.text.split("\n")[0] ?? b.text) : b.text}
                </div>
              </div>
              {b.status === "failed" && (
                <button type="button" className={buttonClass("ghost", "sm")} onClick={() => retry(b.key)}>
                  Not sent. Retry
                </button>
              )}
              {b.reply?.status ? (
                <StatusTracker status={b.reply.status} disabled={i !== lastBot || typing} onPress={press} />
              ) : null}
              {b.reply?.cards?.length ? (
                <div className={CARD_RAIL}>
                  {b.reply.cards.map((c) => (
                    <UnitCardView
                      key={c.unitId}
                      card={c}
                      disabled={i !== lastBot || typing}
                      onNavigate={onNavigate}
                      onBook={() => press({ label: "Book a site visit", data: `unit:${c.unitId}` })}
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
                <div className="flex max-w-full flex-wrap gap-2">
                  {chips(b.reply).map((btn) => (
                    <button
                      key={btn.data}
                      type="button"
                      className={`${buttonClass("ghost", "sm")} disabled:opacity-60`}
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
            <div
              className="flex max-w-[88%] items-start gap-2.5"
              role="status"
              aria-label={ar ? "المساعد يفكر" : "Assistant is working on it"}
            >
              <Mark />
              <Waiting ar={ar} />
            </div>
          )}
        </div>
      </div>

      {notice && (
        <p className="m-0 border-t border-line bg-raised px-4 py-2 text-sm text-danger" role="alert">
          {notice}
        </p>
      )}
      <div className="bg-page px-1 pb-2">
        <StaffComposer
          pills={customerPills(ar)}
          pillsLabel={ar ? "إجراءات سريعة" : "Quick actions"}
          pillsDisabled={typing}
          onPick={pick}
          onSubmit={askingCode ? submitCode : submit}
          field={
            askingCode ? (
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-muted" htmlFor={`${inputId}-code`}>
                  {ar ? "الرمز المكون من 6 أرقام من بريدك الإلكتروني" : "6-digit code from your email"}
                </label>
                <input
                  id={`${inputId}-code`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  dir="ltr"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full !rounded-none !border-0 !bg-transparent !p-0 font-mono text-xl tracking-[0.3em] text-ink !shadow-none !outline-none placeholder:text-muted/50"
                />
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
                  placeholder={ar ? "اكتب رسالة" : "Type or hold the mic"}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKey}
                  className={FIELD_BARE}
                />
              </>
            )
          }
          tools={
            askingCode ? (
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent px-1.5 py-1 font-sans text-[13px] font-medium text-muted underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
                onClick={() => setCodeOff(last?.key ?? null)}
              >
                {ar ? "اكتب رسالة بدلاً من ذلك" : "Type a message instead"}
              </button>
            ) : (
              <>
                <MicButton endpoint="/api/public/voice" onText={heard} disabled={typing} className={TOOL_BTN} />
                <VoiceMenu
                  auto={auto}
                  setAuto={setAuto}
                  read={read}
                  setRead={setRead}
                  canRead={canRead}
                  buttonClassName={TOOL_BTN}
                />
              </>
            )
          }
          send={
            askingCode ? (
              <button type="submit" className={buttonClass("primary", "sm")} disabled={code.length !== 6 || typing}>
                {ar ? "تحقق" : "Verify"}
              </button>
            ) : (
              <button
                type="submit"
                className={SEND_BTN}
                disabled={!draft.trim() || typing}
                aria-label={ar ? "إرسال" : "Send"}
              >
                <ArrowUpIcon size={16} weight="bold" aria-hidden />
              </button>
            )
          }
        />
      </div>
    </div>
  );
}

/** A reply's chips. The tracker shows its own actions as buttons, so they are not repeated here. */
function chips(reply: ChannelReply | undefined) {
  const own = new Set(reply?.status?.apps.flatMap((a) => a.actions.map((x) => x.data)));
  return (reply?.buttons ?? []).filter((b) => !own.has(b.data));
}
