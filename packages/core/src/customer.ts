import { z } from "zod";

/** Web chat customer accounts: passwordless email login, then a chat session. */

export const CustomerEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const LoginCode = z.string().regex(/^\d{6}$/);

export const CustomerProfile = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().optional(),
});
export type CustomerProfile = z.infer<typeof CustomerProfile>;

/** What the browser posts to the chat endpoint. `clientMessageId` makes retries idempotent. */
export const WebChatInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), clientMessageId: z.uuid(), text: z.string().min(1).max(1000) }),
  z.object({ kind: z.literal("callback"), clientMessageId: z.uuid(), data: z.string().min(1).max(64) }),
]);
export type WebChatInput = z.infer<typeof WebChatInput>;

export const CustomerAccount = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
});
export type CustomerAccount = z.infer<typeof CustomerAccount>;
