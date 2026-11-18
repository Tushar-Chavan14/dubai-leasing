"use server";

import { revalidatePath } from "next/cache";
import { AUTOPILOT_NUMBER_IDS, AUTOPILOT_NUMBERS, AUTOPILOT_STEPS, QUIET_HOURS_SAME } from "@leasing/core";
import { engine, formError } from "../../../../lib/engine";

export interface AgentState {
  ok?: string;
  error?: string;
  reasons?: string[];
  /** Inline errors by field id. */
  fields?: Record<string, string>;
}

/**
 * Admin only (the engine checks). Unchecked switches are absent from the form, so send every
 * step; numbers are sent as typed and the engine refuses anything outside the bounds.
 */
export async function saveAgent(_prev: AgentState, formData: FormData): Promise<AgentState> {
  const body: Record<string, boolean | number> = Object.fromEntries(
    AUTOPILOT_STEPS.map((s) => [s.id, formData.has(s.id)]),
  );
  for (const k of AUTOPILOT_NUMBER_IDS) {
    const raw = String(formData.get(k) ?? "").trim();
    const n = Number(raw);
    if (raw === "" || !Number.isInteger(n)) {
      const error = `${AUTOPILOT_NUMBERS[k].label}: enter a whole number.`;
      return { error, fields: { [k]: error } };
    }
    body[k] = n;
  }
  if (body.quiet_hours_start === body.quiet_hours_end) {
    return { error: QUIET_HOURS_SAME, fields: { quiet_hours_end: QUIET_HOURS_SAME } };
  }
  const r = await engine<{ version: number }>("/api/policy/autopilot", { method: "PUT", body: JSON.stringify(body) });
  if (!r.ok) return formError(r);
  revalidatePath("/settings/agent");
  return { ok: `Saved as policy version ${r.data.version}.` };
}
