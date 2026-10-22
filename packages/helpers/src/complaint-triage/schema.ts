import { z } from "zod";

export const COMPLAINT_CATEGORIES = [
  "ac",
  "plumbing",
  "electrical",
  "pest",
  "noise",
  "appliances",
  "building",
  "billing",
  "none",
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const ComplaintTriageContext = z.object({
  /** The tenant's description, untrusted: classified, never obeyed, never shown to the chat model. */
  text: z.string().min(1).max(2000),
  room: z.string().max(60).optional(),
  /** "Is anyone at risk?" ticked: escalated whatever the model says. */
  atRisk: z.boolean(),
  safetyThreshold: z.number().min(0).max(1),
  legalThreshold: z.number().min(0).max(1),
  injectionThreshold: z.number().min(0).max(1),
  minConfidence: z.number().min(0).max(1),
});
export type ComplaintTriageContext = z.infer<typeof ComplaintTriageContext>;

export const ComplaintTriageData = z.object({
  category: z.enum(COMPLAINT_CATEGORIES),
  categoryConfidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number()),
  /** 0 = can wait a week, 1 = within 48 hours, 2 = same day, 3 = emergency. */
  urgency: z.number().int().min(0).max(3),
  safety: z.number().min(0).max(1),
  legalThreat: z.number().min(0).max(1),
  injection: z.number().min(0).max(1),
  language: z.enum(["en", "ar", "other"]),
  /** Code decides: escalate (safety/legal), review (a person triages), ticket. */
  route: z.enum(["escalate", "review", "ticket"]),
  /** The tenant's acknowledgement: written by the chat model and checked, or the fixed template. */
  acknowledgement: z.string().min(1).max(1500),
  ackSource: z.enum(["model", "template"]),
});
export type ComplaintTriageData = z.infer<typeof ComplaintTriageData>;

export const ComplaintTriageSchemas = { context: ComplaintTriageContext, data: ComplaintTriageData };
