"use server";

import { isUuid, publicEngine, visitorId } from "../../../../lib/public";

export interface EnquiryState {
  error?: string;
  fields?: Partial<Record<"name" | "email" | "phone" | "slot", string>>;
  ref?: string;
  /** The form is kept (not the success panel) but the slot list is stale: ask the page to refresh it. */
  slotTaken?: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitEnquiry(_prev: EnquiryState, form: FormData): Promise<EnquiryState> {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const unitId = text("unitId");
  const name = text("name");
  const email = text("email").toLowerCase();
  const phone = text("phone");
  const slot = text("slot");

  const fields: NonNullable<EnquiryState["fields"]> = {};
  if (name.length < 2 || name.length > 120) fields.name = "Enter your name.";
  if (!EMAIL.test(email) || email.length > 254) fields.email = "Enter a valid email address.";
  if (phone && (phone.length > 40 || !/^[+\d][\d\s()-]{5,}$/.test(phone)))
    fields.phone = "Enter a phone number, or leave it blank.";
  if (!slot || Number.isNaN(Date.parse(slot))) fields.slot = "Choose a viewing time.";
  if (!isUuid(unitId)) return { error: "We couldn't find that home. Go back to the list and try again." };
  if (Object.keys(fields).length) return { error: "Check the highlighted fields.", fields };

  const visitor = await visitorId();
  const r = await publicEngine<{ ref: string }>("/public/enquiries", {
    method: "POST",
    body: JSON.stringify({
      unitId,
      name,
      email,
      ...(phone ? { phone } : {}),
      slot: new Date(slot).toISOString(),
      ...(visitor ? { visitorId: visitor } : {}),
    }),
  });
  if (r.ok) return { ref: r.data.ref };

  switch (r.error?.code) {
    case "unit_not_bookable":
      return { error: "This home is no longer open for viewing. Browse the other homes." };
    case "already_enquired":
      return { error: "You already have a viewing request for this home. Check your email for the invitation." };
    case "viewing_slot_taken":
      return { error: "Someone just took that time. Choose another.", slotTaken: true };
    case "viewing_slot_unavailable":
      return { error: "That time isn't available. Choose another.", slotTaken: true };
    case "too_many_enquiries":
      return {
        error: "You have several open viewing requests already. Wait for one to be arranged before booking more.",
      };
    case "rate_limited":
      return { error: "Too many requests from your connection. Wait a few minutes and try again." };
  }
  if (r.status === 429) return { error: "Too many requests. Wait a few minutes and try again." };
  if (r.status === 400) return { error: "Some details weren't accepted. Check your name, email and phone number." };
  return { error: "We couldn't book your viewing. Try again in a moment." };
}
