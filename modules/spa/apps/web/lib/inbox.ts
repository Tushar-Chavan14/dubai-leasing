import { AmlOutcome } from "@spa/core";

/** A button on a decision card: what it sends and the words on it (specs §7, design §4.4). */
export interface DecisionOption {
  decision: "approve" | "reject" | "aml";
  outcome?: AmlOutcome;
  label: string;
  tone: "primary" | "ghost" | "danger";
}

const APPROVE: Record<string, [string, string]> = {
  agreement_approval: ["Approve and send for signing", "Return with comment"],
  template_approval: ["Approve this version", "Return with comment"],
  settlement_approval: ["Approve the statement", "Return with comment"],
  oqood_submission: ["Approve and submit", "Return with comment"],
  transfer_submission: ["Approve and submit", "Return with comment"],
  cancellation: ["Approve the cancellation", "Keep the deal"],
  deposit_release: ["Approve the release", "Refuse the release"],
  refund: ["Approve the refund", "Refuse the refund"],
  helper_review: ["Looks right", "Doesn't look right"],
};

/** The outcomes of the compliance review (aml_flag), in the order of the engine's list. Only compliance roles are ever shown these. */
const REVIEW_OUTCOMES: DecisionOption[] = [
  { decision: "aml", outcome: "clear", label: "Clear", tone: "primary" },
  { decision: "aml", outcome: "more_info", label: "Ask for more information", tone: "ghost" },
  { decision: "aml", outcome: "stop", label: "Stop the deal", tone: "danger" },
  { decision: "aml", outcome: "stop_and_report", label: "Stop and report", tone: "danger" },
];

/** The buttons a gate offers. Whether to draw them is the engine's call (`mayDecide`), never this function's. */
export function decisionOptions(gate: string): DecisionOption[] {
  if (gate === "aml_flag") return REVIEW_OUTCOMES;
  const [yes, no] = APPROVE[gate] ?? ["Approve", "Reject"];
  return [
    { decision: "approve", label: yes, tone: "primary" },
    { decision: "reject", label: no, tone: "danger" },
  ];
}

export type DecisionBody =
  | { decision: "approve" | "reject"; note?: string }
  | { decision: "aml"; outcome: AmlOutcome; note?: string };

/**
 * The body of `POST /api/approvals/:id/decide` from a form: the decision, a note and an outcome, and nothing else. A
 * `role`, `actor` or `decidedBy` in the form is never read. A rejection and any outcome but "clear" need a note (the
 * engine checks too).
 */
export function buildDecisionBody(
  form: FormData,
): { ok: true; body: DecisionBody } | { ok: false; error: "decision" | "note" } {
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const note = text("note").slice(0, 2000);
  const decision = text("decision");
  if (decision === "approve") return { ok: true, body: { decision, ...(note ? { note } : {}) } };
  if (decision === "reject") return note ? { ok: true, body: { decision, note } } : { ok: false, error: "note" };
  if (decision === "aml") {
    const outcome = AmlOutcome.safeParse(text("outcome"));
    if (!outcome.success) return { ok: false, error: "decision" };
    if (outcome.data !== "clear" && !note) return { ok: false, error: "note" };
    return { ok: true, body: { decision, outcome: outcome.data, ...(note ? { note } : {}) } };
  }
  return { ok: false, error: "decision" };
}

/** Sends one request to the engine as the signed-in user (the server action passes its session; tests pass the real app). */
export type Send = (
  path: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ status: number }>;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records one decision: `POST /api/approvals/:id/decide` with the decision, a note and an outcome and nothing else. The
 * engine decides whether this person may (right role, not admin, not the proposer); a refusal is "refused" and
 * changes nothing. "signin" means the session ended.
 */
export async function submitDecision(
  send: Send,
  form: FormData,
): Promise<"done" | "decision" | "note" | "refused" | "signin"> {
  const id = form.get("id");
  if (typeof id !== "string" || !ID.test(id)) return "decision";
  const built = buildDecisionBody(form);
  if (!built.ok) return built.error;
  const res = await send(`/api/approvals/${id}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(built.body),
  }).catch(() => null);
  if (res?.status === 401) return "signin";
  return res && res.status >= 200 && res.status < 300 ? "done" : "refused";
}
