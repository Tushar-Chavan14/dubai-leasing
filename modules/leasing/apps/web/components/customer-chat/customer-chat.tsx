"use client";

import { useEffect, useRef } from "react";
import { ChatView } from "./chat";
import { useChat } from "./use-chat";

/**
 * The visitor's chat, in the full page or the launcher panel. Opened with a unit (`?unit=<id>`), it sends that unit's
 * button once the history has loaded; opened with `check`, it starts the status check (asks for the email).
 */
export function CustomerChat({
  unitId,
  check,
  inputId = "cc-input-page",
  onNavigate,
  compact,
}: {
  unitId?: string;
  check?: boolean;
  inputId?: string;
  onNavigate?: () => void;
  /** The narrow launcher panel: tighter spacing. */
  compact?: boolean;
}) {
  const chat = useChat();
  const sent = useRef<string | null>(null);
  const { loading, loadFailed, press } = chat;

  useEffect(() => {
    if (loading || loadFailed) return;
    const what = unitId ? `unit:${unitId}` : check ? "status:start" : null;
    if (!what || sent.current === what) return;
    sent.current = what; // a ref survives strict mode's second run and later re-renders
    press(
      unitId ? { label: "Tell me about this property", data: what } : { label: "Check my application", data: what },
    );
    // Drop the query so a refresh does not send it again.
    window.history.replaceState(null, "", window.location.pathname);
  }, [unitId, check, loading, loadFailed, press]);

  return <ChatView chat={chat} inputId={inputId} onNavigate={onNavigate} compact={compact} />;
}
