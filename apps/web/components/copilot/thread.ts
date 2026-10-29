import type { ChatMessage, DraftView, ProposalView } from "./use-chat";

export interface ThreadRow {
  id: string;
  title: string;
  contextKind: string | null;
  createdAt: string;
}
export interface ThreadDetail extends ThreadRow {
  messages: {
    id: string;
    role: "user" | "assistant" | "tool";
    content: string;
    toolName: string | null;
    toolArgs: Record<string, unknown> | null;
    toolOk: boolean | null;
    unverified: string[] | null;
    at: string;
  }[];
  proposals: ProposalView[];
  drafts?: DraftView[];
}

/** Stored rows → chat messages: tool rows attach to the answer that follows them. */
export function toChat(t: ThreadDetail): ChatMessage[] {
  const out: ChatMessage[] = [];
  let pending: ChatMessage["tools"] = [];
  for (const m of t.messages) {
    if (m.role === "tool") {
      pending.push({
        id: m.id,
        name: m.toolName ?? "tool",
        args: m.toolArgs ?? {},
        status: m.toolOk ? "ok" : "failed",
      });
    } else {
      out.push({
        id: m.id,
        role: m.role,
        content: m.content,
        tools: m.role === "assistant" ? pending : [],
        unverified: m.unverified ?? [],
        status: "done",
      });
      if (m.role === "assistant") pending = [];
    }
  }
  // Each proposal card belongs to the first answer written after it.
  const answers = t.messages.filter((m) => m.role === "assistant");
  for (const p of t.proposals ?? []) {
    const owner = answers.find((a) => a.at >= p.createdAt) ?? answers.at(-1);
    const msg = owner && out.find((o) => o.id === owner.id);
    if (msg) msg.proposals = [...(msg.proposals ?? []), p];
  }
  for (const d of t.drafts ?? []) {
    const owner = answers.find((a) => a.at >= d.createdAt) ?? answers.at(-1);
    const msg = owner && out.find((o) => o.id === owner.id);
    if (msg) msg.drafts = [...(msg.drafts ?? []), d];
  }
  return out;
}
