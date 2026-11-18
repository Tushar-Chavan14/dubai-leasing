import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { dubaiDay, fetchLease, LeaseArg } from "./shared.ts";

const Input = z.object({ lease: LeaseArg });
const Output = z.object({
  leaseRef: z.string(),
  messages: z.array(
    z.object({
      purpose: z.string(),
      subject: z.string(),
      status: z.string(),
      sentOn: z.string().nullable(),
      acknowledgedOn: z.string().nullable(),
      smtpResponse: z.string().nullable(),
      messageId: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
  note: z.string(),
});

export const listOutboundMessages: CopilotTool<typeof Input, typeof Output> = {
  name: "list_outbound_messages",
  kind: "read",
  description:
    "Emails sent for a lease (renewal notices, receipts) with the delivery evidence: sent date (Dubai), SMTP response, acknowledgement.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ lease }, { engine }) {
    const l = await fetchLease(engine, lease);
    return {
      leaseRef: l.ref,
      messages: l.outbound.slice(0, 10).map((o) => ({
        purpose: o.purpose,
        subject: o.subject,
        status: o.status,
        sentOn: dubaiDay(o.sentAt),
        acknowledgedOn: dubaiDay(o.acknowledgedAt),
        smtpResponse: o.smtpResponse,
        messageId: o.messageId,
        error: o.error,
      })),
      note: "SMTP acceptance shows the mail server took the message, not that the tenant read it; acknowledgement shows that.",
    };
  },
};
