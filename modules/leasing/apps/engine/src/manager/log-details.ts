/**
 * The expanded view of one activity-log entry: a few labelled facts from the stored row. Pure functions over the
 * columns, so the log stays cheap to build. Only named fields are shown: payloads and proposals can hold personal
 * data (rule 8), so nothing is copied from them wholesale, and email recipients are never included.
 */

export interface LogDetail {
  label: string;
  value: string;
  /** How the web formats the value: a calendar date, a timestamp, an identifier, or money in fils. */
  format?: "date" | "datetime" | "code" | "fils";
}

const sentence = (s: string) => {
  const t = s.replaceAll("_", " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** "Agent (offer)" for helper:offer, the system for system, else the actor's kind. */
export function actorLabel(actor: string): string {
  const [prefix, rest = ""] = [actor.split(":")[0]!, actor.split(":").slice(1).join(":")];
  if (prefix === "helper") return rest ? `Agent (${rest.replaceAll("_", " ")})` : "Agent";
  if (prefix === "copilot") return "Agent (copilot)";
  if (prefix === "system") return "System";
  return sentence(prefix);
}

/** "timed:<id>:docs_chase#1@1" or "timed:<id>:sign_reminder:<id>#1" → "Docs chase, attempt 1". */
export function milestoneLabel(milestone: string): string {
  const [body = "", attempt] = milestone.split("@")[0]!.split("#");
  const name = body
    .split(":")
    .filter((p) => /^[a-z_]+$/i.test(p) && p !== "timed")
    .at(-1);
  if (!name) return milestone;
  return attempt ? `${sentence(name)}, attempt ${attempt}` : sentence(name);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function eventDetails(e: {
  type: string;
  actor: string;
  fromState: string | null;
  toState: string | null;
  rulesVersion: string | null;
  payload: unknown;
}): LogDetail[] {
  const out: LogDetail[] = [{ label: "Event", value: e.type, format: "code" }];
  out.push({ label: "Done by", value: actorLabel(e.actor) });
  if (e.fromState || e.toState)
    out.push({ label: "Stage", value: `${sentence(e.fromState ?? "—")} → ${sentence(e.toState ?? "—")}` });
  const p = (e.payload && typeof e.payload === "object" ? e.payload : {}) as Record<string, unknown>;
  if (typeof p.milestone === "string") out.push({ label: "Scheduled step", value: milestoneLabel(p.milestone) });
  if (typeof p.dueOn === "string" && DATE.test(p.dueOn)) out.push({ label: "Due on", value: p.dueOn, format: "date" });
  if (typeof p.revision === "number") out.push({ label: "Revision", value: String(p.revision) });
  if (typeof p.annualRentFils === "number")
    out.push({ label: "Annual rent", value: String(p.annualRentFils), format: "fils" });
  if (typeof p.reason === "string" && p.reason.length <= 300) out.push({ label: "Reason", value: p.reason });
  if (e.rulesVersion) out.push({ label: "Rules version", value: e.rulesVersion, format: "code" });
  return out;
}

export function approvalDetails(a: {
  gate: string;
  title: string;
  status: string;
  approverRole: string;
  reasons: string[] | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  rulesVersion: string | null;
}): LogDetail[] {
  const out: LogDetail[] = [
    { label: "Approval", value: a.title },
    { label: "Gate", value: a.gate, format: "code" },
    { label: "Status", value: sentence(a.status) },
    { label: "Approver", value: sentence(a.approverRole) },
  ];
  if (a.reasons?.length) out.push({ label: "Why it needs a person", value: a.reasons.join(" ") });
  if (a.decidedAt) out.push({ label: "Decided", value: a.decidedAt.toISOString(), format: "datetime" });
  if (a.decisionNote) out.push({ label: "Decision note", value: a.decisionNote });
  if (a.rulesVersion) out.push({ label: "Rules version", value: a.rulesVersion, format: "code" });
  return out;
}

export function emailDetails(m: {
  subject: string | null;
  template: string | null;
  purpose: string;
  status: string;
  error: string | null;
  sentAt: Date | null;
  acknowledgedAt: Date | null;
}): LogDetail[] {
  const out: LogDetail[] = [];
  if (m.subject) out.push({ label: "Subject", value: m.subject });
  out.push({ label: "Purpose", value: sentence(m.purpose) });
  if (m.template) out.push({ label: "Template", value: m.template, format: "code" });
  out.push({ label: "Status", value: sentence(m.status) });
  if (m.error) out.push({ label: "Error", value: m.error });
  if (m.sentAt) out.push({ label: "Sent", value: m.sentAt.toISOString(), format: "datetime" });
  if (m.acknowledgedAt) out.push({ label: "Acknowledged", value: m.acknowledgedAt.toISOString(), format: "datetime" });
  return out;
}

export function taskDetails(t: {
  title: string;
  kind: string;
  status: string;
  assigneeRole: string;
  dueOn: string | null;
}): LogDetail[] {
  const out: LogDetail[] = [
    { label: "Task", value: t.title },
    { label: "Kind", value: t.kind, format: "code" },
    { label: "Assigned to", value: sentence(t.assigneeRole) },
    { label: "Status", value: sentence(t.status) },
  ];
  if (t.dueOn) out.push({ label: "Due on", value: t.dueOn, format: "date" });
  return out;
}
