"use server";

import { headers } from "next/headers";
import { ENGINE_URL } from "../../../lib/engine";

export interface PortalState {
  ref?: string;
  duplicate?: boolean;
  error?: string;
}

async function submit(token: string, type: string, payload: unknown): Promise<PortalState> {
  const res = await fetch(`${ENGINE_URL}/api/inbound`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, type, payload }),
    cache: "no-store",
  }).catch(() => null);
  if (!res) return { error: "We couldn't reach the leasing system. Please try again in a few minutes." };
  const body = (await res.json().catch(() => ({}))) as { ref?: string; duplicate?: boolean; error?: string };
  if (!res.ok) return { error: body.error ?? "Something went wrong. Please try again." };
  return { ref: body.ref ?? "", duplicate: !!body.duplicate };
}

export async function acknowledge(_prev: PortalState, formData: FormData): Promise<PortalState> {
  return submit(String(formData.get("token")), "NOTICE_ACKNOWLEDGED", {});
}

export async function reply(_prev: PortalState, formData: FormData): Promise<PortalState> {
  const choice = String(formData.get("choice") ?? "");
  if (!["renew", "vacate", "discuss"].includes(choice)) return { error: "Choose one of the three options." };
  const comment = String(formData.get("comment") ?? "").trim();
  const confirmVacate = choice === "vacate" && formData.get("confirmVacate") === "on";
  if (choice === "vacate" && !confirmVacate) return { error: "Tick the box to confirm you won't renew." };
  return submit(String(formData.get("token")), "RENEWAL_REPLY", {
    choice,
    ...(comment ? { comment } : {}),
    ...(confirmVacate ? { confirmVacate: true } : {}),
  });
}

/** Step 3: the applicant sends the uploaded documents for checking (spends the upload link). */
export async function submitDocuments(_prev: PortalState, formData: FormData): Promise<PortalState> {
  const ids = formData.getAll("documentId").map(String).filter(Boolean);
  if (!ids.length) return { error: "Upload at least one document first." };
  return submit(String(formData.get("token")), "DOCS_UPLOADED", { documentIds: ids });
}

const aedToFils = (raw: FormDataEntryValue | null): number | undefined => {
  const s = String(raw ?? "").replace(/[,\s]/g, "");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : Number.NaN;
};

/** Step 4: accept, counter or decline. Structured fields are typed; the comment is classified. */
export async function respondOffer(_prev: PortalState, formData: FormData): Promise<PortalState> {
  const choice = String(formData.get("choice") ?? "");
  if (!["accept", "counter", "decline"].includes(choice)) return { error: "Choose accept, counter or decline." };
  const revision = Number(formData.get("revision"));
  const comment = String(formData.get("comment") ?? "").trim();
  let counter: Record<string, unknown> | undefined;
  if (choice === "counter") {
    const rent = aedToFils(formData.get("rentAed"));
    const cheques = String(formData.get("cheques") ?? "");
    const moveInOn = String(formData.get("moveInOn") ?? "");
    if (Number.isNaN(rent)) return { error: "Enter the rent as a number of dirhams, e.g. 70000." };
    counter = {
      ...(rent ? { annualRentFils: rent } : {}),
      ...(cheques ? { cheques: Number(cheques) } : {}),
      ...(moveInOn ? { moveInOn } : {}),
    };
    if (!Object.keys(counter).length) return { error: "Change at least one term to make a counter-offer." };
  }
  return submit(String(formData.get("token")), "OFFER_RESPONDED", {
    revision,
    choice,
    ...(counter ? { counter } : {}),
    ...(comment ? { comment } : {}),
  });
}

/**
 * Step 5: the signer types their name and consents. The engine records the signature with the
 * signer's address and browser as evidence.
 */
export async function signContract(_prev: PortalState, formData: FormData): Promise<PortalState> {
  const token = String(formData.get("token") ?? "");
  const typedName = String(formData.get("typedName") ?? "").trim();
  if (typedName.length < 2) return { error: "Type your full name to sign." };
  if (formData.get("consent") !== "on") return { error: "Tick the box to confirm you agree to sign electronically." };
  const h = await headers();
  // The hop added by our own proxy (the rightmost); earlier entries are whatever the client sent.
  const ip = h.get("x-real-ip") || (h.get("x-forwarded-for") ?? "").split(",").at(-1)?.trim() || "";
  const res = await fetch(`${ENGINE_URL}/api/portal/${encodeURIComponent(token)}/sign`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(ip ? { "x-signer-ip": ip } : {}),
      "x-signer-user-agent": (h.get("user-agent") ?? "").slice(0, 300),
    },
    body: JSON.stringify({ typedName, consent: true }),
    cache: "no-store",
  }).catch(() => null);
  if (!res) return { error: "We couldn't reach the leasing system. Please try again in a few minutes." };
  const body = (await res.json().catch(() => ({}))) as { ref?: string; error?: string };
  if (!res.ok) return { error: body.error ?? "Something went wrong. Please try again." };
  return { ref: body.ref ?? "" };
}

const ids = (formData: FormData, name: string) => formData.getAll(name).map(String).filter(Boolean);

/** Step 7: the tenant confirms (or disputes) the move-in report, with their own photos. */
export async function moveInAck(_prev: PortalState, formData: FormData): Promise<PortalState> {
  const choice = String(formData.get("agree") ?? "");
  if (choice !== "yes" && choice !== "no") return { error: "Tell us whether the report is right." };
  const comment = String(formData.get("comment") ?? "").trim();
  if (choice === "no" && !comment) return { error: "Tell us what is different from the report." };
  return submit(String(formData.get("token")), "MOVE_IN_ACKNOWLEDGED", {
    agree: choice === "yes",
    ...(comment ? { comment } : {}),
    photoIds: ids(formData, "photoId"),
  });
}

/** Step 8: reply about a payment. Buttons and dates are typed; the comment is classified. */
export async function paymentReply(_prev: PortalState, formData: FormData): Promise<PortalState> {
  const choice = String(formData.get("choice") ?? "");
  if (!["paid", "will_pay", "dispute", "need_time"].includes(choice)) return { error: "Choose one of the options." };
  const payBy = String(formData.get("payBy") ?? "");
  if (choice === "will_pay" && !/^\d{4}-\d{2}-\d{2}$/.test(payBy)) return { error: "Choose the date you will pay by." };
  const comment = String(formData.get("comment") ?? "").trim();
  return submit(String(formData.get("token")), "PAYMENT_REPLY", {
    paymentId: String(formData.get("paymentId")),
    choice,
    ...(choice === "will_pay" ? { payBy } : {}),
    ...(comment ? { comment } : {}),
    proofIds: ids(formData, "photoId"),
  });
}

/** Step 8: report an issue (the description goes to Complaint Triage; "at risk" escalates at once). */
export async function reportIssue(_prev: PortalState, formData: FormData): Promise<PortalState> {
  const description = String(formData.get("description") ?? "").trim();
  if (description.length < 5) return { error: "Describe the issue in a few words." };
  const room = String(formData.get("room") ?? "").trim();
  return submit(String(formData.get("token")), "COMPLAINT_SUBMITTED", {
    description,
    ...(room ? { room } : {}),
    atRisk: formData.get("atRisk") === "on",
    photoIds: ids(formData, "photoId"),
  });
}
