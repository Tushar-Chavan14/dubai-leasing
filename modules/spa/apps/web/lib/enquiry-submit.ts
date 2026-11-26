import { clientBucket } from "./client-address";
import { engineUrl, webEnv } from "./env";

export interface EnquiryState {
  error?: string;
  fields?: Partial<Record<"name" | "email" | "phone" | "slot" | "message" | "consent", string>>;
  /** What happened: the success panel reads it. */
  done?: "booked" | "asked";
  startsAt?: string;
  /** The chosen time was taken or is gone: the form clears it and the page fetches fresh times. */
  slotTaken?: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME = /^[\p{L}\p{M}][\p{L}\p{M}\s'.-]*$/u;
const PHONE = /^[+\d][\d\s()-]{5,}$/;

/** The public enquiry and booking form (S79): checks the fields, then posts to the engine as the visitor, never as staff. */
export async function sendEnquiry(form: FormData, requestHeaders: Headers): Promise<EnquiryState> {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const ref = text("ref");
  const mode = text("mode") === "ask" ? "ask" : "book";
  const name = text("name");
  const email = text("email").toLowerCase();
  const phone = text("phone");
  const message = text("message");
  const slot = text("slot");
  const consent = form.get("consent") === "on";

  const fields: NonNullable<EnquiryState["fields"]> = {};
  if (name.length < 2 || name.length > 100 || !NAME.test(name)) fields.name = "Enter your name, using letters only.";
  if (!EMAIL.test(email) || email.length > 200) fields.email = "Enter a valid email address.";
  if (phone && (phone.length > 30 || !PHONE.test(phone))) fields.phone = "Enter a phone number, or leave it blank.";
  if (mode === "ask" && !message) fields.message = "Write your question.";
  if (message.length > 2000) fields.message = "Keep your message to 2,000 characters.";
  if (mode === "book" && (!slot || Number.isNaN(Date.parse(slot)))) fields.slot = "Choose a viewing time.";
  if (!consent) fields.consent = "Tick the box so we may contact you about this home.";
  if (!ref || ref.length > 80) return { error: "We couldn't find that home. Go back to the list and try again." };
  if (Object.keys(fields).length) return { error: "Check the highlighted fields.", fields };

  const body =
    mode === "ask"
      ? { name, email, ...(phone ? { phone } : {}), message, consent: true }
      : {
          name,
          email,
          ...(phone ? { phone } : {}),
          ...(message ? { message } : {}),
          slot: new Date(slot).toISOString(),
          consent: true,
        };
  let res: Response;
  try {
    res = await fetch(
      `${engineUrl()}/public/catalogue/${encodeURIComponent(ref)}/${mode === "ask" ? "enquiries" : "viewings"}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // The bucket of our own proxy's last hop, never an entry the visitor wrote (see `clientBucket`).
          "x-forwarded-for": clientBucket(requestHeaders, webEnv().SPA_TRUSTED_PROXY),
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
  } catch {
    return { error: "We couldn't send that. Try again in a moment." };
  }
  const answer = (await res.json().catch(() => ({}))) as { code?: string; startsAt?: string };
  if (res.ok)
    return mode === "ask"
      ? { done: "asked" }
      : { done: "booked", ...(answer.startsAt ? { startsAt: answer.startsAt } : {}) };
  switch (answer.code) {
    case "slot_taken":
      return { error: "Someone just took that time. Choose another.", slotTaken: true };
    case "slot_unavailable":
      return { error: "That time isn't available. Choose another.", slotTaken: true };
    case "not_found":
      return { error: "This home is no longer available. Browse the other homes." };
    case "mail_unavailable":
      return { error: "We can't send confirmation emails right now, so we can't book a viewing. Try again later." };
  }
  if (res.status === 429) return { error: "Too many requests. Wait a few minutes and try again." };
  if (res.status === 422) return { error: "Some details weren't accepted. Check your name, email and phone number." };
  return { error: "We couldn't send that. Try again in a moment." };
}
