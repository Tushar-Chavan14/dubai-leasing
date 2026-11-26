import { maskPiiText } from "@platform/kernel/pii";
import { untrusted } from "@platform/llm/agent";
import type { SpaRole } from "@spa/core";
import { z } from "zod";
import type { EngineClient } from "../client.ts";

export const SALES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin"];
export const COMPLIANCE: readonly SpaRole[] = ["compliance_officer", "mlro"];
/** Everyone who works on deals (the admin configures the product and has no Work screen). */
export const DEAL_ROLES: readonly SpaRole[] = [...SALES, "legal", "finance", ...COMPLIANCE];
/** Roles with a reading right on the signing, NOC, bank and settlement screens. */
export const RECORD_ROLES: readonly SpaRole[] = [...SALES, "legal", "finance"];

export const DealIdInput = z.object({ dealId: z.uuid() });
export const limitOf = (max = 10) => z.number().int().min(1).max(max).default(10);

/** A query string; values are percent-encoded so only the allowlist's characters remain. */
export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(
      ([k, v]) =>
        `${k}=${encodeURIComponent(String(v)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    );
  return parts.length ? `?${parts.join("&")}` : "";
}

/** Text from a party, a document or a note: masked, then fenced so the model reads it as data (rule 11). */
export const fence = (s: string | null | undefined): string => untrusted(maskPiiText(s ?? ""));

const Money = z.number().int();
export const nullableMoney = Money.nullable();

/** What the engine answers for a stored proposal, and what a propose tool returns. */
export const ProposalOutput = z.object({
  proposalId: z.string(),
  kind: z.string(),
  status: z.literal("proposed"),
  expiresAt: z.string(),
  summary: z.string(),
});
export type ProposalOutput = z.infer<typeof ProposalOutput>;

const StoredProposal = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.literal("proposed"),
  expiresAt: z.string(),
  summary: z.string(),
});

/** Posts one proposal. The route stores it; nothing is done until the same user clicks Confirm. */
export async function propose(
  client: EngineClient,
  kind: string,
  dealId: string | null,
  payload: Record<string, unknown>,
): Promise<ProposalOutput> {
  const r = StoredProposal.parse(await client.propose("/api/copilot/proposals", { kind, dealId, payload }));
  return { proposalId: r.id, kind: r.kind, status: r.status, expiresAt: r.expiresAt, summary: r.summary };
}

export const PROPOSED_TEXT = (summary: string): string =>
  `Proposed: ${summary}. Nothing has happened yet; it runs only when you click Confirm on the card, and it expires if you don't.`;

export const DraftOutput = z.object({ draftId: z.string(), kind: z.enum(["email", "summary", "approval_note"]) });
export type DraftOutput = z.infer<typeof DraftOutput>;
const StoredDraft = z.object({ id: z.string(), kind: z.enum(["email", "summary", "approval_note"]) });

/** Posts one draft. It is saved as text for the person to copy or open in a form; nothing is ever sent from it. */
export async function saveDraft(
  client: EngineClient,
  kind: DraftOutput["kind"],
  dealId: string | null,
  body: string,
  extra: Record<string, unknown> = {},
): Promise<DraftOutput> {
  const r = StoredDraft.parse(await client.propose("/api/copilot/drafts", { kind, dealId, body, ...extra }));
  return { draftId: r.id, kind: r.kind };
}

export const DRAFT_TEXT = (kind: DraftOutput["kind"]): string =>
  kind === "approval_note"
    ? "Draft saved. Open it in the approval's note box; nothing has been decided or sent."
    : "Draft saved. It is copy-only: nothing has been sent.";
