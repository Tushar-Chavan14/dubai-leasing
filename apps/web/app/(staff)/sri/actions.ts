"use server";

import { parseAed } from "@leasing/core";
import { revalidatePath } from "next/cache";
import { engine, formError } from "../../../lib/engine";

export interface SriState {
  ok?: string;
  error?: string;
  reasons?: string[];
}

export async function saveSri(_prev: SriState, formData: FormData): Promise<SriState> {
  let avgAnnualRentFils: number;
  try {
    avgAnnualRentFils = parseAed(String(formData.get("avg") ?? ""));
  } catch {
    return { error: "Enter the average as an AED amount, for example 100,000." };
  }
  const r = await engine("/api/sri", {
    method: "PUT",
    body: JSON.stringify({
      community: String(formData.get("community") ?? ""),
      bedrooms: Number(formData.get("bedrooms")),
      avgAnnualRentFils,
    }),
  });
  revalidatePath("/sri");
  return r.ok ? { ok: "Saved." } : formError(r);
}
