import {
  type Actor as KernelActor,
  helperActor as kernelHelperActor,
  userActor as kernelUserActor,
} from "@platform/kernel/actor";
import { z } from "zod";

export const StaffRole = z.enum(["leasing_officer", "leasing_manager", "finance", "admin"]);
export type StaffRole = z.infer<typeof StaffRole>;

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
}

/** Who wrote an event: the kernel's actors (S4) plus the parties leasing deals with. */
export type Actor = KernelActor<
  /** A tenant or applicant acting through the portal (party id). */
  | `tenant:${string}`
  /** A landlord acting through the portal (party id), e.g. signing the contract. */
  | `landlord:${string}`
  /** Someone enquiring through the Telegram bot or the public web chat (conversation id), e.g. booking a viewing. */
  | `enquirer:${string}`
>;

export const userActor = (userId: string): Actor => kernelUserActor(userId);
export const helperActor = (name: string): Actor => kernelHelperActor(name);
