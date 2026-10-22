import { z } from "zod";

export const StaffRole = z.enum(["leasing_officer", "leasing_manager", "finance", "admin"]);
export type StaffRole = z.infer<typeof StaffRole>;

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
}

/**
 * Who wrote an event. `user:` and `copilot:` carry the staff user id; `helper:` the helper name.
 */
export type Actor =
  | "system"
  | "import"
  | "demo"
  | `user:${string}`
  | `helper:${string}`
  | `copilot:${string}`
  /** A tenant or applicant acting through the portal (party id). */
  | `tenant:${string}`
  /** A landlord acting through the portal (party id), e.g. signing the contract. */
  | `landlord:${string}`
  /** Someone enquiring through the Telegram bot (conversation id), e.g. booking a viewing. */
  | `enquirer:${string}`;

export const userActor = (userId: string): Actor => `user:${userId}`;
export const helperActor = (name: string): Actor => `helper:${name}`;
