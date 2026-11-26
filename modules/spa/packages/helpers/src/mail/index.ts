/**
 * SPA mail templates (S54): fixed wording written by code, never by a model. Each returns the subject, a text body and
 * an html body. Subjects read "{Action} · {Property}" (design §7.6). Party-facing mail never mentions AML or a check:
 * a buyer only ever sees "under review" elsewhere, and these mails say nothing about it (tipping-off, S50).
 */
import { createHash } from "node:crypto";
import { formatCalendarDate, formatMoneyFils } from "@platform/readers/structure/format";
import { TOKENS } from "@platform/ui/tokens";
import { CHASE_ALLOWED_PLACEHOLDERS, CHASE_REASONS, type ChaseReasonCode } from "@spa/core";

/** Light palette of the design system (emails don't follow the reader's dark mode reliably). */
const C = TOKENS.light;

export type SpaMailTemplate =
  | "offer_answer_link"
  | "sign_link"
  | "sign_reminder"
  | "signed_copy"
  | "instalment_reminder"
  | "chase"
  | "party_question"
  | "listing_enquiry"
  | "lead_new"
  | "viewing_new"
  | "viewing_confirmation"
  | "viewing_reminder"
  | "viewing_cancelled"
  | "gate_alert"
  | "documents_request"
  | "transfer_booked"
  | "registered";
/** Bump a version when the wording changes: the stored evidence names the version that was sent. */
export const MAIL_TEMPLATE_VERSIONS: Readonly<Record<SpaMailTemplate, number>> = Object.freeze({
  offer_answer_link: 1,
  sign_link: 1,
  sign_reminder: 1,
  signed_copy: 1,
  instalment_reminder: 1,
  // A chase's version is its admin-approved template's own version (S60); this is the floor.
  chase: 1,
  party_question: 1,
  listing_enquiry: 1,
  lead_new: 1,
  viewing_new: 1,
  viewing_confirmation: 1,
  viewing_reminder: 1,
  viewing_cancelled: 1,
  gate_alert: 1,
  documents_request: 1,
  transfer_booked: 1,
  registered: 1,
});

export interface SpaMailParts {
  template: SpaMailTemplate;
  version: number;
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const date = (d: string): string => formatCalendarDate(d) ?? d;

function build(
  template: SpaMailTemplate,
  subject: string,
  lines: readonly string[],
  action?: { label: string; url: string },
): SpaMailParts {
  const text = [
    ...lines,
    ...(action ? ["", `${action.label}: ${action.url}`] : []),
    "",
    "This email was sent by the sales team.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:${C.canvas};font-family:'Plus Jakarta Sans',Arial,Helvetica,sans-serif;font-size:15px;color:${C.ink}">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
<div style="background:${C.page};border-radius:16px;padding:28px 24px;border:1px solid ${C.line};border-top:4px solid ${C.primary}">${lines
    .map((l) => (l ? `<p style="margin:0 0 14px;line-height:1.55">${esc(l)}</p>` : ""))
    .join("")}${
    action
      ? `<p style="margin:8px 0 0"><a href="${esc(action.url)}" style="display:inline-block;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;background:${C.cta};color:${C.onCta}">${esc(action.label)}</a></p>`
      : ""
  }</div>
<p style="font-size:12px;line-height:1.5;color:${C.muted};margin:16px 4px">This email was sent by the sales team.</p></div></body></html>`;
  return { template, version: MAIL_TEMPLATE_VERSIONS[template], subject, text, html };
}

/** A seller's single-use link to answer an offer (S18, S39). Terms only: never a buyer's name. */
export function offerAnswerLinkMail(i: {
  property: string;
  priceFils: number;
  validUntil: string;
  link: string;
}): SpaMailParts {
  return build(
    "offer_answer_link",
    `Answer the offer · ${i.property}`,
    [
      "You have received an offer for your property.",
      `Property: ${i.property}`,
      `Offer price: ${formatMoneyFils(i.priceFils)}`,
      `You can answer until ${date(i.validUntil)}.`,
      "The link below is personal and works once. Please do not forward it.",
    ],
    { label: "Review and answer the offer", url: i.link },
  );
}

/** A signer's single-use link to read and sign the approved agreement (S54). */
export function signLinkMail(i: {
  name: string;
  document: string;
  property: string;
  link: string;
  expiresOn: string;
}): SpaMailParts {
  return build(
    "sign_link",
    `Sign your ${i.document} · ${i.property}`,
    [
      `Dear ${i.name},`,
      `Your ${i.document} for ${i.property} has been approved and is ready for your signature.`,
      `Open the link, read the document, type your full name and confirm. The link works once and expires on ${date(i.expiresOn)}.`,
      "Please do not forward it.",
    ],
    { label: "Read and sign", url: i.link },
  );
}

/** A reminder carries no link: the link exists only in the first email, so a lost one is asked for again. */
export function signReminderMail(i: {
  name: string;
  document: string;
  property: string;
  sentOn: string;
}): SpaMailParts {
  return build("sign_reminder", `Reminder: sign your ${i.document} · ${i.property}`, [
    `Dear ${i.name},`,
    `Your ${i.document} for ${i.property} is still waiting for your signature.`,
    `Please use the signing link we emailed you on ${date(i.sentOn)}. If you cannot find it, ask your agent to send a new one.`,
  ]);
}

/** The signed copy, sent with the PDF attached, once everyone has signed. */
export function signedCopyMail(i: { name: string; document: string; property: string }): SpaMailParts {
  return build("signed_copy", `Your signed ${i.document} · ${i.property}`, [
    `Dear ${i.name},`,
    `Everyone has signed the ${i.document} for ${i.property}. Your signed copy is attached.`,
    "Please keep it for your records.",
  ]);
}

/**
 * A buyer's reminder of a dated instalment (S56): before the due date, or the day after it when no payment is recorded.
 * Fixed wording; the amount (integer fils) and the date come from the payment plan and the Clock, never from a model. It
 * says nothing about checks or reviews. With `link` (C35, S67) it carries the buyer's read-only status link.
 */
export function instalmentReminderMail(i: {
  name: string;
  property: string;
  label: string;
  amountFils: number;
  dueOn: string;
  phase: "before" | "after";
  link?: string;
}): SpaMailParts {
  const amount = formatMoneyFils(i.amountFils);
  const action = i.link ? { label: "See your payment plan", url: i.link } : undefined;
  if (i.phase === "before")
    return build(
      "instalment_reminder",
      `Instalment due ${date(i.dueOn)} · ${i.property}`,
      [
        `Dear ${i.name},`,
        `This is a reminder that your instalment "${i.label}" for ${i.property} is due on ${date(i.dueOn)}.`,
        `Amount due: ${amount}.`,
        "If you have already paid, please send your payment receipt to your agent.",
      ],
      action,
    );
  return build(
    "instalment_reminder",
    `Instalment overdue · ${i.property}`,
    [
      `Dear ${i.name},`,
      `Your instalment "${i.label}" for ${i.property} was due on ${date(i.dueOn)} and we have not yet recorded a payment.`,
      `Amount outstanding: ${amount}.`,
      "If you have already paid, please send your payment receipt to your agent. Otherwise please contact your agent.",
    ],
    action,
  );
}

/** A party's single-use link to upload documents (C35, S67). It lists the documents by name and nothing about any check. */
export function documentsRequestMail(i: {
  name: string;
  property: string;
  items: readonly string[];
  link: string;
  expiresOn: string;
}): SpaMailParts {
  return build(
    "documents_request",
    `Upload your documents · ${i.property}`,
    [
      `Dear ${i.name},`,
      `To go ahead with ${i.property} we need these documents from you: ${i.items.join(", ")}.`,
      `Open the link, upload each one, then choose "Send my documents". The link works until you send them, and expires on ${date(i.expiresOn)}.`,
      "Please do not forward it.",
    ],
    { label: "Upload your documents", url: i.link },
  );
}

/** The transfer day is booked (C35, S67): the date, and the read-only status link. */
export function transferBookedMail(i: {
  name: string;
  property: string;
  transferOn: string;
  link: string;
}): SpaMailParts {
  return build(
    "transfer_booked",
    `Transfer booked · ${i.property}`,
    [
      `Dear ${i.name},`,
      `The transfer for ${i.property} is planned for ${date(i.transferOn)}.`,
      "Your agent will confirm the details with you. The date can change.",
    ],
    { label: "See where things stand", url: i.link },
  );
}

/** The sale is registered (C35, S67). */
export function registeredMail(i: { name: string; property: string; link: string }): SpaMailParts {
  return build(
    "registered",
    `Registered · ${i.property}`,
    [
      `Dear ${i.name},`,
      `Good news: the registration for ${i.property} is complete.`,
      "You can follow what comes next on your status page.",
    ],
    { label: "See where things stand", url: i.link },
  );
}

export interface ChaseTemplateText {
  /** The approved template's version: the stored evidence names it. */
  version: number;
  subject: string;
  body: string;
}
export interface ChaseMailValues {
  partyName: string;
  property: string;
  agentName: string;
  agentEmail: string;
  companyName: string;
  /** One line each: the document and a reason from the fixed list (S23, S60). */
  items: readonly { label: string; reason: ChaseReasonCode }[];
}

/**
 * A chase for a party (S23, S60): the admin-approved template with its placeholders filled by code, in one pass, so a value
 * can't bring a placeholder in. Each item's reason is a code from `CHASE_REASONS`; the neutral reason prints alone, with no
 * document name, so a review is never hinted at. A template with a placeholder code can't fill is refused, never sent
 * half filled. No model writes any of it.
 */
export function fillChaseMail(t: ChaseTemplateText, v: ChaseMailValues): SpaMailParts {
  const items = v.items
    .map((i) =>
      i.reason === "additional_documents"
        ? `- ${CHASE_REASONS.additional_documents}`
        : `- ${i.label}: ${CHASE_REASONS[i.reason]}`,
    )
    .join("\n");
  const values: Record<(typeof CHASE_ALLOWED_PLACEHOLDERS)[number], string> = {
    party_name: v.partyName,
    property: v.property,
    items,
    agent_name: v.agentName,
    agent_email: v.agentEmail,
    company_name: v.companyName,
  };
  const fill = (text: string): string =>
    text.replace(/\{([^{}]*)\}/g, (_m, name: string) => {
      if (!Object.hasOwn(values, name)) throw new Error(`the template holds {${name}}, which code can't fill`);
      return values[name as keyof typeof values];
    });
  const subject = fill(t.subject);
  const lines = fill(t.body).split("\n");
  return { ...build("chase", subject, lines), version: t.version };
}

/** The hash a stored chase keeps: the formula the outbound row's `body_sha256` uses (text, a newline, then html). */
export const chaseBodyHash = (m: Pick<SpaMailParts, "text" | "html">): string =>
  createHash("sha256").update(`${m.text}\n${m.html}`).digest("hex");

/**
 * A buyer's or seller's question for their agent, from the party assistant's `contact_agent` (S24, S61). The question is
 * the party's own message, word for word; everything else is fixed wording. Sent to staff, never to the party.
 */
export function partyQuestionMail(i: {
  ref: string;
  property: string;
  role: "buyer" | "seller";
  partyName: string;
  question: string;
}): SpaMailParts {
  return build("party_question", `Question from a ${i.role} · ${i.property}`, [
    `${i.partyName} (${i.role}) asked from the portal chat about ${i.property} (${i.ref}):`,
    i.question,
    "Please reply to them by email. This message was typed by the person above; nothing in it was written by an assistant.",
  ]);
}

/**
 * A visitor's enquiry about a published listing, from the listing chat's `send_enquiry` (S24, S61). The message is the
 * visitor's own words; they ticked consent to be contacted at this address.
 */
export function listingEnquiryMail(i: {
  listingRef: string;
  title: string;
  name: string;
  email: string;
  message: string;
}): SpaMailParts {
  return build("listing_enquiry", `Enquiry · ${i.title || i.listingRef}`, [
    `${i.name} (${i.email}) sent an enquiry about ${i.title || i.listingRef} (${i.listingRef}) from the listing page chat. They agreed to be contacted by email.`,
    i.message,
    "Please reply to them by email. This message was typed by the visitor; nothing in it was written by an assistant.",
  ]);
}

/**
 * A staff alert for a gate that has waited past its threshold (S30, S62). The sentence is `alertText` from `@spa/core`: the
 * gate label, the deal ref and the hours, nothing else; a compliance gate's is the one generic sentence and carries no ref.
 */
export function gateAlertMail(i: { text: string; dealRef: string | null; url: string }): SpaMailParts {
  return build("gate_alert", `Waiting for you${i.dealRef ? ` · ${i.dealRef}` : ""}`, [i.text], {
    label: "Open the sales app",
    url: i.url,
  });
}

/** A viewing time as Dubai wall time: "Mon 2 Nov 2026, 10:30 (Dubai)". Pure; the instant comes from the stored row. */
export function dubaiTimeLabel(iso: Date | string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${text
    .replace(",", "")
    .replace(/^(\w+) /, "$1 ")
    .replace(/(\d{4}) /, "$1, ")} (Dubai)`;
}

/**
 * A new enquiry for the agent (S79). The message is the visitor's own words; they agreed to be contacted. Sent to staff
 * only. The visitor's phone, when given, is part of the contact details the agent needs to call back.
 */
export function leadNewMail(i: {
  leadRef: string;
  property: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  url: string;
}): SpaMailParts {
  return build(
    "lead_new",
    `New enquiry · ${i.property}`,
    [
      `${i.name} (${i.email}${i.phone ? `, ${i.phone}` : ""}) wrote about ${i.property}. Lead ${i.leadRef}. They agreed to be contacted.`,
      i.message,
      "This message was typed by the visitor; nothing in it was written by an assistant.",
    ],
    { label: "Open the lead", url: i.url },
  );
}

/** A new booked viewing for the agent (S79). */
export function viewingNewMail(i: {
  leadRef: string;
  property: string;
  name: string;
  email: string;
  phone: string | null;
  startsAt: Date | string;
  /** What the visitor wrote with the booking, in their own words (null: nothing). */
  message?: string | null;
  url: string;
}): SpaMailParts {
  return build(
    "viewing_new",
    `New viewing · ${i.property}`,
    [
      `${i.name} (${i.email}${i.phone ? `, ${i.phone}` : ""}) booked a viewing of ${i.property} for ${dubaiTimeLabel(i.startsAt)}. Lead ${i.leadRef}. They agreed to be contacted.`,
      ...(i.message
        ? [i.message, "This message was typed by the visitor; nothing in it was written by an assistant."]
        : []),
    ],
    { label: "Open the lead", url: i.url },
  );
}

/** The visitor's booking confirmation, with the single-use cancel link (S79). Fixed wording. */
export function viewingConfirmationMail(i: {
  name: string;
  property: string;
  startsAt: Date | string;
  cancelUrl: string;
}): SpaMailParts {
  return build(
    "viewing_confirmation",
    `Your viewing is booked · ${i.property}`,
    [
      `Hello ${i.name},`,
      `Your viewing of ${i.property} is booked for ${dubaiTimeLabel(i.startsAt)}.`,
      "Our agent will meet you there. If you can't come, please cancel with the link below so the time goes to someone else.",
    ],
    { label: "Cancel this viewing", url: i.cancelUrl },
  );
}

/** The reminder the day before (S79). */
export function viewingReminderMail(i: {
  name: string;
  property: string;
  startsAt: Date | string;
  cancelUrl: string;
}): SpaMailParts {
  return build(
    "viewing_reminder",
    `Reminder: your viewing · ${i.property}`,
    [
      `Hello ${i.name},`,
      `This is a reminder that your viewing of ${i.property} is at ${dubaiTimeLabel(i.startsAt)}.`,
      "If you can't come, please cancel with the link below.",
    ],
    { label: "Cancel this viewing", url: i.cancelUrl },
  );
}

/** Told to the visitor when a viewing is cancelled, by them, by the agent or because the home is no longer available (S79). */
export function viewingCancelledMail(i: {
  name: string;
  property: string;
  startsAt: Date | string;
  reason: "visitor" | "agent" | "unavailable" | "closed";
}): SpaMailParts {
  const why =
    i.reason === "visitor"
      ? "We have cancelled it as you asked."
      : i.reason === "unavailable"
        ? "This home is no longer available, so the viewing has been cancelled."
        : i.reason === "closed"
          ? "We have closed your enquiry, so the viewing has been cancelled."
          : "The agent has had to cancel it. They will be in touch to arrange another time.";
  return build("viewing_cancelled", `Viewing cancelled · ${i.property}`, [
    `Hello ${i.name},`,
    `Your viewing of ${i.property} on ${dubaiTimeLabel(i.startsAt)} is cancelled. ${why}`,
  ]);
}
