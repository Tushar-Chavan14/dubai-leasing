import { z } from "zod";
import { resolveApplication } from "../resolve.ts";
import { ALL_STAFF, type CopilotTool } from "../types.ts";

const Input = z
  .object({
    application: z.string().min(2).max(80).optional().describe("Application reference (A-7KQ2MX) or applicant name"),
    unitCode: z.string().min(2).max(60).optional().describe("Unit code, e.g. JVC-0412"),
  })
  .refine((v) => Boolean(v.application) !== Boolean(v.unitCode), "give an application or a unit code");
const Output = z.object({
  unitCode: z.string(),
  application: z.object({ ref: z.string().nullable(), state: z.string(), viewingAt: z.string().nullable() }).nullable(),
  slotMinutes: z.number().int(),
  slots: z.array(z.object({ at: z.string(), label: z.string() })),
  note: z.string(),
});

export const viewingSlots: CopilotTool<typeof Input, typeof Output> = {
  name: "viewing_slots",
  kind: "read",
  description:
    "Free viewing slots (Dubai time) for a unit, or for the unit of an application, following the company's viewing hours and the viewings already booked. Use it before propose_viewing_invite: copy a slot's `at` value exactly. When the user must pick a time, call offer_choices with 2 to 4 of these slots (label as shown, value = `at`).",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ application, unitCode }, { engine }) {
    const q = application
      ? `applicationId=${(await resolveApplication(engine, application)).id}`
      : `unit=${encodeURIComponent(unitCode!)}`;
    const r = await engine.get<{
      unitCode: string;
      application: { ref: string | null; state: string; viewingAt: string | null } | null;
      slotMinutes: number;
      slots: { at: string; label: string }[];
    }>(`/api/copilot/viewing-slots?${q}`);
    return {
      unitCode: r.unitCode,
      application: r.application,
      slotMinutes: r.slotMinutes,
      slots: r.slots,
      note: "Slots are free times the company offers; staff may book other times in the Workspace. Booking happens only when the user confirms propose_viewing_invite.",
    };
  },
};
