import type { Metadata } from "next";
import Link from "next/link";
import { CopilotWorkspace } from "../../../components/copilot/workspace";
import type { ChatMessage, DraftView, ProposalView } from "../../../components/copilot/use-chat";
import { PageHead } from "../../../components/ui";
import { get } from "../../../lib/engine";
import { dateTime } from "../../../lib/format";

export const metadata: Metadata = { title: "Copilot" };

interface ThreadRow {
  id: string;
  title: string;
  contextKind: string | null;
  createdAt: string;
}
interface ThreadDetail extends ThreadRow {
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
function toChat(t: ThreadDetail): ChatMessage[] {
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

export default async function CopilotPage({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const { thread } = await searchParams;
  const [threads, current] = await Promise.all([
    get<ThreadRow[]>("/api/copilot/threads"),
    thread ? get<ThreadDetail>(`/api/copilot/threads/${encodeURIComponent(thread)}`) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHead
        title="Copilot"
        lede="Ask about leases, deadlines, approvals, available units and the rules. It reads the same data you can see and quotes the rule version. It can prepare a new application for you to confirm; it can't approve, send or change anything else."
      />
      <div className="cp-page">
        <aside className="cp-threads" aria-label="Your conversations">
          <Link href="/copilot" className="btn small block">
            New conversation
          </Link>
          {threads && threads.length > 0 ? (
            <ul>
              {threads.map((t) => (
                <li key={t.id}>
                  <Link href={`/copilot?thread=${t.id}`} aria-current={t.id === current?.id ? "page" : undefined}>
                    <span className="t">{t.title}</span>
                    <span className="d">{dateTime(t.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Your conversations appear here. Only you can see them.</p>
          )}
        </aside>
        <section className="panel cp-main" aria-label="Conversation">
          <CopilotWorkspace
            key={current?.id ?? "new"}
            {...(current ? { threadId: current.id, initial: toChat(current) } : {})}
          />
        </section>
      </div>
    </>
  );
}
