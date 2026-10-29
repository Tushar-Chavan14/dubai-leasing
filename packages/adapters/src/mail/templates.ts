/**
 * Email templates (English). Plain, readable HTML with a text twin. Values are escaped; links
 * are the only calls to action. Legal notices are always attached as PDF as well.
 */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface Rendered {
  subject: string;
  text: string;
  html: string;
}

function layout(
  title: string,
  paragraphs: string[],
  actions: { label: string; url: string }[],
  footer: string,
): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${esc(p)}</p>`).join("");
  const buttons = actions
    .map(
      (a, i) =>
        `<a href="${esc(a.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;${i === 0 ? "background:#2f5d50;color:#ffffff" : "border:1px solid #cdd2ce;color:#1a1d1f"}">${esc(a.label)}</a>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#f2f3f1;font-family:Arial,Helvetica,sans-serif;color:#1a1d1f">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
<div style="background:#ffffff;border-radius:10px;padding:24px;border:1px solid #e1e4e1">
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>${body}<div style="margin-top:8px">${buttons}</div></div>
<p style="font-size:12px;color:#687076;margin:16px 4px">${esc(footer)}</p></div></body></html>`;
}

const footer = (demo: boolean) =>
  `Sent by the leasing team on behalf of your landlord. Links are personal to you; do not forward this email.${demo ? " Demo build: Ejari is simulated." : ""}`;

export interface RenewalNoticeMail {
  tenantName: string;
  unitLabel: string;
  leaseEndOn: string;
  currentRent: string;
  proposedRent: string;
  increase: boolean;
  reference: string;
  acknowledgeUrl: string;
  tenancyUrl: string;
  demo: boolean;
}

export function renewalNoticeEmail(d: RenewalNoticeMail): Rendered {
  const subject = d.increase ? `Renewal notice and rent change: ${d.unitLabel}` : `Renewal notice: ${d.unitLabel}`;
  const paras = [
    `Dear ${d.tenantName},`,
    `Your tenancy of ${d.unitLabel} ends on ${d.leaseEndOn}. The attached notice (reference ${d.reference}) sets out our offer to renew.`,
    d.increase
      ? `The annual rent for the new term would change from ${d.currentRent} to ${d.proposedRent}.`
      : `The annual rent for the new term stays at ${d.currentRent}.`,
    "Please confirm you have received this notice, then tell us whether you want to renew, plan to move out, or would like to discuss.",
  ];
  const actions = [
    { label: "Confirm I received this notice", url: d.acknowledgeUrl },
    { label: "Reply: renew, move out or discuss", url: d.tenancyUrl },
  ];
  const foot = footer(d.demo);
  const text = [...paras, "", `Confirm receipt: ${d.acknowledgeUrl}`, `Reply: ${d.tenancyUrl}`, "", foot].join("\n");
  return { subject, text, html: layout(subject, paras, actions, foot) };
}

export interface ReplyReceivedMail {
  tenantName: string;
  unitLabel: string;
  reference: string;
  summary: string;
  tenancyUrl: string;
  demo: boolean;
}

export function replyReceivedEmail(d: ReplyReceivedMail): Rendered {
  const subject = `We received your reply (${d.reference})`;
  const paras = [
    `Dear ${d.tenantName},`,
    `Thank you. We received your reply about ${d.unitLabel}: ${d.summary}.`,
    `Your reference is ${d.reference}. A member of the leasing team will follow up if anything else is needed.`,
  ];
  const foot = footer(d.demo);
  const text = [...paras, "", `My tenancy: ${d.tenancyUrl}`, "", foot].join("\n");
  return { subject, text, html: layout(subject, paras, [{ label: "View my tenancy", url: d.tenancyUrl }], foot) };
}

export interface DocumentsRequestMail {
  applicantName: string;
  unitLabel: string;
  reference: string;
  uploadUrl: string;
  statusUrl: string;
  demo: boolean;
}

/** Step 3: a one-time link to upload ID documents (never by email attachment or chat). */
export function documentsRequestEmail(d: DocumentsRequestMail): Rendered {
  const subject = `Upload your ID documents: ${d.unitLabel}`;
  const paras = [
    `Dear ${d.applicantName},`,
    `Thank you for applying for ${d.unitLabel} (reference ${d.reference}). To prepare your tenancy we need clear photos of your identity documents.`,
    "Please upload both sides of your Emirates ID. If you don't have one yet, upload your passport data page and your residence visa. Companies: the trade licence and the signatory's Emirates ID.",
    "The upload link is personal and works for one submission. Please don't send ID documents by email or chat.",
  ];
  const foot = footer(d.demo);
  const text = [...paras, "", `Upload documents: ${d.uploadUrl}`, `Your application: ${d.statusUrl}`, "", foot].join(
    "\n",
  );
  return {
    subject,
    text,
    html: layout(
      subject,
      paras,
      [
        { label: "Upload documents", url: d.uploadUrl },
        { label: "View my application", url: d.statusUrl },
      ],
      foot,
    ),
  };
}

export interface ViewingInvitationMail {
  applicantName: string;
  unitLabel: string;
  address: string;
  viewingAt: Date;
  propertyUrl: string;
  virtualTourUrl?: string | null;
  statusUrl: string;
  reference: string;
  demo: boolean;
}

/** "Thursday 23 October 2026, 4:30 pm (Dubai time)": viewings are local appointments in Asia/Dubai. */
export function formatDubaiDateTime(at: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dubai",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const ampm = (parts.dayPeriod ?? "").toLowerCase();
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${ampm} (Dubai time)`;
}

/** Step 2: the first email to an applicant: the viewing appointment and the property online. */
export function viewingInvitationEmail(d: ViewingInvitationMail): Rendered {
  const when = formatDubaiDateTime(d.viewingAt);
  const subject = `Your viewing: ${d.unitLabel}`;
  const paras = [
    `Dear ${d.applicantName},`,
    `Thank you for your interest in ${d.unitLabel} (reference ${d.reference}). Your viewing is booked for ${when}.`,
    `Address: ${d.address}.`,
    "You can see the photos and details online before you come. If you can't come, please let the leasing team know.",
    "After the viewing we will send you a personal link to upload your ID documents.",
  ];
  const actions = [{ label: "View the property online", url: d.propertyUrl }];
  if (d.virtualTourUrl) actions.push({ label: "Virtual tour", url: d.virtualTourUrl });
  actions.push({ label: "View my application", url: d.statusUrl });
  const foot = footer(d.demo);
  const text = [...paras, "", ...actions.map((a) => `${a.label}: ${a.url}`), "", foot].join("\n");
  return { subject, text, html: layout(subject, paras, actions, foot) };
}

export interface OfferMail {
  applicantName: string;
  unitLabel: string;
  reference: string;
  revised: boolean;
  rent: string;
  cheques: number;
  deposit: string;
  reservation: string;
  moveInOn: string;
  term: string;
  expiresOn: string;
  offerUrl: string;
  statusUrl: string;
  demo: boolean;
}

/** Step 4: the offer (or a revised one) with a link to accept, counter or decline. */
export function offerEmail(d: OfferMail): Rendered {
  const subject = d.revised ? `Revised offer: ${d.unitLabel}` : `Your offer: ${d.unitLabel}`;
  const paras = [
    `Dear ${d.applicantName},`,
    d.revised
      ? `We have revised our offer for ${d.unitLabel} (reference ${d.reference}). Please review the terms below.`
      : `Your documents are checked. Here is our offer for ${d.unitLabel} (reference ${d.reference}).`,
    `Annual rent ${d.rent}, paid in ${d.cheques} cheques. Security deposit ${d.deposit}. Tenancy ${d.term}, move-in ${d.moveInOn}.`,
    `To secure the unit, accept the offer and pay a reservation of ${d.reservation}. The offer is open until ${d.expiresOn}.`,
  ];
  const foot = footer(d.demo);
  const text = [
    ...paras,
    "",
    `Accept, counter or decline: ${d.offerUrl}`,
    `Your application: ${d.statusUrl}`,
    "",
    foot,
  ].join("\n");
  return {
    subject,
    text,
    html: layout(
      subject,
      paras,
      [
        { label: "Answer the offer", url: d.offerUrl },
        { label: "View my application", url: d.statusUrl },
      ],
      foot,
    ),
  };
}

export interface OfferAcceptedMail {
  applicantName: string;
  unitLabel: string;
  reference: string;
  reservation: string;
  statusUrl: string;
  demo: boolean;
}

/** Step 4: acceptance received; next is the reservation payment, recorded by the leasing team. */
export function offerAcceptedEmail(d: OfferAcceptedMail): Rendered {
  const subject = `Offer accepted: ${d.unitLabel}`;
  const paras = [
    `Dear ${d.applicantName},`,
    `Thank you, we received your acceptance for ${d.unitLabel} (reference ${d.reference}).`,
    `The leasing team will contact you about the reservation payment of ${d.reservation}. Once it is received, we prepare your tenancy contract.`,
  ];
  const foot = footer(d.demo);
  const text = [...paras, "", `Your application: ${d.statusUrl}`, "", foot].join("\n");
  return { subject, text, html: layout(subject, paras, [{ label: "View my application", url: d.statusUrl }], foot) };
}

export interface ContractSignMail {
  signerName: string;
  role: "tenant" | "landlord";
  unitLabel: string;
  leaseRef: string;
  version: number;
  signUrl: string;
  validDays: number;
  demo: boolean;
  /** A reminder to someone who has not signed yet (a fresh link replaces the old one). */
  reminder?: boolean;
}

/** The approved contract, attached as PDF, with a personal signing link. */
export function contractSignEmail(d: ContractSignMail): Rendered {
  const subject = `${d.reminder ? "Reminder: tenancy" : "Tenancy"} contract to sign: ${d.unitLabel}`;
  const paras = [
    `Dear ${d.signerName},`,
    ...(d.reminder ? ["This is a friendly reminder: we are still waiting for your signature."] : []),
    `The tenancy contract for ${d.unitLabel} (lease ${d.leaseRef}, version ${d.version}) is ready for your signature. A copy is attached.`,
    `Please read it, then sign through the personal link below by typing your full name. The link works once and stays valid for ${d.validDays} days.`,
    d.role === "tenant"
      ? "Once you and the landlord have both signed, we register the contract in Ejari and send you a copy."
      : "Once you and the tenant have both signed, we register the contract in Ejari.",
  ];
  const foot = `${footer(d.demo)}${d.demo ? " Signatures in the demo are simulated." : ""}`;
  const text = [...paras, "", `Sign the contract: ${d.signUrl}`, "", foot].join("\n");
  return { subject, text, html: layout(subject, paras, [{ label: "Review and sign", url: d.signUrl }], foot) };
}

export interface ContractSignedMail {
  name: string;
  unitLabel: string;
  leaseRef: string;
  demo: boolean;
}

/** Both parties signed: the signed copy (with the signature record page) is attached. */
export function contractSignedEmail(d: ContractSignedMail): Rendered {
  const subject = `Contract signed: ${d.unitLabel}`;
  const paras = [
    `Dear ${d.name},`,
    `Both parties have signed the tenancy contract for ${d.unitLabel} (lease ${d.leaseRef}). Your signed copy is attached.`,
    "Next, the leasing team registers the contract in Ejari. We will email you the registration certificate.",
  ];
  const foot = footer(d.demo);
  return { subject, text: [...paras, "", foot].join("\n"), html: layout(subject, paras, [], foot) };
}

export interface EjariIssuedMail {
  name: string;
  unitLabel: string;
  ejariNo: string;
  /** The tenant's portal (report an issue, payments). */
  tenancyUrl?: string;
  demo: boolean;
}

/** The lease is registered: the certificate is attached (labelled simulated in the demo). */
export function ejariIssuedEmail(d: EjariIssuedMail): Rendered {
  const subject = `Ejari registration ${d.demo ? "(simulated) " : ""}complete: ${d.unitLabel}`;
  const paras = [
    `Dear ${d.name},`,
    `Your tenancy of ${d.unitLabel} is registered in Ejari under number ${d.ejariNo}. The certificate is attached.`,
    d.demo
      ? "This is a demo: the registration was made in a simulated Ejari service, not with the Dubai Land Department."
      : "You need the Ejari number to connect electricity and water with DEWA.",
    "The leasing team will contact you about the move-in date and keys.",
  ];
  const foot = footer(d.demo);
  const actions = d.tenancyUrl ? [{ label: "My tenancy", url: d.tenancyUrl }] : [];
  return {
    subject,
    text: [...paras, ...(d.tenancyUrl ? ["", `My tenancy: ${d.tenancyUrl}`] : []), "", foot].join("\n"),
    html: layout(subject, paras, actions, foot),
  };
}

// ---------------------------------------------------------------- tenancy (phase 3)

export interface MoveInMail {
  name: string;
  unitLabel: string;
  /** What was handed over and checked, in words. */
  checked: string[];
  rooms: string[];
  ackUrl: string;
  tenancyUrl: string;
  ackDays: number;
  demo: boolean;
}

export function moveInEmail(d: MoveInMail): Rendered {
  const subject = `Welcome home: your move-in report for ${d.unitLabel}`;
  const paras = [
    `Dear ${d.name},`,
    `Your tenancy of ${d.unitLabel} has started. At move-in we checked: ${d.checked.join("; ")}.`,
    `We photographed the condition of every room (${d.rooms.join(", ")}). Please confirm the report within ${d.ackDays} days, and add your own photos if you see anything we missed. This protects you when you move out.`,
    "Your tenancy page is where you report an issue or reply to a rent reminder.",
  ];
  const actions = [
    { label: "Confirm the move-in report", url: d.ackUrl },
    { label: "My tenancy", url: d.tenancyUrl },
  ];
  const foot = footer(d.demo);
  return {
    subject,
    text: [...paras, "", `Confirm the report: ${d.ackUrl}`, `My tenancy: ${d.tenancyUrl}`, "", foot].join("\n"),
    html: layout(subject, paras, actions, foot),
  };
}

export interface RentReminderMail {
  name: string;
  unitLabel: string;
  n: number;
  of: number;
  amount: string;
  dueOn: string;
  method: "cheque" | "transfer" | "cash";
  tenancyUrl: string;
  demo: boolean;
}

/** Before the due date: a friendly heads-up (no consequence mentioned). */
export function rentReminderEmail(d: RentReminderMail): Rendered {
  const subject = `Rent reminder: payment ${d.n} of ${d.of} for ${d.unitLabel}`;
  const paras = [
    `Dear ${d.name},`,
    d.method === "cheque"
      ? `Cheque ${d.n} of ${d.of} (${d.amount}) for ${d.unitLabel} will be deposited on ${d.dueOn}. Please make sure the funds are available.`
      : `Payment ${d.n} of ${d.of} (${d.amount}) for ${d.unitLabel} is due on ${d.dueOn}.`,
    "No action is needed if everything is in order. Thank you.",
  ];
  const foot = footer(d.demo);
  return {
    subject,
    text: [...paras, "", `My tenancy: ${d.tenancyUrl}`, "", foot].join("\n"),
    html: layout(subject, paras, [{ label: "My tenancy", url: d.tenancyUrl }], foot),
  };
}

export interface RentFriendlyMail {
  name: string;
  unitLabel: string;
  n: number;
  of: number;
  amount: string;
  dueOn: string;
  bounced: boolean;
  replyUrl: string;
  demo: boolean;
}

/** Overdue or bounced: a friendly reminder with a way to reply (paid, will pay, dispute, need time). */
export function rentFriendlyEmail(d: RentFriendlyMail): Rendered {
  const subject = d.bounced
    ? `Your cheque ${d.n} of ${d.of} for ${d.unitLabel} was returned`
    : `Payment ${d.n} of ${d.of} for ${d.unitLabel} is overdue`;
  const paras = [
    `Dear ${d.name},`,
    d.bounced
      ? `The bank returned cheque ${d.n} of ${d.of} (${d.amount}, dated ${d.dueOn}) for ${d.unitLabel}.`
      : `We have not yet received payment ${d.n} of ${d.of} (${d.amount}, due ${d.dueOn}) for ${d.unitLabel}.`,
    "Please arrange the payment, or tell us where things stand: you have paid, you will pay by a date, you dispute it, or you need more time.",
  ];
  const foot = footer(d.demo);
  return {
    subject,
    text: [...paras, "", `Reply here: ${d.replyUrl}`, "", foot].join("\n"),
    html: layout(subject, paras, [{ label: "Reply about this payment", url: d.replyUrl }], foot),
  };
}

export interface FormalReminderMail {
  name: string;
  unitLabel: string;
  amount: string;
  dueOn: string;
  reference: string;
  /** From the rulebook pinned on the lease, never a literal. */
  lateRentDays: number;
  replyUrl: string;
  demo: boolean;
}

/** The formal late-payment reminder (gated; PDF attached). Its accepted send starts the legal clock. */
export function formalReminderEmail(d: FormalReminderMail): Rendered {
  const subject = `Formal reminder: unpaid rent for ${d.unitLabel}`;
  const paras = [
    `Dear ${d.name},`,
    `This is a formal reminder (reference ${d.reference}) that ${d.amount}, due on ${d.dueOn} for ${d.unitLabel}, remains unpaid. The formal reminder is attached.`,
    `Please pay the amount, or reply to us. Under the rules that apply to your tenancy, if the amount remains unpaid the landlord may take further steps after ${d.lateRentDays} days from this reminder.`,
    d.demo ? "Demo build: wording to be reviewed by a lawyer before real use." : "",
  ].filter(Boolean);
  const foot = footer(d.demo);
  return {
    subject,
    text: [...paras, "", `Reply here: ${d.replyUrl}`, "", foot].join("\n"),
    html: layout(subject, paras, [{ label: "Reply about this payment", url: d.replyUrl }], foot),
  };
}

export interface ComplaintAckMail {
  name: string;
  unitLabel: string;
  reference: string;
  /** The acknowledgement text (written by the chat model and checked, or a fixed template). */
  body: string;
  tenancyUrl: string;
  demo: boolean;
}

export function complaintAckEmail(d: ComplaintAckMail): Rendered {
  const subject = `We received your report ${d.reference}: ${d.unitLabel}`;
  const paras = [`Dear ${d.name},`, ...d.body.split(/\n{2,}/), `Your reference is ${d.reference}.`];
  const foot = footer(d.demo);
  return {
    subject,
    text: [...paras, "", `My tenancy: ${d.tenancyUrl}`, "", foot].join("\n"),
    html: layout(subject, paras, [{ label: "My tenancy", url: d.tenancyUrl }], foot),
  };
}

export interface StaffMessageMail {
  name: string;
  subject: string;
  /** Written (or edited) by a member of staff, who sent it. */
  body: string;
  tenancyUrl: string;
  demo: boolean;
}

export function staffMessageEmail(d: StaffMessageMail): Rendered {
  const paras = [`Dear ${d.name},`, ...d.body.split(/\n{2,}/)];
  const foot = footer(d.demo);
  return {
    subject: d.subject,
    text: [...paras, "", `My tenancy: ${d.tenancyUrl}`, "", foot].join("\n"),
    html: layout(d.subject, paras, [{ label: "My tenancy", url: d.tenancyUrl }], foot),
  };
}

export interface ApplicantMessageMail {
  name: string;
  subject: string;
  /** Written (or edited) by a member of staff, who sent it. */
  body: string;
  demo: boolean;
}

/** A plain message from staff to an applicant (D42). No link: the applicant replies to the email. */
export function applicantMessageEmail(d: ApplicantMessageMail): Rendered {
  const paras = [`Dear ${d.name},`, ...d.body.split(/\n{2,}/)];
  const foot = footer(d.demo);
  return {
    subject: d.subject,
    text: [...paras, "", foot].join("\n"),
    html: layout(d.subject, paras, [], foot),
  };
}

// ---------------------------------------------------------------- move-out (phase 4)

export interface MoveOutMail {
  name: string;
  unitLabel: string;
  /** Formatted move-out date. */
  moveOutOn: string;
  bookUrl: string;
  demo: boolean;
}

/** Step 10: the tenant is moving out; book the inspection. */
export function moveOutEmail(d: MoveOutMail): Rendered {
  const subject = `Moving out of ${d.unitLabel}: book your inspection`;
  const paras = [
    `Dear ${d.name},`,
    `We have recorded that your tenancy of ${d.unitLabel} ends and you move out on ${d.moveOutOn}.`,
    "Please book a time for the move-out inspection. We will check the keys and access cards and photograph each room, and compare them with the photos from your move-in. Normal wear and tear is never deducted from your deposit.",
    "After the inspection we will send you the deposit statement to accept or dispute.",
  ];
  const actions = [{ label: "Book the inspection", url: d.bookUrl }];
  const foot = footer(d.demo);
  return {
    subject,
    text: [...paras, "", `Book the inspection: ${d.bookUrl}`, "", foot].join("\n"),
    html: layout(subject, paras, actions, foot),
  };
}

export interface DepositStatementMail {
  name: string;
  unitLabel: string;
  revision: number;
  deposit: string;
  deductions: string;
  refund: string;
  respondUrl: string;
  respondDays: number;
  demo: boolean;
}

/** Step 10: the deposit statement (PDF attached); accept with refund details or dispute. */
export function depositStatementEmail(d: DepositStatementMail): Rendered {
  const subject = `Your deposit statement for ${d.unitLabel}${d.revision > 1 ? ` (revised, ${d.revision})` : ""}`;
  const paras = [
    `Dear ${d.name},`,
    `Your security deposit was ${d.deposit}. After the move-out inspection the deductions are ${d.deductions}, so the refund to you is ${d.refund}. The attached statement lists each item.`,
    `Please accept the statement and give your bank details for the refund, or dispute it and tell us why, within ${d.respondDays} days. A person reviews every dispute.`,
  ];
  const actions = [{ label: "Accept or dispute", url: d.respondUrl }];
  const foot = footer(d.demo);
  return {
    subject,
    text: [...paras, "", `Accept or dispute: ${d.respondUrl}`, "", foot].join("\n"),
    html: layout(subject, paras, actions, foot),
  };
}

export interface ViewingReminderMail {
  applicantName: string;
  unitLabel: string;
  address: string;
  viewingAt: Date;
  propertyUrl: string;
  statusUrl: string;
  reference: string;
  demo: boolean;
}

/** Reminder before a booked viewing. */
export function viewingReminderEmail(d: ViewingReminderMail): Rendered {
  const subject = `Reminder: your viewing of ${d.unitLabel}`;
  const paras = [
    `Dear ${d.applicantName},`,
    `A reminder that your viewing of ${d.unitLabel} (reference ${d.reference}) is on ${formatDubaiDateTime(d.viewingAt)}.`,
    `Address: ${d.address}.`,
    "If you can no longer come, please let the leasing team know.",
  ];
  const actions = [
    { label: "View the property online", url: d.propertyUrl },
    { label: "View my application", url: d.statusUrl },
  ];
  const foot = footer(d.demo);
  const text = [...paras, "", ...actions.map((a) => `${a.label}: ${a.url}`), "", foot].join("\n");
  return { subject, text, html: layout(subject, paras, actions, foot) };
}

export interface NoShowFollowupMail {
  applicantName: string;
  unitLabel: string;
  reference: string;
  propertyUrl: string;
  demo: boolean;
}

/** After a recorded no-show: no pressure, the way to ask for another viewing. */
export function noShowFollowupEmail(d: NoShowFollowupMail): Rendered {
  const subject = `We missed you: ${d.unitLabel}`;
  const paras = [
    `Dear ${d.applicantName},`,
    `We were expecting you at the viewing of ${d.unitLabel} (reference ${d.reference}) and did not see you. These things happen.`,
    "If you are still interested, the property is online below and you can ask for a new viewing time at any point.",
  ];
  const actions = [{ label: "View the property online", url: d.propertyUrl }];
  const foot = footer(d.demo);
  const text = [...paras, "", `${actions[0]!.label}: ${actions[0]!.url}`, "", foot].join("\n");
  return { subject, text, html: layout(subject, paras, actions, foot) };
}

export interface DocumentsChaseMail {
  applicantName: string;
  unitLabel: string;
  reference: string;
  uploadUrl: string;
  statusUrl: string;
  demo: boolean;
}

/** Documents still missing: a reminder with a fresh upload link. */
export function documentsChaseEmail(d: DocumentsChaseMail): Rendered {
  const subject = `Reminder: upload your ID documents for ${d.unitLabel}`;
  const paras = [
    `Dear ${d.applicantName},`,
    `We have not received your identity documents for ${d.unitLabel} (reference ${d.reference}) yet, and we cannot continue without them.`,
    "Please use the personal upload link below. Don't send ID documents by email or chat.",
  ];
  const actions = [
    { label: "Upload documents", url: d.uploadUrl },
    { label: "View my application", url: d.statusUrl },
  ];
  const foot = footer(d.demo);
  const text = [...paras, "", ...actions.map((a) => `${a.label}: ${a.url}`), "", foot].join("\n");
  return { subject, text, html: layout(subject, paras, actions, foot) };
}
