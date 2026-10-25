"use client";

import type { ChannelButton, ChannelReply } from "@leasing/core";
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

type Payload = { kind: "text"; text: string } | { kind: "callback"; data: string };

const BUTTON_PREFIX = "[button] ";

/** Stored history → bubbles. A tapped button shows as its label when an earlier reply offered it, else it's hidden. */
export function bubblesFromHistory(items: HistoryItem[]): Bubble[] {
  const labels = new Map<string, string>();
  const out: Bubble[] = [];
  for (const m of items) {
    if (m.direction === "out") {
      for (const b of m.reply?.buttons ?? []) labels.set(b.data, b.label);
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

export function useChat() {
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

  const deliver = useCallback(async (key: string, payload: Payload) => {
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
      return;
    }
    ids.current.delete(key);
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
    (payload: Payload, label: string) => {
      if (busy.current) return;
      const key = crypto.randomUUID();
      setBubbles((b) => [...b, { key, role: "user", text: label, status: "sending", payload }]);
      void deliver(key, payload);
    },
    [deliver],
  );

  const sendText = useCallback((text: string) => send({ kind: "text", text }, text), [send]);
  const press = useCallback((b: ChannelButton) => send({ kind: "callback", data: b.data }, b.label), [send]);
  const retry = useCallback(
    (key: string) => {
      const p = bubbles.find((x) => x.key === key)?.payload;
      if (p && !busy.current) void deliver(key, p);
    },
    [bubbles, deliver],
  );

  return { bubbles, loading, loadFailed, reload, typing, notice, sendText, press, retry };
}
