"use client";

import Link from "next/link";
import { MicButton, useReadAloud } from "../voice/voice-controls";
import { useHasLocalVoice, useStored } from "../voice/use-voice";
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { IconCheck, IconSpark, IconWarning } from "../../lib/icons";
import { CardRow } from "../chat-ui/cards";
import { ChoiceCardView } from "../chat-ui/choice-card";
import { Composer, VoiceMenu } from "../chat-ui/composer";
import { STAFF_PILLS } from "../chat-ui/quick-actions.ts";
import { roleLabel, shortDate } from "../../lib/format";
import {
  type ChatMessage,
  type DraftView,
  type PageRef,
  type ProposalView,
  type ToolStep,
  useCopilotChat,
} from "./use-chat";

const TOOL_LABEL: Record<string, string> = {
  pipeline_summary: "Counted the pipeline",
  list_records: "Listed records",
  get_record: "Read a record",
  contract_status: "Checked the contract and Ejari",
  list_companies: "Listed companies",
  offer_choices: "Offered choices",
  search_entities: "Searched units and leases",
  get_lease: "Read the lease",
  get_lease_timeline: "Read the timeline",
  list_deadlines: "Checked deadlines",
  list_approvals: "Checked approvals",
  get_helper_run: "Read a helper run",
  list_outbound_messages: "Checked sent emails",
  explain_rule: "Looked up the rulebook",
  compute_renewal_cap: "Worked out the rent cap (rulebook)",
  find_available_units: "Checked available units and viewing slots",
  propose_application: "Prepared an application for you to confirm",
  list_payments: "Checked rent payments",
  list_tickets: "Checked maintenance tickets",
  create_task: "Prepared a task for you to confirm",
  propose_approval: "Prepared an approval request for you to confirm",
  draft_email: "Drafted an email for you to review",
  list_tasks: "Checked tasks",
  list_enquiries: "Checked enquiries",
  get_enquiry: "Read an enquiry",
  get_unit: "Looked up the unit and its price limits",
  viewing_slots: "Checked free viewing slots",
  propose_viewing_invite: "Prepared a viewing invitation for you to confirm",
  propose_request_documents: "Prepared a document request for you to confirm",
  propose_resend_signing_link: "Prepared a signing-link resend for you to confirm",
  propose_prepare_contract: "Prepared the contract preparation for you to confirm",
  draft_approval_note: "Drafted a note for you to review",
  get_case_pack: "Read the case pack",
  summarise_case: "Drafted a case summary for you to review",
};

/**
 * Suggestions on an empty chat, grouped by what the copilot can do: ask (reads), draft (saved for
 * you to send) and prepare (a proposal you confirm). A suggestion ending in "…" is put in the box
 * for you to finish instead of being sent.
 */
type Starter = { text: string; kind: "ask" | "draft" | "prepare" };
const ask = (text: string): Starter => ({ text, kind: "ask" });
const draft = (text: string): Starter => ({ text, kind: "draft" });
const prepare = (text: string): Starter => ({ text, kind: "prepare" });
const STARTERS: Record<PageRef["kind"] | "none", Starter[]> = {
  lease: [
    ask("Why is this lease waiting?"),
    ask("What happened on this lease so far?"),
    ask("What is the contract and Ejari status?"),
    draft("Draft an email to the tenant about…"),
    prepare("Create a task to…"),
  ],
  unit: [
    ask("Is this unit available for viewing, and at what rent?"),
    ask("Which applications are on this unit?"),
    prepare("Book a viewing of this unit for…"),
  ],
  approval: [
    ask("Explain this approval and what it's based on."),
    ask("What happens after it's approved?"),
    ask("Which rule applies here, and in which version?"),
    draft("Draft a note on this approval saying…"),
  ],
  none: [
    ask("How many applications are in each stage?"),
    ask("How many applications are in viewing?"),
    ask("Show offers waiting on applicants"),
    ask("Which contracts are waiting for a signature?"),
    ask("Which approvals are waiting?"),
    ask("Which units are available for viewing?"),
    ask("What can you help me with?"),
    draft("Draft an email to the applicant of…"),
    prepare("Book a viewing for a new applicant…"),
    prepare("Create a task to…"),
  ],
};
const KIND_LABEL: Record<Starter["kind"], string> = {
  ask: "Ask",
  draft: "Draft (you send it)",
  prepare: "Prepare (you confirm it)",
};

/** Highlights unverified values inside a line of answer text. */
function withMarks(text: string, unverified: string[]): ReactNode[] {
  if (!unverified.length) return [text];
  const esc = unverified.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${esc.join("|")})`, "g"));
  return parts.map((p, i) =>
    unverified.includes(p) ? (
      <mark
        key={i}
        className="unverified"
        title="Not found in this answer's tool results. Check it before relying on it."
      >
        {p}
      </mark>
    ) : (
      p
    ),
  );
}

/** Plain text with paragraphs and "-" / "•" / "1." lists; **bold** kept as bold. No HTML from the model. */
function Answer({ text, unverified }: { text: string; unverified: string[] }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (line: string, key: number) => (
    <span key={key}>
      {line
        .split(/(\*\*[^*]+\*\*)/g)
        .map((seg, j) =>
          seg.startsWith("**") && seg.endsWith("**") ? (
            <strong key={j}>{withMarks(seg.slice(2, -2), unverified)}</strong>
          ) : (
            <span key={j}>{withMarks(seg, unverified)}</span>
          ),
        )}
    </span>
  );
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*([-•*]|\d+[.)])\s+/.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-•*]|\d+[.)])\s+/, ""), j)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{lines.map((l, j) => (j ? [<br key={`b${j}`} />, inline(l, j)] : inline(l, j)))}</p>;
      })}
    </>
  );
}

function Steps({ tools }: { tools: ToolStep[] }) {
  if (!tools.length) return null;
  return (
    <ul className="cp-steps" aria-label="What the copilot looked at">
      {tools.map((t) => (
        <li key={t.id} data-status={t.status}>
          {t.status === "ok" ? (
            <IconCheck size={13} />
          ) : t.status === "failed" ? (
            <IconWarning size={13} />
          ) : (
            <span className="cp-dot" />
          )}
          {t.status === "failed" ? `A step failed (${t.name})` : (TOOL_LABEL[t.name] ?? t.name)}
          {typeof t.args.lease === "string" && <span className="ref">{t.args.lease}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Engine codes that mark a proposal failed (the booking can't happen as proposed). */
const FAILED_CODES = new Set([
  "viewing_slot_taken",
  "unit_not_bookable",
  "viewing_in_past",
  "already_applied",
  "past_date",
  "not_overdue",
  "already_sent",
  "vacate_invalid",
  "not_running",
  "transition_not_allowed",
  "wrong_state",
  "no_open_signer",
  "contract_not_prepared",
  "stale",
]);

const PROPOSAL_TITLE: Record<ProposalView["kind"], string> = {
  create_application: "New application",
  create_task: "New task",
  request_approval: "Approval request",
  viewing_invite: "Viewing invitation",
  request_documents: "Document request",
  resend_signing_link: "Signing link",
  prepare_contract: "Prepare contract",
};

const CONFIRM_NOTE: Record<ProposalView["kind"], string> = {
  create_application: "Confirming creates the application and emails the viewing invitation.",
  create_task: "Confirming adds the task to the lease.",
  request_approval: "Confirming sends it to the approver's inbox. Nothing reaches the tenant until it is approved.",
  viewing_invite: "Confirming books the viewing and emails the applicant the invitation.",
  request_documents: "Confirming emails the applicant a new upload link; the old link stops working.",
  resend_signing_link: "Confirming emails the signer a new signing link; the old link stops working.",
  prepare_contract:
    "Confirming prepares the contract only. It then waits for a person to approve it in the inbox (final contract); nothing is sent.",
};

const GROUND: Record<string, string> = {
  sale: "Sale",
  own_use: "Landlord's own use",
  major_works: "Major works",
  demolition: "Demolition",
};

/** What the proposal would do, per kind. */
function ProposalFacts({ p }: { p: ProposalView }) {
  if (p.kind === "create_application") {
    const s = p.summary;
    return (
      <dl>
        <dt>Unit</dt>
        <dd>
          {s.unitCode}, {s.unit} · {s.askingRent} a year
        </dd>
        <dt>Applicant</dt>
        <dd>
          {s.applicant} · {s.email}
        </dd>
        <dt>Viewing</dt>
        <dd>{s.viewingLabel} (Dubai)</dd>
      </dl>
    );
  }
  if (p.kind === "create_task") {
    const s = p.summary;
    return (
      <dl>
        <dt>Lease</dt>
        <dd className="ref">{s.leaseRef}</dd>
        <dt>Task</dt>
        <dd>{s.title}</dd>
        <dt>For</dt>
        <dd>
          {roleLabel(s.assigneeRole)}
          {s.dueOn ? `, by ${shortDate(s.dueOn)}` : ""}
        </dd>
      </dl>
    );
  }
  if (p.kind === "viewing_invite" || p.kind === "request_documents") {
    const s = p.summary;
    return (
      <dl>
        <dt>Application</dt>
        <dd className="ref">{s.applicationRef}</dd>
        <dt>Applicant</dt>
        <dd>
          {s.applicant} · {s.unitCode}
        </dd>
        {p.kind === "viewing_invite" && (
          <>
            <dt>Viewing</dt>
            <dd>{p.summary.viewingLabel} (Dubai)</dd>
          </>
        )}
        <dt>Email</dt>
        <dd>
          {p.kind === "viewing_invite" ? "Invitation goes to the applicant" : "Upload link goes to the applicant"}
        </dd>
      </dl>
    );
  }
  if (p.kind === "resend_signing_link" || p.kind === "prepare_contract") {
    const s = p.summary;
    return (
      <dl>
        <dt>Lease</dt>
        <dd className="ref">
          {s.leaseRef} · {s.unitCode}
        </dd>
        {p.kind === "resend_signing_link" ? (
          <>
            <dt>Signer</dt>
            <dd>{p.kind === "resend_signing_link" && p.summary.signerName}</dd>
            <dt>Email</dt>
            <dd>New signing link goes to the {p.kind === "resend_signing_link" && p.summary.signerRole}</dd>
          </>
        ) : (
          <>
            <dt>Next</dt>
            <dd>Prepared only: it still waits for a person to approve it (final contract gate). No email goes out.</dd>
          </>
        )}
      </dl>
    );
  }
  const s = p.summary;
  return s.gate === "formal_reminder" ? (
    <dl>
      <dt>Gate</dt>
      <dd>Formal late-payment reminder</dd>
      <dt>Lease</dt>
      <dd className="ref">{s.leaseRef}</dd>
      <dt>Payment</dt>
      <dd>
        Instalment {s.instalment}, {s.amount}, due {shortDate(s.dueOn)} ({s.status})
      </dd>
    </dl>
  ) : (
    <dl>
      <dt>Gate</dt>
      <dd>12-month repossession notice</dd>
      <dt>Lease</dt>
      <dd className="ref">{s.leaseRef}</dd>
      <dt>Ground</dt>
      <dd>{GROUND[s.ground] ?? s.ground}</dd>
      <dt>Served</dt>
      <dd>
        {shortDate(s.servedOn)} by {s.deliveryMethod.replace("_", " ")}
      </dd>
    </dl>
  );
}

const PROPOSAL_STATUS: Record<ProposalView["status"], string> = {
  pending: "Waiting for your confirmation",
  confirmed: "Done",
  cancelled: "Cancelled",
  failed: "Couldn't be created",
  expired: "Expired: ask the copilot again",
};

/**
 * A proposed action (decisions D25, D26). Nothing exists until the user clicks Confirm here; the
 * engine then does it as the normal form would, as this user.
 */
function ProposalCard({ p, onChange }: { p: ProposalView; onChange: (v: ProposalView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: "confirm" | "cancel") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/copilot/proposals/${p.id}/${action}`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as (ProposalView & { error?: string; code?: string }) | null;
      if (res.ok && body) onChange(body);
      else {
        const message = body?.error ?? "Something went wrong.";
        setError(message.charAt(0).toUpperCase() + message.slice(1));
        // Only the engine's booking failures end the proposal; anything else can be retried.
        if (body?.code === "proposal_expired") onChange({ ...p, status: "expired" });
        else if (action === "confirm" && body?.code && FAILED_CODES.has(body.code))
          onChange({ ...p, status: "failed", result: { error: message } });
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cp-proposal" data-status={p.status}>
      <div className="cp-proposal-head">
        <strong>{PROPOSAL_TITLE[p.kind]}</strong>
        <span
          className="status"
          data-tone={p.status === "confirmed" ? "good" : p.status === "pending" ? "warn" : "quiet"}
        >
          {PROPOSAL_STATUS[p.status]}
        </span>
      </div>
      <ProposalFacts p={p} />
      {p.status === "pending" && (
        <>
          <p className="cp-proposal-note">{CONFIRM_NOTE[p.kind]}</p>
          <div className="cp-proposal-actions">
            <button type="button" className="btn primary small" disabled={busy} onClick={() => void act("confirm")}>
              Confirm
            </button>
            <button type="button" className="btn small" disabled={busy} onClick={() => void act("cancel")}>
              Cancel
            </button>
          </div>
        </>
      )}
      {p.status === "confirmed" && p.kind === "create_application" && p.result?.applicationId && (
        <p className="cp-proposal-note">
          <IconCheck size={13} /> Application{" "}
          <a className="link" href={`/work?kind=application&id=${p.result.applicationId}`}>
            {p.result.ref ?? "created"}
          </a>
          ; the invitation is on its way.
        </p>
      )}
      {p.status === "confirmed" && p.result?.taskId && (
        <p className="cp-proposal-note">
          <IconCheck size={13} /> Task added.{" "}
          <Link className="link" href="/tasks?for=all">
            Open tasks
          </Link>
        </p>
      )}
      {p.status === "confirmed" && p.kind === "request_approval" && p.result?.approvalId && (
        <p className="cp-proposal-note">
          <IconCheck size={13} /> Sent for approval.{" "}
          <Link className="link" href={`/work?approval=${p.result.approvalId}`}>
            Open in the inbox
          </Link>
        </p>
      )}
      {p.status === "confirmed" && p.result?.applicationId && p.kind !== "create_application" && (
        <p className="cp-proposal-note">
          <IconCheck size={13} /> Done; the email is on its way.{" "}
          <a className="link" href={`/work?kind=application&id=${p.result.applicationId}`}>
            Open the application
          </a>
        </p>
      )}
      {p.status === "confirmed" && p.kind === "resend_signing_link" && (
        <p className="cp-proposal-note">
          <IconCheck size={13} /> Done; the new signing link is on its way.
        </p>
      )}
      {p.status === "confirmed" && p.kind === "prepare_contract" && p.result?.approvalId && (
        <p className="cp-proposal-note">
          <IconCheck size={13} /> Contract prepared. It still needs a person's approval:{" "}
          <Link className="link" href={`/work?approval=${p.result.approvalId}`}>
            open it in the inbox
          </Link>
        </p>
      )}
      {p.status === "failed" && p.result?.error && <p className="cp-error">{p.result.error}</p>}
      {error && p.status !== "failed" && <p className="cp-error">{error}</p>}
    </div>
  );
}

/** A draft the copilot wrote (D26). It opens in the normal form, where the user edits and sends it. */
function DraftCard({ d }: { d: DraftView }) {
  const href =
    d.kind === "email" && d.applicationId
      ? `/work?kind=application&id=${d.applicationId}&draft=${d.id}#email`
      : d.kind === "email"
        ? `/work?kind=lease&id=${d.leaseId}&draft=${d.id}#email`
        : d.kind === "case_summary"
          ? `/work?kind=lease&id=${d.leaseId}&draft=${d.id}#case`
          : `/work?approval=${d.approvalId}&draft=${d.id}#notes`;
  return (
    <div className="cp-proposal" data-status={d.status}>
      <div className="cp-proposal-head">
        <strong>
          {d.kind === "email"
            ? `Draft email${d.applicationRef ? ` to applicant · ${d.applicationRef}` : d.leaseRef ? ` · ${d.leaseRef}` : ""}`
            : d.kind === "case_summary"
              ? `Draft case summary${d.leaseRef ? ` · ${d.leaseRef}` : ""}`
              : "Draft approval note"}
        </strong>
        <span className="status" data-tone={d.status === "used" ? "good" : "quiet"}>
          {d.status === "used" ? "Used" : "Not sent"}
        </span>
      </div>
      {d.subject && (
        <p className="cp-draft-subject">
          <b>{d.subject}</b>
        </p>
      )}
      <p className="cp-draft-body">{d.body}</p>
      {d.status === "draft" && (
        <div className="cp-proposal-actions">
          <Link className="btn small" href={href}>
            {d.kind === "email"
              ? "Open in the email form"
              : d.kind === "case_summary"
                ? "Open on the lease"
                : "Open in the approval"}
          </Link>
        </div>
      )}
    </div>
  );
}

function Message({
  m,
  onProposal,
  live,
  onSend,
  onOther,
}: {
  m: ChatMessage;
  onProposal: (v: ProposalView) => void;
  /** The latest answer, with nothing running: its choices can be tapped. */
  live: boolean;
  onSend: (text: string) => void;
  onOther: () => void;
}) {
  if (m.role === "user") return <div className="cp-msg cp-user">{m.content}</div>;
  return (
    <div className="cp-msg cp-assistant" data-status={m.status} aria-busy={m.status === "streaming"}>
      <Steps tools={m.tools} />
      {m.status === "error" ? (
        <p className="cp-error">
          <IconWarning size={15} /> {m.content}
        </p>
      ) : m.content ? (
        <div className="cp-answer">
          <Answer text={m.content} unverified={m.unverified} />
        </div>
      ) : (
        <p className="cp-thinking">{m.tools.length ? "Reading…" : "Thinking…"}</p>
      )}
      {m.cards?.length ? <CardRow cards={m.cards} disabled={!live} onSend={onSend} /> : null}
      {m.choices && m.status === "done" ? (
        <ChoiceCardView
          question={m.choices.question}
          options={m.choices.options.map((o) => ({ key: o.value, label: o.label, href: o.href }))}
          disabled={!live}
          onPick={(o) => {
            const say = m.choices?.options.find((x) => x.value === o.key)?.say;
            if (say) onSend(say);
          }}
          onOther={onOther}
        />
      ) : null}
      {m.proposals?.map((p) => (
        <ProposalCard key={p.id} p={p} onChange={onProposal} />
      ))}
      {m.drafts?.map((d) => (
        <DraftCard key={d.id} d={d} />
      ))}
      {m.status === "done" && m.unverified.length > 0 && (
        <p className="cp-unverified-note">
          <IconWarning size={13} /> {m.unverified.length === 1 ? "One value" : `${m.unverified.length} values`} in this
          answer didn&apos;t come from a tool result. Check before relying on{" "}
          {m.unverified.length === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}

export function CopilotChat({
  page,
  threadId,
  initial,
  autoFocus,
  onThread,
  heading,
  suggestions,
  ask,
}: {
  /** A question sent once when it arrives (for example the Workspace's "Draft a reply" button). */
  ask?: { id: number; text: string } | undefined;
  /** Home: a heading and ready-made questions replace the generic empty state. */
  heading?: string;
  suggestions?: string[];
  page?: PageRef | undefined;
  threadId?: string;
  initial?: ChatMessage[];
  autoFocus?: boolean;
  onThread?: (id: string) => void;
}) {
  const chat = useCopilotChat({ page, ...(threadId ? { threadId } : {}), ...(initial ? { initial } : {}) });
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const [auto, setAuto] = useStored("auto");
  const [read, setRead] = useStored("read");
  const canRead = useHasLocalVoice();
  const lastMsg = chat.messages.at(-1);
  useReadAloud(
    read && canRead,
    !chat.busy && lastMsg && lastMsg.role === "assistant" && lastMsg.content
      ? { key: lastMsg.id, text: lastMsg.content }
      : undefined,
  );
  /** A transcript lands in the field to edit and send; with auto-send it goes straight to the copilot. */
  const heard = (text: string) => {
    if (auto && !chat.busy) void chat.send(text);
    else setDraft((d) => `${d ? `${d} ` : ""}${text}`.slice(0, 2000));
  };
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  const asked = useRef(0);
  useEffect(() => {
    if (!ask || ask.id === asked.current || chat.busy) return;
    asked.current = ask.id;
    void chat.send(ask.text);
  }, [ask, chat]);
  // Follow the conversation as the answer streams in.
  const last = chat.messages.at(-1);
  const scrollKey = `${chat.messages.length}:${last?.content.length ?? 0}:${last?.tools.length ?? 0}`;
  useEffect(() => {
    if (scrollKey) log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [scrollKey]);
  useEffect(() => {
    if (chat.threadId) onThread?.(chat.threadId);
  }, [chat.threadId, onThread]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft.trim() || chat.busy) return;
    void chat.send(draft);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) submit(e as unknown as FormEvent);
  };

  return (
    <div className="cp-chat">
      <div className="cp-log" ref={log} role="log" aria-live="polite" aria-relevant="additions">
        {chat.messages.length === 0 ? (
          <div className="cp-empty">
            {heading ? (
              <h2 className="cp-heading">{heading}</h2>
            ) : (
              <>
                <span className="cp-mark" aria-hidden="true">
                  <IconSpark size={20} />
                </span>
                <p>
                  Ask about the pipeline: enquiries, viewings, offers, contracts and Ejari registration. Answers come
                  from the system.
                </p>
              </>
            )}
            {suggestions && suggestions.length > 0 && (
              <div className="cp-starters">
                {suggestions.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="cp-starter"
                    data-kind="ask"
                    onClick={() => void chat.send(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            {(suggestions ? [] : (["ask", "draft", "prepare"] as const)).map((kind) => {
              const list = STARTERS[page?.kind ?? "none"].filter((x) => x.kind === kind);
              return list.length ? (
                <div key={kind} className="cp-starter-group">
                  <span className="cp-starter-kind">{KIND_LABEL[kind]}</span>
                  <div className="cp-starters">
                    {list.map((x) => (
                      <button
                        key={x.text}
                        type="button"
                        className="cp-starter"
                        data-kind={kind}
                        onClick={() => {
                          if (x.text.endsWith("…")) {
                            setDraft(`${x.text.slice(0, -1)} `);
                            input.current?.focus();
                          } else void chat.send(x.text);
                        }}
                      >
                        {x.text}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null;
            })}
            <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              It never approves, sends, records payments or changes a lease: those stay with you.
            </p>
          </div>
        ) : (
          chat.messages.map((m, i) => (
            <Message
              key={m.id}
              m={m}
              onProposal={chat.updateProposal}
              live={!chat.busy && i === chat.messages.length - 1}
              onSend={(text) => void chat.send(text)}
              onOther={() => input.current?.focus()}
            />
          ))
        )}
      </div>
      <Composer
        pills={STAFF_PILLS}
        pillsLabel="Quick questions"
        pillsDisabled={chat.busy}
        onPick={(p) => p.action.kind === "send" && void chat.send(p.action.text)}
        onSubmit={submit}
        className="cp-composer"
      >
        <label htmlFor="cp-input" className="sr-only">
          Ask the copilot
        </label>
        <textarea
          id="cp-input"
          ref={input}
          rows={1}
          maxLength={2000}
          value={draft}
          placeholder="Ask a question…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <MicButton endpoint="/api/voice/transcribe" onText={heard} disabled={chat.busy} />
        <VoiceMenu auto={auto} setAuto={setAuto} read={read} setRead={setRead} canRead={canRead} />
        {chat.busy ? (
          <button type="button" className="btn small" onClick={chat.stop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn primary small" disabled={!draft.trim()}>
            Ask
          </button>
        )}
      </Composer>
      <p className="cp-foot">
        Reads the pipeline, drafts text for you to send, and prepares applications, tasks and approval requests you
        confirm. Approvals, sending and other changes happen in the app, by a person.
        {chat.messages.length > 0 && !chat.busy && (
          <button type="button" className="cp-link" onClick={chat.reset}>
            New conversation
          </button>
        )}
      </p>
    </div>
  );
}
