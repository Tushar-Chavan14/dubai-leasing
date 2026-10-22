"use client";

import { useCallback, useRef, useState } from "react";

export interface ToolStep {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "failed";
}

interface ProposalBase {
  id: string;
  status: "pending" | "confirmed" | "cancelled" | "failed" | "expired";
  result: { applicationId?: string; ref?: string; taskId?: string; approvalId?: string; error?: string } | null;
  expiresAt: string;
  createdAt: string;
}

/** An action the copilot proposed; only the user's Confirm click carries it out (D25, D26). */
export type ProposalView = ProposalBase &
  (
    | {
        kind: "create_application";
        summary: {
          unitCode: string;
          unit: string;
          applicant: string;
          email: string;
          viewingLabel: string;
          askingRent: string;
        };
      }
    | {
        kind: "create_task";
        summary: { leaseRef: string; title: string; assigneeRole: string; dueOn: string | null };
      }
    | {
        kind: "request_approval";
        summary:
          | {
              gate: "formal_reminder";
              leaseRef: string;
              instalment: number;
              amount: string;
              dueOn: string;
              status: string;
            }
          | {
              gate: "vacate_notice";
              leaseRef: string;
              ground: string;
              servedOn: string;
              deliveryMethod: string;
              leaseEndOn: string;
            };
      }
  );

/** Text the copilot drafted; the user opens it in the normal form and sends it themselves (D26). */
export interface DraftView {
  id: string;
  kind: "email" | "approval_note";
  leaseId: string | null;
  leaseRef: string | null;
  approvalId: string | null;
  subject: string | null;
  body: string;
  status: "draft" | "used";
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolStep[];
  unverified: string[];
  status: "streaming" | "done" | "error";
  proposals?: ProposalView[];
  drafts?: DraftView[];
}

export interface PageRef {
  kind: "lease" | "unit" | "approval";
  id: string;
}

type StreamEvent =
  | { type: "thread"; threadId: string }
  | { type: "tool"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; ok: boolean }
  | { type: "token"; text: string }
  | { type: "discard" }
  | { type: "done"; messageId: string; answer: string; unverified: string[] }
  | { type: "error"; error: string }
  | { type: "proposal"; proposal: ProposalView }
  | { type: "draft"; draft: DraftView };

let seq = 0;
const localId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Chat state for the copilot: sends a question, reads the NDJSON stream, keeps the thread id. */
export function useCopilotChat(opts: { page?: PageRef | undefined; threadId?: string; initial?: ChatMessage[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>(opts.initial ?? []);
  const [threadId, setThreadId] = useState<string | undefined>(opts.threadId);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const patchLast = useCallback(
    (f: (m: ChatMessage) => ChatMessage) => setMessages((ms) => (ms.length ? [...ms.slice(0, -1), f(ms.at(-1)!)] : ms)),
    [],
  );

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setBusy(true);
      setMessages((ms) => [
        ...ms,
        { id: localId(), role: "user", content: message, tools: [], unverified: [], status: "done" },
        { id: localId(), role: "assistant", content: "", tools: [], unverified: [], status: "streaming" },
      ]);
      abort.current = new AbortController();
      try {
        const res = await fetch("/api/copilot/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message,
            ...(threadId ? { threadId } : {}),
            ...(opts.page && !threadId ? { context: opts.page } : {}),
          }),
          signal: abort.current.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "The copilot is unavailable.");
        }
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let nl = buf.indexOf("\n");
          while (nl >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            nl = buf.indexOf("\n");
            if (!line) continue;
            const e = JSON.parse(line) as StreamEvent;
            switch (e.type) {
              case "thread":
                setThreadId(e.threadId);
                break;
              case "tool":
                patchLast((m) => ({
                  ...m,
                  tools: [...m.tools, { id: e.id, name: e.name, args: e.args, status: "running" }],
                }));
                break;
              case "tool_result":
                patchLast((m) => ({
                  ...m,
                  tools: m.tools.map((t) => (t.id === e.id ? { ...t, status: e.ok ? "ok" : "failed" } : t)),
                }));
                break;
              case "token":
                patchLast((m) => ({ ...m, content: m.content + e.text }));
                break;
              case "discard":
                patchLast((m) => ({ ...m, content: "" }));
                break;
              case "done":
                patchLast((m) => ({
                  ...m,
                  id: e.messageId,
                  content: e.answer,
                  unverified: e.unverified,
                  status: "done",
                }));
                break;
              case "error":
                patchLast((m) => ({ ...m, content: e.error, status: "error" }));
                break;
              case "proposal":
                patchLast((m) => ({ ...m, proposals: [...(m.proposals ?? []), e.proposal] }));
                break;
              case "draft":
                patchLast((m) => ({ ...m, drafts: [...(m.drafts ?? []), e.draft] }));
                break;
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          patchLast((m) => ({ ...m, content: (err as Error).message, status: "error" }));
        }
      } finally {
        patchLast((m) =>
          m.status === "streaming"
            ? { ...m, status: m.content ? "done" : "error", content: m.content || "No answer came back. Try again." }
            : m,
        );
        setBusy(false);
        abort.current = null;
      }
    },
    [busy, threadId, opts.page, patchLast],
  );

  const reset = useCallback(() => {
    abort.current?.abort();
    setMessages([]);
    setThreadId(undefined);
  }, []);

  /** A proposal changed (confirmed, cancelled, failed): update its card wherever it is. */
  const updateProposal = useCallback(
    (view: ProposalView) =>
      setMessages((ms) =>
        ms.map((m) => (m.proposals ? { ...m, proposals: m.proposals.map((p) => (p.id === view.id ? view : p)) } : m)),
      ),
    [],
  );

  return { messages, threadId, busy, send, reset, updateProposal, stop: () => abort.current?.abort() };
}
