"use server";

import { clockRequest } from "../../../../lib/settings-forms";
import { finishSettings } from "../../../../lib/settings-action";

/** Move the demo date ahead by days or back to today: `POST /api/demo/clock`. The engine answers 404 outside demo mode. */
export async function setClock(form: FormData): Promise<void> {
  await finishSettings(clockRequest(form), "/settings/demo-clock", "clock");
}
