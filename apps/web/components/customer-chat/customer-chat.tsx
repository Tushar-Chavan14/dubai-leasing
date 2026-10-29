"use client";

import { useEffect, useRef } from "react";
import { ChatView } from "./chat";
import { useChat } from "./use-chat";

/** The full-page chat. Opened with a unit (`?unit=<id>`), it sends that unit's button once the history has loaded. */
export function CustomerChat({ unitId }: { unitId?: string }) {
  const chat = useChat();
  const sent = useRef<string | null>(null);
  const { loading, loadFailed, press } = chat;

  useEffect(() => {
    if (!unitId || loading || loadFailed || sent.current === unitId) return;
    sent.current = unitId; // a ref survives strict mode's second run and later re-renders
    press({ label: "Tell me about this property", data: `unit:${unitId}` });
    // Drop the query so a refresh does not send it again.
    window.history.replaceState(null, "", window.location.pathname);
  }, [unitId, loading, loadFailed, press]);

  return <ChatView chat={chat} inputId="cc-input-page" />;
}
