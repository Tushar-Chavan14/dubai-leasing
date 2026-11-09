"use client";

import { useActionState } from "react";
import { CheckIcon as IconCheck, WarningIcon as IconWarning } from "@phosphor-icons/react";
import { type ConversationActionState, releaseAction, replyAction } from "../actions";
import { buttonClass } from "../../../../components/ui/button";
import { Banner, FIELD, INPUT, LABEL } from "../../../../components/ui/form";

function Result({ s }: { s: ConversationActionState }) {
  if (s.ok)
    return (
      <Banner tone="good" role="status">
        <IconCheck size={16} className="mt-0.5 shrink-0" />
        {s.ok}
      </Banner>
    );
  if (s.error)
    return (
      <Banner tone="bad" role="alert">
        <IconWarning size={16} className="mt-0.5 shrink-0" />
        <div>
          <strong>{s.error}</strong>
          {s.reasons?.length ? (
            <ul>
              {s.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </Banner>
    );
  return null;
}

/** Reply in the enquirer's Telegram chat, or hand the conversation back to the bot. */
export function ConversationActions({ id, status }: { id: string; status: string }) {
  const [sent, reply, sending] = useActionState<ConversationActionState, FormData>(replyAction, {});
  const [released, release, releasing] = useActionState<ConversationActionState, FormData>(releaseAction, {});
  return (
    <div className="grid gap-4">
      <form action={reply} className={FIELD}>
        <input type="hidden" name="id" value={id} />
        <label className={LABEL} htmlFor="reply-text">
          Reply on Telegram
        </label>
        <textarea id="reply-text" name="text" rows={5} maxLength={4000} dir="auto" required className={INPUT} />
        <p className="m-0 text-[12.5px] text-muted">
          Telegram is for the enquiry only. Offers, documents and contracts go by email from the application.
          {status === "bot" ? " Replying takes the conversation over from the bot." : ""}
        </p>
        <button type="submit" className={`${buttonClass("primary", "sm")} w-fit`} disabled={sending}>
          {sending ? "Sending…" : "Send"}
        </button>
        <Result s={sent} />
      </form>
      {status === "handoff" && (
        <form action={release}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className={`${buttonClass("ghost", "sm")} w-full`} disabled={releasing}>
            Hand back to the bot
          </button>
          <p className="m-0 mt-1.5 text-[12.5px] text-muted">
            Closes the handoff task. The bot starts again from the beginning with this person.
          </p>
          <Result s={released} />
        </form>
      )}
    </div>
  );
}
