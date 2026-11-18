"use client";

import type { ChannelButton, ChannelReply, ChatFilters } from "@leasing/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { type HistoryItem, loadHistory, sendChat } from "./actions";

export interface Bubble {
  key: string;
  role: "user" | "bot";
  text: string;
  reply?: ChannelReply;
  /** User bubbles only: the message hasn't reached the engine (yet). */
  status?: "sending" | "failed";
  payload?: Payload;
}

type Done = (ok: boolean) => void;

type Payload = { kind: "text"; text: string } | { kind: "callback"; data: string };

const BUTTON_PREFIX = "[button] ";

/** Stored history → bubbles. A tapped button shows as its label when an earlier reply offered it, else it's hidden. */
export function bubblesFromHistory(items: HistoryItem[]): Bubble[] {
  const labels = new Map<string, string>();
  const out: Bubble[] = [];
  for (const m of items) {
    if (m.direction === "out") {
      for (const b of [...(m.reply?.buttons ?? []), ...(m.reply?.choices?.options ?? [])]) labels.set(b.data, b.label);
      out.push({ key: m.id, role: "bot", text: m.reply?.text ?? m.body, ...(m.reply ? { reply: m.reply } : {}) });
    } else if (m.body.startsWith(BUTTON_PREFIX)) {
      const label = labels.get(m.body.slice(BUTTON_PREFIX.length));
      if (label) out.push({ key: m.id, role: "user", text: label });
    } else {
      out.push({ key: m.id, role: "user", text: m.body });
    }
  }
  return out;
}

export type ChatController = ReturnType<typeof useChat>;

/** `onFilters` gets the search filters that came with each reply (the listing grid follows them). */
export function useChat(opts: { onFilters?: ((f: ChatFilters) => void) | undefined } = {}) {
  const onFilters = useRef(opts.onFilters);
  useEffect(() => {
    onFilters.current = opts.onFilters;
  });
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [loading, setLoading] = useState(true);
  const [typing, setTyping] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const ids = useRef(new Map<string, string>()); // bubble key → clientMessageId (kept for retries)
  const busy = useRef(false);

  const fetchHistory = useCallback(() => {
    loadHistory()
      .then((h) => setBubbles(bubblesFromHistory(h)))
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const reload = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    fetchHistory();
  }, [fetchHistory]);

  const deliver = useCallback(async (key: string, payload: Payload, done?: Done) => {
    busy.current = true;
    setTyping(true);
    setNotice(null);
    setBubbles((b) => b.map((x) => (x.key === key ? { ...x, status: "sending" } : x)));
    const clientMessageId = ids.current.get(key) ?? crypto.randomUUID();
    ids.current.set(key, clientMessageId);
    let result: Awaited<ReturnType<typeof sendChat>>;
    try {
      result = await sendChat({ ...payload, clientMessageId });
    } catch {
      result = { ok: false, error: "Network problem." };
    }
    busy.current = false;
    setTyping(false);
    if (!result.ok) {
      setNotice(result.error);
      setBubbles((b) => b.map((x) => (x.key === key ? { ...x, status: "failed" } : x)));
      done?.(false);
      return;
    }
    ids.current.delete(key);
    done?.(true);
    if (result.filters) onFilters.current?.(result.filters);
    setBubbles((b) => {
      const sent = b.map((x) => {
        if (x.key !== key) return x;
        const { status: _s, payload: _p, ...rest } = x;
        return rest;
      });
      return result.reply
        ? [...sent, { key: crypto.randomUUID(), role: "bot", text: result.reply.text, reply: result.reply }]
        : sent;
    });
  }, []);

  const send = useCallback(
    (payload: Payload, label: string, done?: Done) => {
      if (busy.current) {
        done?.(false);
        return;
      }
      const key = crypto.randomUUID();
      setBubbles((b) => [...b, { key, role: "user", text: label, status: "sending", payload }]);
      void deliver(key, payload, done);
    },
    [deliver],
  );

  /** `label` is what the bubble shows when it differs from the text sent (a code is not shown). */
  const sendText = useCallback(
    (text: string, label?: string, done?: Done) => send({ kind: "text", text }, label ?? text, done),
    [send],
  );
  /** `done(false)` when the message could not be sent (the caller can undo what it changed in advance). */
  const press = useCallback(
    (b: ChannelButton, done?: Done) => send({ kind: "callback", data: b.data }, b.label, done),
    [send],
  );
  const retry = useCallback(
    (key: string) => {
      const p = bubbles.find((x) => x.key === key)?.payload;
      if (p && !busy.current) void deliver(key, p);
    },
    [bubbles, deliver],
  );

  return { bubbles, loading, loadFailed, reload, typing, notice, sendText, press, retry };
}

/** The conversation is in Arabic when the latest bot message is (the reply carries no language). */
export const isArabicChat = (bubbles: Bubble[]) =>
  /[\u0600-\u06FF]/.test(bubbles.findLast((b) => b.role === "bot")?.text ?? "");
