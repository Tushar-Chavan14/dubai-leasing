import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { Choices } from "../ui.ts";

const Input = z.object({
  question: z.string().trim().min(2).max(300),
  options: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        value: z.string().trim().min(1).max(80).describe("Copied exactly from a tool result in this turn"),
      }),
    )
    .min(2)
    .max(4),
});
const Output = z.object({
  shown: z.number().int(),
  note: z.string(),
  ui: z.object({ choices: Choices }),
});

export const offerChoices: CopilotTool<typeof Input, typeof Output> = {
  name: "offer_choices",
  kind: "read",
  description:
    "Show 2 to 4 tap-to-choose options under your answer, when the user has to pick between records, units, areas, companies or stages. Each value must be copied exactly from a tool result in this turn (a record ref, unit id or code, area, company or stage). A tap sends the choice back as the user's next message, or opens the record or unit. A choice never approves, sends or changes anything.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ question, options }, { issued }) {
    const picked = options.map((o) => {
      // Only values a tool issued this turn: the model can't invent a record or unit, and tenant text
      // (which is wrapped) never becomes a choice.
      if (!issued?.has(o.value))
        throw new Error(
          `"${o.value}" was not returned by a tool in this turn. Call list_records, find_available_units or list_companies first and copy a value from the result.`,
        );
      const href = issued.get(o.value) ?? undefined;
      return {
        label: o.label,
        value: o.value,
        say: href ? `Open ${o.value}` : o.value,
        ...(href ? { href } : {}),
      };
    });
    return {
      shown: picked.length,
      note: "The options are shown under your answer. Don't list them again in text.",
      ui: { choices: { question, options: picked } },
    };
  },
};
