import { z } from "zod";
import { Emirate } from "./emirates.ts";

/**
 * Contract fees a company charges (D70): a registration fee (Ejari in Dubai, Tawtheeq in Abu Dhabi, ...), an agency fee,
 * a municipality fee. A company setting, printed in contracts as stored; no model sets an amount. A fee names the
 * emirates it applies to; none means every emirate the company operates in.
 */

/** AED 1,000,000 in fils. */
export const MAX_CONTRACT_FEE_FILS = 1_000_000_00;
export const MAX_CONTRACT_FEES = 20;

// The contract PDF uses standard fonts: a name must stay in Latin-1 so it always prints.
const PRINTABLE = /^[\x20-\x7e\xa0-\xff]+$/;

export const ContractFee = z.object({
  id: z.string({ error: "required" }).regex(/^[A-Za-z0-9_-]{1,40}$/, "use a short id of letters, digits, - or _"),
  name: z
    .string({ error: "enter the fee name" })
    .trim()
    .min(1, "enter the fee name")
    .max(80, "use at most 80 characters")
    .regex(PRINTABLE, "use letters, numbers and common punctuation only"),
  kind: z.enum(["registration", "other"], { error: "choose registration or other" }),
  amountFils: z
    .number({ error: "enter whole dirhams, like 220" })
    .int("enter whole dirhams, like 220")
    .min(0, "use 0 or more")
    .max(MAX_CONTRACT_FEE_FILS, "use at most AED 1,000,000"),
  payer: z.enum(["tenant", "landlord"], { error: "choose tenant or landlord" }),
  /** Empty = any emirate. */
  emirates: z
    .array(Emirate)
    .max(7)
    .default([])
    .transform((v) => [...new Set(v)]),
});
export type ContractFee = z.infer<typeof ContractFee>;

export const ContractFees = z
  .array(ContractFee)
  .max(MAX_CONTRACT_FEES, `use at most ${MAX_CONTRACT_FEES} fees`)
  .refine((fees) => new Set(fees.map((f) => f.id)).size === fees.length, "each fee needs its own id");

/** The fees that apply in an emirate: those naming it, then those naming none. */
export function feesFor(
  fees: readonly ContractFee[] | null | undefined,
  emirate: string | null | undefined,
): ContractFee[] {
  const list = fees ?? [];
  return list.filter(
    (f) =>
      f.emirates.length === 0 ||
      (emirate !== null && emirate !== undefined && (f.emirates as string[]).includes(emirate)),
  );
}

/** The registration fee for the emirate: one naming the emirate beats an any-emirate one; the first listed wins a tie. */
export function registrationFeeFor(
  fees: readonly ContractFee[] | null | undefined,
  emirate: string | null | undefined,
): ContractFee | null {
  const regs = feesFor(fees, emirate).filter((f) => f.kind === "registration");
  return regs.find((f) => f.emirates.length > 0) ?? regs[0] ?? null;
}

/** Reads a stored jsonb value as fees; anything invalid reads as none (the settings form is the only writer). */
export function parseContractFees(raw: unknown): ContractFee[] {
  const r = ContractFees.safeParse(raw ?? []);
  return r.success ? r.data : [];
}
