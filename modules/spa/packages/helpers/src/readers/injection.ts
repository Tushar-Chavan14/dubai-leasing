import { instructionLike } from "../aml/summary.ts";

const MORE =
  /\b(approve|accept|confirm|verify|clear|pass)\b.{0,30}\b(this|it|the)\b.{0,30}\b(document|noc|letter|licen[cs]e|deed|ownership|party|company|owner|amount)\b|\b(set|change|update|replace)\b.{0,20}\b(the )?(amount|balance|owner|owners|expiry|status|share|shares)\b|\bdo not (flag|review|check|verify|report)\b|\bnote to (the )?(reviewer|system|model|ai|assistant|reader)\b|\bplease (approve|accept|confirm|ignore|skip)\b|\b(ai|llm|model|assistant)\b.{0,20}\b(reader|reading|must|should|shall)\b/i;

/**
 * Text on a document that reads like an order to a model (C20). Detection only: the reader's output is never changed
 * because of it. It reuses the AML name check (S50) and adds the wording documents tend to carry.
 */
export const documentInstructionLike = (text: string): boolean => instructionLike(text) || MORE.test(text);

/** Every string in a read answer, so instruction-like text is found wherever the model copied it. */
export function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) allStrings(v, out);
  return out;
}
