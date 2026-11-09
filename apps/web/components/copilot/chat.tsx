"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MicButton, useReadAloud } from "../voice/voice-controls";
import { useHasLocalVoice, useStored } from "../voice/use-voice";
import { type KeyboardEvent, type SyntheticEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ArrowUpIcon, CheckIcon as IconCheck, StopIcon, WarningIcon as IconWarning } from "@phosphor-icons/react";
import { Button, buttonClass } from "../ui/button";
import { CardRow } from "../chat-ui/cards";
import { Thinking } from "../chat-ui/thinking";
import { ChoiceCardView } from "../chat-ui/choice-card";
import { CardError, CardNote, CardShell, Facts } from "../chat-ui/card-shell";
import { SEND_BTN, StaffComposer, TOOL_BTN, VoiceMenu } from "../chat-ui/composer";
import { STAFF_PILLS } from "../chat-ui/quick-actions.ts";
import { roleLabel, shortDate } from "../../lib/format";
import { type ChatMessage, type DraftView, type PageRef, type ProposalView, useCopilotChat } from "./use-chat";

/**
 * Suggestions on an empty chat, grouped by what the copilot can do: ask (reads), draft (saved for
 * you to send) and prepare (a proposal you confirm). A suggestion ending in "…" is put in the box
 * for you to finish instead of being sent.
 */
type Starter = { text: string; kind: "ask" | "draft" | "prepare" };
const ask = (text: string): Starter => ({ text, kind: "ask" });
const draft = (text: string): Starter => ({ text, kind: "draft" });
const prepare = (text: string): Starter => ({ text, kind: "prepare" });
const STARTERS: Record<PageRef["kind"] | "none" | "settings" | "kyc", Starter[]> = {
  lease: [
    ask("Why is this lease waiting?"),
    ask("What is the contract and Ejari status?"),
    ask("Which contract rules and clauses apply to this lease?"),
    ask("What happened on this lease so far?"),
    draft("Draft an email to the tenant about…"),
    prepare("Prepare the contract for this lease"),
    prepare("Resend the signing link to…"),
    prepare("Create a task to…"),
  ],
  unit: [
    ask("Is this unit available, and what rent range is allowed?"),
    ask("Which rent rule and Smart Rental Index value set this unit's band?"),
    ask("Which applications are on this unit?"),
    prepare("Book a site visit of this unit for…"),
  ],
  approval: [
    ask("Explain this approval and what it's based on."),
    ask("Which contract checks passed, and which clauses did the agent choose?"),
    ask("What happens after it's approved?"),
    draft("Draft a note on this approval saying…"),
  ],
  none: [
    ask("How many applications are in each stage?"),
    ask("Which contracts are waiting for approval?"),
    ask("Which contracts are waiting for a signature?"),
    ask("Which contracts couldn't be prepared, and why?"),
    ask("What is pending at Ejari?"),
    ask("Show offers waiting on applicants"),
    prepare("Prepare the contract for lease…"),
    prepare("Resend the signing link for lease…"),
    prepare("Add a clause to the contract of…"),
    draft("Draft an email to the applicant of…"),
  ],
  settings: [
    ask("What contract rules, rent rules and clauses does each company have?"),
    ask("How do rent rules and the Smart Rental Index work together?"),
    ask("Which Smart Rental Index values are recorded?"),
    prepare("Add a clause to the contract of…"),
    prepare("Set the residential rent band of…"),
    prepare("Change the residential contract rule of…"),
    prepare("Add a Smart Rental Index value of AED "),
  ],
  kyc: [
    ask("What KYC checks does each company run on each document?"),
    ask("What is the difference between a warning and a blocker?"),
    ask("Which KYC checks email the applicant automatically?"),
    prepare("Make the passport valid this many days after the lease starts for…"),
    prepare("Add a required custom document to the applicant form of…"),
    prepare("Make a KYC check a blocker that emails the applicant for…"),
    prepare("Publish the KYC draft of…"),
  ],
};
const CHIP =
  "cursor-pointer rounded-full border border-line bg-page px-3 py-1.5 text-left font-sans text-[12.5px] leading-snug text-ink hover:border-ink data-[kind=draft]:border-dashed data-[kind=prepare]:border-dashed";
const MAX_CHIPS = 4;
/** At most four chips, mixing the kinds (questions first, then one draft and one prepare) so the row stays short. */
function pickChips(groups: { kind: Starter["kind"]; list: Starter[] }[]): { kind: Starter["kind"]; text: string }[] {
  const by = (k: Starter["kind"]) => groups.find((g) => g.kind === k)?.list ?? [];
  const asks = by("ask");
  const picked = [...asks.slice(0, 2), ...by("draft").slice(0, 1), ...by("prepare").slice(0, 1)];
  const rest = [...asks.slice(2), ...by("draft").slice(1), ...by("prepare").slice(1)];
  return [...picked, ...rest].slice(0, MAX_CHIPS).map((x) => ({ kind: x.kind, text: x.text }));
}
const isPrefill = (t: string) => t.endsWith("…") || t.endsWith(" ");
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
  viewing_invite: "Site visit invitation",
  request_documents: "Document request",
  resend_signing_link: "Signing link",
  prepare_contract: "Prepare contract",
  config_change: "Settings change",
};

const CHANGE_TITLE: Record<string, string> = {
  add_clause: "Add a contract clause",
  rent_rule: "Rent rule",
  contract_rule: "Contract rule",
  sri_value: "Smart Rental Index value",
  kyc_config: "Documents & KYC settings (draft)",
};

/** Settings tools: after one runs (or its card is confirmed) the page behind the panel is refreshed. */
const SETTINGS_TOOLS = new Set([
  "add_contract_clause",
  "save_rent_rule",
  "save_contract_rule",
  "save_sri_value",
  "edit_kyc_config",
]);

const CONFIRM_NOTE: Record<ProposalView["kind"], string> = {
  create_application: "Confirming creates the application and emails the site visit invitation.",
  create_task: "Confirming adds the task to the lease.",
  request_approval: "Confirming sends it to the approver's inbox. Nothing reaches the tenant until it is approved.",
  viewing_invite: "Confirming books the site visit and emails the applicant the invitation.",
  request_documents: "Confirming emails the applicant a new upload link; the old link stops working.",
  resend_signing_link: "Confirming emails the signer a new signing link; the old link stops working.",
  prepare_contract:
    "Confirming prepares the contract only. It then waits for a person to approve it in the inbox (final contract); nothing is sent.",
  config_change: "Confirming saves this to the company's settings, as the settings form would, in your name.",
};

const GROUND: Record<string, string> = {
  sale: "Sale",
  own_use: "Landlord's own use",
  major_works: "Major works",
  demolition: "Demolition",
};

/** What the proposal would do, per kind. */
function ProposalFacts({ p }: { p: ProposalView }) {
  if (p.kind === "config_change") {
    const s = p.summary;
    return (
      <Facts>
        <dt>Change</dt>
        <dd>{CHANGE_TITLE[s.change] ?? s.change}</dd>
        {s.company && (
          <>
            <dt>Company</dt>
            <dd>{s.company}</dd>
          </>
        )}
        {(s.facts ?? []).map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </Facts>
    );
  }
  if (p.kind === "create_application") {
    const s = p.summary;
    return (
      <Facts>
        <dt>Unit</dt>
        <dd>
          {s.unitCode}, {s.unit} · {s.askingRent} a year
        </dd>
        <dt>Applicant</dt>
        <dd>
          {s.applicant} · {s.email}
        </dd>
        <dt>Site visit</dt>
        <dd>{s.viewingLabel} (Dubai)</dd>
      </Facts>
    );
  }
  if (p.kind === "create_task") {
    const s = p.summary;
    return (
      <Facts>
        <dt>Lease</dt>
        <dd className="font-mono text-xs">{s.leaseRef}</dd>
        <dt>Task</dt>
        <dd>{s.title}</dd>
        <dt>For</dt>
        <dd>
          {roleLabel(s.assigneeRole)}
          {s.dueOn ? `, by ${shortDate(s.dueOn)}` : ""}
        </dd>
      </Facts>
    );
  }
  if (p.kind === "viewing_invite" || p.kind === "request_documents") {
    const s = p.summary;
    return (
      <Facts>
        <dt>Application</dt>
        <dd className="font-mono text-xs">{s.applicationRef}</dd>
        <dt>Applicant</dt>
        <dd>
          {s.applicant} · {s.unitCode}
        </dd>
        {p.kind === "viewing_invite" && (
          <>
            <dt>Site visit</dt>
            <dd>{p.summary.viewingLabel} (Dubai)</dd>
          </>
        )}
        <dt>Email</dt>
        <dd>
          {p.kind === "viewing_invite" ? "Invitation goes to the applicant" : "Upload link goes to the applicant"}
        </dd>
      </Facts>
    );
  }
  if (p.kind === "resend_signing_link" || p.kind === "prepare_contract") {
    const s = p.summary;
    return (
      <Facts>
        <dt>Lease</dt>
        <dd className="font-mono text-xs">
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
      </Facts>
    );
  }
  const s = p.summary;
  return s.gate === "formal_reminder" ? (
    <Facts>
      <dt>Gate</dt>
      <dd>Formal late-payment reminder</dd>
      <dt>Lease</dt>
      <dd className="font-mono text-xs">{s.leaseRef}</dd>
      <dt>Payment</dt>
      <dd>
        Instalment {s.instalment}, {s.amount}, due {shortDate(s.dueOn)} ({s.status})
      </dd>
    </Facts>
  ) : (
    <Facts>
      <dt>Gate</dt>
      <dd>12-month repossession notice</dd>
      <dt>Lease</dt>
      <dd className="font-mono text-xs">{s.leaseRef}</dd>
      <dt>Ground</dt>
      <dd>{GROUND[s.ground] ?? s.ground}</dd>
      <dt>Served</dt>
      <dd>
        {shortDate(s.servedOn)} by {s.deliveryMethod.replace("_", " ")}
      </dd>
    </Facts>
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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: "confirm" | "cancel") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/copilot/proposals/${p.id}/${action}`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as (ProposalView & { error?: string; code?: string }) | null;
      if (res.ok && body) {
        onChange(body);
        if (p.kind === "config_change" && body.status === "confirmed") router.refresh();
      } else {
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
    <CardShell
      title={PROPOSAL_TITLE[p.kind]}
      status={PROPOSAL_STATUS[p.status]}
      tone={p.status === "confirmed" ? "accent" : p.status === "pending" ? "waiting" : "neutral"}
    >
      <ProposalFacts p={p} />
      {p.status === "pending" && (
        <>
          <CardNote>
            {p.kind === "config_change" && p.summary.change === "kyc_config"
              ? "Confirming saves this to the company's KYC draft in your name. Applicants keep the live version until the draft is published."
              : CONFIRM_NOTE[p.kind]}
          </CardNote>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void act("confirm")}>
              Confirm
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act("cancel")}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {p.status === "confirmed" && p.kind === "create_application" && p.result?.applicationId && (
        <CardNote>
          <IconCheck size={13} /> Application{" "}
          <a className="link" href={`/work?kind=application&id=${p.result.applicationId}`}>
            {p.result.ref ?? "created"}
          </a>
          ; the invitation is on its way.
        </CardNote>
      )}
      {p.status === "confirmed" && p.result?.taskId && (
        <CardNote>
          <IconCheck size={13} /> Task added.{" "}
          <Link className="link" href="/tasks?for=all">
            Open tasks
          </Link>
        </CardNote>
      )}
      {p.status === "confirmed" && p.kind === "request_approval" && p.result?.approvalId && (
        <CardNote>
          <IconCheck size={13} /> Sent for approval.{" "}
          <Link className="link" href={`/work?approval=${p.result.approvalId}`}>
            Open in the inbox
          </Link>
        </CardNote>
      )}
      {p.status === "confirmed" && p.result?.applicationId && p.kind !== "create_application" && (
        <CardNote>
          <IconCheck size={13} /> Done; the email is on its way.{" "}
          <a className="link" href={`/work?kind=application&id=${p.result.applicationId}`}>
            Open the application
          </a>
        </CardNote>
      )}
      {p.status === "confirmed" && p.kind === "resend_signing_link" && (
        <CardNote>
          <IconCheck size={13} /> Done; the new signing link is on its way.
        </CardNote>
      )}
      {p.status === "confirmed" && p.kind === "prepare_contract" && p.result?.approvalId && (
        <CardNote>
          <IconCheck size={13} /> Contract prepared. It still needs a person's approval:{" "}
          <Link className="link" href={`/work?approval=${p.result.approvalId}`}>
            open it in the inbox
          </Link>
        </CardNote>
      )}
      {p.status === "confirmed" && p.kind === "config_change" && (
        <CardNote>
          <IconCheck size={13} /> {p.result?.summary ?? "Saved"}.{" "}
          <Link
            className="link"
            href={
              p.summary.change === "sri_value"
                ? "/settings/rent-index"
                : p.summary.change === "rent_rule"
                  ? "/settings/rent-rules"
                  : p.summary.change === "kyc_config"
                    ? "/settings/kyc"
                    : "/settings/contracts"
            }
          >
            Open settings
          </Link>
        </CardNote>
      )}
      {p.status === "failed" && p.result?.error && <CardError>{p.result.error}</CardError>}
      {error && p.status !== "failed" && <CardError>{error}</CardError>}
    </CardShell>
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
    <CardShell
      title={
        d.kind === "email"
          ? `Draft email${d.applicationRef ? ` to applicant · ${d.applicationRef}` : d.leaseRef ? ` · ${d.leaseRef}` : ""}`
          : d.kind === "case_summary"
            ? `Draft case summary${d.leaseRef ? ` · ${d.leaseRef}` : ""}`
            : "Draft approval note"
      }
      status={d.status === "used" ? "Used" : "Not sent"}
      tone={d.status === "used" ? "accent" : "neutral"}
    >
      {d.subject && <p className="m-0 break-words text-sm font-semibold">{d.subject}</p>}
      <p className="m-0 max-h-[180px] overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted">{d.body}</p>
      {d.status === "draft" && (
        <div className="flex gap-2">
          <Link className={buttonClass("ghost", "sm")} href={href}>
            {d.kind === "email"
              ? "Open in the email form"
              : d.kind === "case_summary"
                ? "Open on the lease"
                : "Open in the approval"}
          </Link>
        </div>
      )}
    </CardShell>
  );
}

function Message({
  m,
  onProposal,
  live,
  onSend,
  onOther,
  retryText,
}: {
  m: ChatMessage;
  onProposal: (v: ProposalView) => void;
  /** The latest answer, with nothing running: its choices can be tapped. */
  live: boolean;
  onSend: (text: string) => void;
  onOther: () => void;
  /** The user message this answer replied to, so a failed answer can be asked again. */
  retryText?: string;
}) {
  if (m.role === "user")
    return (
      <div className="max-w-[85%] self-end whitespace-pre-wrap rounded-[16px_16px_4px_16px] bg-raised px-3.5 py-2.5 text-sm leading-relaxed text-ink">
        {m.content}
      </div>
    );
  return (
    <AssistantMessage
      m={m}
      onProposal={onProposal}
      live={live}
      onSend={onSend}
      onOther={onOther}
      {...(retryText ? { retryText } : {})}
    />
  );
}

function AssistantMessage({
  m,
  onProposal,
  live,
  onSend,
  onOther,
  retryText,
}: {
  m: ChatMessage;
  onProposal: (v: ProposalView) => void;
  live: boolean;
  onSend: (text: string) => void;
  onOther: () => void;
  retryText?: string;
}) {
  const [startedAt] = useState(() => performance.now());
  return (
    <div className="grid gap-2.5 text-sm leading-relaxed" data-status={m.status} aria-busy={m.status === "streaming"}>
      <Thinking
        tools={m.tools}
        streaming={m.status === "streaming"}
        startedAt={startedAt}
        answerStarted={m.content.length > 0}
      />
      {m.status === "error" ? (
        <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-danger">
          <IconWarning size={15} aria-hidden /> {m.content}
          {live && retryText ? (
            <Button variant="ghost" size="sm" onClick={() => onSend(retryText)}>
              Try again
            </Button>
          ) : null}
        </p>
      ) : m.content ? (
        <div className="[&>:last-child]:mb-0 [&_li+li]:mt-1 [&_p]:m-0 [&_p]:mb-2 [&_ul]:m-0 [&_ul]:mb-2 [&_ul]:pl-5">
          <Answer text={m.content} unverified={m.unverified} />
        </div>
      ) : null}
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
        <p className="m-0 flex items-start gap-1.5 text-xs text-warning">
          <IconWarning size={13} className="mt-0.5 flex-none" aria-hidden />{" "}
          {m.unverified.length === 1 ? "One value" : `${m.unverified.length} values`} in this answer didn&apos;t come
          from a tool result. Check before relying on {m.unverified.length === 1 ? "it" : "them"}.
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
  initialDraft,
  prefill,
  starters,
  layout,
}: {
  /** "dock": tighter spacing for the 380px column. Spacing only. */
  layout?: "dock";
  /** Text put in the message box (not sent) each time it arrives: the "Ask AI to …" buttons. */
  prefill?: { id: number; text: string } | undefined;
  /** Starter set for pages that aren't records (Settings). */
  starters?: "settings" | "kyc" | undefined;
  /** Text placed in the composer for the user to edit and send ("Ask AI to …" links). Never sent on its own. */
  initialDraft?: string | undefined;
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
  const [draft, setDraft] = useState(initialDraft?.slice(0, 2000) ?? "");
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
  const router = useRouter();
  // A settings change made straight from your words: show it on the page behind the panel.
  const changedKey =
    lastMsg?.role === "assistant" &&
    lastMsg.status === "done" &&
    lastMsg.tools.some((t) => SETTINGS_TOOLS.has(t.name) && t.status === "ok")
      ? lastMsg.id
      : null;
  useEffect(() => {
    if (changedKey) router.refresh();
  }, [changedKey, router]);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  const prefilled = useRef(0);
  useEffect(() => {
    if (!prefill || prefill.id === prefilled.current) return;
    prefilled.current = prefill.id;
    setDraft(prefill.text.slice(0, 2000));
    // After the panel's open transition, put the cursor at the end of the text.
    setTimeout(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 50);
  }, [prefill]);
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

  /** A starter ending in "…" or a space is put in the box for the user to finish instead of being sent. */
  const fill = (t: string) => {
    setDraft(t.endsWith("…") ? `${t.slice(0, -1)} ` : t);
    input.current?.focus();
  };
  const submit = (e?: SyntheticEvent) => {
    e?.preventDefault();
    if (!draft.trim() || chat.busy) return;
    void chat.send(draft);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) submit(e);
  };

  const starterButtons = (list: string[]) =>
    list.map((t) => (
      <button
        key={t}
        type="button"
        className={CHIP}
        data-kind={isPrefill(t) ? "prepare" : "ask"}
        onClick={() => (isPrefill(t) ? fill(t) : void chat.send(t))}
      >
        {t}
      </button>
    ));
  const empty = chat.messages.length === 0;
  const kinds = (suggestions ? [] : (["ask", "draft", "prepare"] as const)).map((kind) => ({
    kind,
    list: STARTERS[page?.kind ?? starters ?? "none"].filter((x) => x.kind === kind),
  }));

  return (
    <div className="cp-chat flex min-h-0 flex-1 flex-col" data-layout={layout}>
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-3.5"
        ref={log}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {empty ? (
          <div className="grid gap-2 text-sm text-muted">
            <h2 className="m-0 text-base font-semibold tracking-tight text-ink">
              {heading ?? "What would you like to know?"}
            </h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {suggestions && suggestions.length > 0 && starterButtons(suggestions.slice(0, MAX_CHIPS))}
              {pickChips(kinds).map(({ kind, text }) => (
                <button
                  key={text}
                  type="button"
                  className={CHIP}
                  data-kind={kind}
                  title={KIND_LABEL[kind]}
                  onClick={() => (isPrefill(text) ? fill(text) : void chat.send(text))}
                >
                  {text}
                </button>
              ))}
            </div>
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
              {...(chat.messages[i - 1]?.role === "user" ? { retryText: chat.messages[i - 1]!.content } : {})}
            />
          ))
        )}
      </div>
      <StaffComposer
        pills={STAFF_PILLS}
        pillsLabel="Quick questions"
        pillsDisabled={chat.busy}
        onPick={(p) => p.action.kind === "send" && void chat.send(p.action.text)}
        onSubmit={submit}
        field={
          <>
            <label htmlFor="cp-input" className="sr-only">
              Ask the leasing agent
            </label>
            <textarea
              id="cp-input"
              ref={input}
              rows={1}
              maxLength={2000}
              value={draft}
              placeholder="Ask the agent"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              className="max-h-36 min-h-6 w-full resize-none !rounded-none !border-0 !bg-transparent !p-0 font-sans text-sm leading-normal text-ink !shadow-none !outline-none [field-sizing:content] placeholder:text-muted focus:!shadow-none focus-visible:!shadow-none"
            />
          </>
        }
        tools={
          <>
            <MicButton endpoint="/api/voice/transcribe" onText={heard} disabled={chat.busy} className={TOOL_BTN} />
            <VoiceMenu
              auto={auto}
              setAuto={setAuto}
              read={read}
              setRead={setRead}
              canRead={canRead}
              buttonClassName={TOOL_BTN}
            />
          </>
        }
        send={
          chat.busy ? (
            <button type="button" className={SEND_BTN} onClick={chat.stop} aria-label="Stop">
              <StopIcon size={14} weight="fill" aria-hidden />
            </button>
          ) : (
            <button type="submit" className={SEND_BTN} disabled={!draft.trim()} aria-label="Ask">
              <ArrowUpIcon size={16} weight="bold" aria-hidden />
            </button>
          )
        }
      ></StaffComposer>
      {/* <p className="m-0 flex justify-between gap-3 px-4 pb-3.5 pt-1 text-xs text-muted">
        <span>The agent never approves, sends or changes a lease.</span>
        {chat.messages.length > 0 && !chat.busy && (
          <button
            type="button"
            className="flex-none cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 font-sans text-xs text-ink underline underline-offset-2"
            onClick={chat.reset}
          >
            New conversation
          </button>
        )}
      </p> */}
    </div>
  );
}
