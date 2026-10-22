"use client";

import { useActionState } from "react";
import { IconCheck, IconWarning } from "../../../../lib/icons";
import { type ConversationActionState, releaseAction, replyAction } from "../actions";

function Result({ s }: { s: ConversationActionState }) {
  if (s.ok)
    return (
      <div className="alert" data-tone="good" role="status">
        <IconCheck size={16} />
        {s.ok}
      </div>
    );
  if (s.error)
    return (
      <div className="alert" data-tone="bad" role="alert">
        <IconWarning size={16} />
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
      </div>
    );
  return null;
}

/** Reply in the enquirer's Telegram chat, or hand the conversation back to the bot. */
export function ConversationActions({ id, status }: { id: string; status: string }) {
  const [sent, reply, sending] = useActionState<ConversationActionState, FormData>(replyAction, {});
  const [released, release, releasing] = useActionState<ConversationActionState, FormData>(releaseAction, {});
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <form action={reply} className="field">
        <input type="hidden" name="id" value={id} />
        <label className="field-label" htmlFor="reply-text">
          Reply on Telegram
        </label>
        <textarea id="reply-text" name="text" rows={5} maxLength={4000} dir="auto" required />
        <p className="muted" style={{ fontSize: 13 }}>
          Telegram is for the enquiry only. Offers, documents and contracts go by email from the application.
          {status === "bot" ? " Replying takes the conversation over from the bot." : ""}
        </p>
        <button type="submit" className="btn primary" disabled={sending}>
          {sending ? "Sending…" : "Send"}
        </button>
        <Result s={sent} />
      </form>
      {status === "handoff" && (
        <form action={release}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className="btn block" disabled={releasing}>
            Hand back to the bot
          </button>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            Closes the handoff task. The bot starts again from the beginning with this person.
          </p>
          <Result s={released} />
        </form>
      )}
    </div>
  );
}
