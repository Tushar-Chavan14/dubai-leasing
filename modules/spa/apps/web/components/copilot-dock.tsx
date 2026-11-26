"use client";

import { ArrowUpIcon, PlusCircleIcon } from "@phosphor-icons/react";
import { Button } from "@platform/ui/button";
import { CHIP as STARTER_CHIP, ComposerCard, FIELD_BARE, SEND_BTN } from "@platform/ui/shell/composer";
import { DOCK_ICON_BTN, DOCK_MIN_WIDTH, DockFrame, useDockState } from "@platform/ui/shell/dock-frame";
import { type SpaRole, screenOf } from "@spa/core/roles";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, type ReactNode, type RefObject, type SyntheticEvent, useEffect, useRef, useState } from "react";
import { dubaiDateTime } from "../lib/format";
import { startersFor } from "../lib/copilot-starters";

/** What the engine's chat answer carries for one proposal (status `proposed` until a click). */
export interface ProposalLite {
  id: string;
  kind: string;
  status: "proposed" | "confirmed" | "cancelled" | "expired";
  expiresAt: string;
  summary: string;
  note?: string;
}
export interface DraftLite {
  id: string;
  kind: "email" | "summary" | "approval_note";
  dealId: string | null;
  body: string;
}
export type DockLine =
  | { who: "you"; text: string }
  | {
      who: "copilot";
      text: string;
      kind: string;
      verified: boolean;
      unverified: string[];
      tools: { name: string; ok: boolean }[];
      scope: { offTopic: boolean; probability: number } | null;
      proposals: ProposalLite[];
      drafts: DraftLite[];
    };

/** What each tool does, in the words on its chip. */
const CHIP: Record<string, string> = {
  search_deals: "Searched deals",
  get_deal: "Read a deal",
  get_deal_timeline: "Read the timeline",
  list_approvals: "Read approvals",
  list_tasks: "Read tasks",
  get_payment_plan: "Read the payment plan",
  get_noc_bank_status: "Read NOC and bank letters",
  get_settlement: "Read the settlement",
  get_signing_status: "Read the signing",
  list_listings: "Read listings",
  get_listing: "Read a listing",
  get_template_status: "Read templates",
  get_rulebook_value: "Read the rulebook",
  get_compliance_case: "Read a case",
  request_documents: "Proposed a document request",
  create_task: "Proposed a task",
  resend_signing_link: "Proposed a link resend",
  prepare_agreement: "Proposed preparing the agreement",
  draft_email: "Drafted an email",
  draft_summary: "Drafted a summary",
  draft_approval_note: "Drafted an approval note",
};
const chip = (name: string) => CHIP[name] ?? "Used a tool";

/** Splits text so each unverified value is wrapped for `<mark>`; text without one comes back whole. */
export function markUnverified(text: string, values: string[]): string[] {
  const list = [...new Set(values)].filter(Boolean);
  if (!list.length) return [text];
  const re = new RegExp(`(${list.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return text.split(re).filter((p) => p !== "");
}

function Marked({ text, values }: { text: string; values: string[] }) {
  const set = new Set(values);
  return (
    <>
      {markUnverified(text, values).map((p, i) =>
        set.has(p) ? (
          <mark key={i} title="Not from a tool result of this answer" className="rounded bg-warning/20 px-0.5 text-ink">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function HowHandled({ line }: { line: Extract<DockLine, { who: "copilot" }> }) {
  const calls = line.tools.length;
  const scope = line.scope;
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer font-semibold">How this was handled</summary>
      <ul className="m-0 mt-1 grid list-disc gap-0.5 pl-4">
        <li>
          {line.kind === "scope_blocked"
            ? "Off topic: answered by code, the model did not run."
            : line.kind === "guarded"
              ? "The answer was replaced by a fixed line."
              : scope
                ? `On topic (scope check ${Math.round((1 - scope.probability) * 100)}%).`
                : "Scope check not run."}
        </li>
        <li>
          {calls
            ? `${calls} tool call${calls === 1 ? "" : "s"}: ${line.tools.map((t) => chip(t.name)).join(", ")}.`
            : "No tool calls."}
        </li>
        <li>
          {line.verified
            ? "Every amount, date and rate was checked against a tool result."
            : `${line.unverified.length || "Some"} value${line.unverified.length === 1 ? "" : "s"} not confirmed by a tool, marked in the text.`}
        </li>
        <li>Nothing was sent, approved or changed; a proposal runs only when you confirm it.</li>
      </ul>
    </details>
  );
}

const DONE: Record<string, (r: Record<string, unknown>) => string> = {
  request_documents: (r) => `Documents requested from ${String(r.requested ?? 0)} people.`,
  create_task: () => "The task is open.",
  resend_signing_link: (r) => (r.status === "sent" ? "A new link was emailed." : "The email could not be sent."),
  prepare_agreement: () => "Preparation is queued. Legal still has to approve the agreement.",
};

/** One proposal: what will happen, when it lapses, and the two buttons. The click is the only thing that runs it. */
export function ProposalCard({ card }: { card: ProposalLite }) {
  const [status, setStatus] = useState(card.status);
  const [note, setNote] = useState(card.note ?? "");
  const [busy, setBusy] = useState(false);
  const act = async (verb: "confirm" | "cancel") => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/copilot/proposals/${card.id}/${verb}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; result?: Record<string, unknown> };
      if (res.ok) {
        setStatus(verb === "confirm" ? "confirmed" : "cancelled");
        setNote(
          verb !== "confirm"
            ? ""
            : body.result?.failed
              ? String(body.result.message ?? "It could not be done.")
              : (DONE[card.kind]?.(body.result ?? {}) ?? "Done."),
        );
      } else if (res.status === 410) {
        setStatus("expired");
      } else
        setNote(
          res.status === 403
            ? "This isn't yours to confirm."
            : res.status === 409
              ? (body.error ?? "This can no longer run: the deal or the proposal changed.")
              : "That didn't work. Try again in a moment.",
        );
    } catch {
      setNote("That didn't work. Try again in a moment.");
    }
    setBusy(false);
  };
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-raised p-3 text-sm" aria-label="Proposal">
      <b className="font-semibold">Proposed</b>
      <p className="m-0 text-ink">{card.summary}</p>
      {status === "proposed" ? (
        <>
          <p className="m-0 text-xs text-muted">
            Nothing has happened until you confirm. Expires {dubaiDateTime(card.expiresAt)}.
          </p>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" type="button" disabled={busy} onClick={() => void act("confirm")}>
              Confirm
            </Button>
            <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => void act("cancel")}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <p className="m-0 text-xs font-semibold text-muted">
          {status === "confirmed"
            ? "Confirmed"
            : status === "cancelled"
              ? "Cancelled"
              : "This proposal expired. Ask again."}
        </p>
      )}
      {note && (
        <p role="status" className="m-0 text-xs text-muted">
          {note}
        </p>
      )}
    </div>
  );
}

const DRAFT_LABEL = { email: "Email draft", summary: "Summary draft", approval_note: "Approval note draft" } as const;

/** One draft. Email and summary are copy-only; an approval note opens the approvals page with the note box filled in. */
export function DraftCard({ card, role }: { card: DraftLite; role: SpaRole }) {
  const [copied, setCopied] = useState(false);
  const href =
    role === "compliance_officer" || role === "mlro"
      ? `/compliance?draft=${card.id}#inbox`
      : `/work?tab=inbox&draft=${card.id}`;
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-raised p-3 text-sm" aria-label={DRAFT_LABEL[card.kind]}>
      <b className="font-semibold">{DRAFT_LABEL[card.kind]}</b>
      <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-ink">
        {card.body}
      </pre>
      {card.kind === "approval_note" ? (
        <>
          <p className="m-0 text-xs text-muted">Read it, change it and decide yourself: nothing was decided or sent.</p>
          <a href={href} className="font-semibold text-ink underline underline-offset-2">
            Open in the approvals page
          </a>
        </>
      ) : (
        <>
          <p className="m-0 text-xs text-muted">Copy-only: nothing was sent. Check every figure before you use it.</p>
          <div>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(card.body).then(() => setCopied(true));
              }}
            >
              Copy
            </Button>
            {copied && (
              <span role="status" className="ml-2 text-xs text-muted">
                Copied
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Line({ line, role }: { line: DockLine; role: SpaRole }) {
  if (line.who === "you")
    return (
      <div className="max-w-[85%] self-end whitespace-pre-wrap rounded-[16px_16px_4px_16px] bg-raised px-3.5 py-2.5 text-sm leading-relaxed text-ink">
        <span className="sr-only">You: </span>
        {line.text}
      </div>
    );
  return (
    <div className="grid gap-2.5 text-sm leading-relaxed text-ink">
      <p className="m-0 whitespace-pre-wrap break-words">
        <span className="sr-only">Agent: </span>
        <Marked text={line.text} values={line.unverified} />
      </p>
      {line.tools.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Tools used">
          {line.tools.map((t, i) => (
            <li key={i} className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
              {chip(t.name)}
              {t.ok ? "" : " · refused"}
            </li>
          ))}
        </ul>
      )}
      {!line.verified && line.unverified.length > 0 && (
        <p className="m-0 text-xs text-warning">
          Unverified: {line.unverified.join(", ")} — not from a tool result of this answer. Check before you use it.
        </p>
      )}
      {line.proposals.map((p) => (
        <ProposalCard key={p.id} card={p} />
      ))}
      {line.drafts.map((d) => (
        <DraftCard key={d.id} card={d} role={role} />
      ))}
      <HowHandled line={line} />
    </div>
  );
}

/** The conversation as drawn: pure of any request, so a test can render any state of it. `empty` shows when there are no lines. */
export function DockView({ lines, role, empty }: { lines: DockLine[]; role: SpaRole; empty?: ReactNode }) {
  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Conversation"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-3.5"
    >
      {lines.length === 0 ? empty : lines.map((l, i) => <Line key={i} line={l} role={role} />)}
    </div>
  );
}

/** The panel body (log, empty state, composer), pure of any request: `.cp-chat` is where the frame focuses the box. */
export function DockBody({
  lines,
  role,
  draft,
  setDraft,
  busy,
  onSend,
  starters,
  box,
}: {
  lines: DockLine[];
  role: SpaRole;
  draft: string;
  setDraft: (v: string) => void;
  busy: boolean;
  onSend: (text: string) => void;
  starters: string[];
  box?: RefObject<HTMLTextAreaElement | null>;
}) {
  const submit = (e?: SyntheticEvent) => {
    e?.preventDefault();
    onSend(draft);
  };
  return (
    <div className="cp-chat flex min-h-0 flex-1 flex-col">
      <DockView
        lines={lines}
        role={role}
        empty={
          <div className="grid gap-2 text-sm text-muted">
            <h2 className="m-0 text-base font-semibold tracking-tight text-ink">What would you like to know?</h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {starters.slice(0, 4).map((t) => (
                <button key={t} type="button" className={STARTER_CHIP} disabled={busy} onClick={() => onSend(t)}>
                  {t}
                </button>
              ))}
            </div>
            <p className="m-0 mt-2 text-xs">
              It reads, drafts and proposes, using only what your role may see. It never approves, sends, signs or
              changes anything: a proposal runs only when you click Confirm. Please do not type passport or ID numbers.
            </p>
          </div>
        }
      />
      <ComposerCard
        onSubmit={submit}
        field={
          <>
            <label htmlFor="copilot-text" className="sr-only">
              Ask the agent
            </label>
            <textarea
              id="copilot-text"
              ref={box}
              rows={1}
              maxLength={2000}
              value={draft}
              placeholder="Ask the agent"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) submit(e);
              }}
              className={FIELD_BARE}
            />
          </>
        }
        send={
          <button
            type="submit"
            className={SEND_BTN}
            disabled={busy || !draft.trim()}
            aria-label={busy ? "Sending" : "Send"}
          >
            {busy ? (
              <span
                aria-hidden="true"
                className="size-3.5 animate-spin rounded-full border-2 border-on-cta/40 border-t-on-cta"
              />
            ) : (
              <ArrowUpIcon size={16} weight="bold" aria-hidden />
            )}
          </button>
        }
      />
    </div>
  );
}

interface ChatAnswer {
  reply: string;
  kind: string;
  verified: boolean;
  unverified: string[];
  tools: { name: string; ok: boolean }[];
  scope: { offTopic: boolean; probability: number } | null;
  proposals: ProposalLite[];
  drafts: DraftLite[];
}
const errorLine = (text: string): DockLine => ({
  who: "copilot",
  text,
  kind: "fallback",
  verified: true,
  unverified: [],
  tools: [],
  scope: null,
  proposals: [],
  drafts: [],
});
const failure = (status: number): string =>
  status === 429
    ? "You have sent a lot of messages. Try again in a while."
    : status === 401
      ? "Your session ended. Sign in again."
      : "The copilot isn't available right now.";

/**
 * The copilot dock (design.md §2, C36, S68), docked on the right. It reads, drafts and proposes; a proposal runs only when
 * the person clicks Confirm on its card. The browser talks to this site's own `/copilot/...` route, never to the engine.
 */
export function CopilotDock({ role }: { role: SpaRole }) {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams()?.toString() ?? "";
  const dock = useDockState({
    screen: screenOf(pathname),
    defaultOpen: (screen, width) => screen !== "inventory" && width >= DOCK_MIN_WIDTH,
  });
  const [lines, setLines] = useState<DockLine[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // The earlier conversation comes back after a reload (text only: a proposal card does not outlive its page).
  useEffect(() => {
    let live = true;
    fetch("/copilot/thread")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { messages?: { role: string; content: string; verified: boolean; unverified: string[] }[] } | null) => {
        if (!live || !b?.messages?.length) return;
        setLines(
          b.messages.map((m) =>
            m.role === "user"
              ? { who: "you" as const, text: m.content }
              : { ...errorLine(m.content), kind: "answer", verified: m.verified, unverified: m.unverified },
          ),
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setBusy(true);
    setLines((l) => [...l, { who: "you", text }]);
    setDraft("");
    let next: DockLine;
    try {
      const res = await fetch("/copilot/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const a = (await res.json()) as ChatAnswer;
        next = {
          who: "copilot",
          text: a.reply,
          kind: a.kind,
          verified: a.verified,
          unverified: a.unverified,
          tools: a.tools,
          scope: a.scope,
          proposals: a.proposals,
          drafts: a.drafts,
        };
      } else next = errorLine(failure(res.status));
    } catch {
      next = errorLine(failure(0));
    }
    setLines((l) => [...l, next]);
    setBusy(false);
  };
  return (
    <DockFrame
      state={dock}
      title="Agent"
      contextLabel="Anything"
      headerActions={
        <button
          type="button"
          className={DOCK_ICON_BTN}
          onClick={() => setLines([])}
          aria-label="New chat"
          title="Start a new conversation"
        >
          <PlusCircleIcon size={18} aria-hidden />
        </button>
      }
    >
      <DockBody
        lines={lines}
        role={role}
        draft={draft}
        setDraft={setDraft}
        busy={busy}
        onSend={(t) => void send(t)}
        starters={startersFor(role, search ? `${pathname}?${search}` : pathname)}
        box={box}
      />
    </DockFrame>
  );
}
