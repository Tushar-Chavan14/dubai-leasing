import type { EntityKind } from "@leasing/core";
import { newId } from "@leasing/core";
import { newToken, sha256Hex } from "@leasing/core/tokens";
import { actionLinks, type Tx } from "@leasing/db";
import { eq } from "drizzle-orm";
import type { EngineContext } from "../context.ts";

const DAY = 86_400_000;

export type LinkPurpose =
  | "tenancy"
  | "notice_ack"
  | "application"
  | "viewing"
  | "kyc_upload"
  | "offer"
  | "sign"
  | "move_in_ack";

/** Single-use purposes: spent by the one submission they exist for. */
const SINGLE_USE = new Set<LinkPurpose>(["notice_ack", "kyc_upload", "offer", "sign", "move_in_ack"]);
const PATH: Record<LinkPurpose, (token: string) => string> = {
  tenancy: (t) => `/t/${t}`,
  application: (t) => `/t/${t}`,
  viewing: (t) => `/t/${t}/property`,
  notice_ack: (t) => `/t/${t}/acknowledge`,
  kyc_upload: (t) => `/t/${t}/documents`,
  offer: (t) => `/t/${t}/offer`,
  sign: (t) => `/t/${t}/sign`,
  move_in_ack: (t) => `/t/${t}/move-in`,
};

/**
 * Creates a tenant/applicant portal link. The raw token goes into the email only; the database
 * keeps its SHA-256. `tenancy`, `application` and `viewing` (the property page) links are reusable views; `notice_ack`,
 * `kyc_upload`, `offer` and `sign` links work for one submission.
 */
export async function createLink(
  ctx: EngineContext,
  tx: Tx,
  l: {
    purpose: LinkPurpose;
    entity: { kind: EntityKind; id: string };
    partyId: string | null;
    outboundMessageId?: string;
    ttlDays: number;
  },
): Promise<{ id: string; token: string; url: string }> {
  const token = newToken();
  const id = newId();
  const now = ctx.clock.now();
  await tx.db.insert(actionLinks).values({
    id,
    tokenHash: sha256Hex(token),
    purpose: l.purpose,
    entityKind: l.entity.kind,
    entityId: l.entity.id,
    partyId: l.partyId,
    outboundMessageId: l.outboundMessageId ?? null,
    singleUse: SINGLE_USE.has(l.purpose),
    expiresAt: new Date(now.getTime() + l.ttlDays * DAY),
    createdAt: now,
  });
  const path = PATH[l.purpose](token);
  return { id, token, url: `${ctx.webUrl.replace(/\/$/, "")}${path}` };
}

export type LinkRow = typeof actionLinks.$inferSelect;

/** The link for a raw token, if it exists and hasn't expired. Used single-use links are returned with `usedAt` set. */
export async function resolveLink(tx: Tx, token: string, now: Date): Promise<LinkRow | null> {
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(token)) return null;
  const [row] = await tx.db
    .select()
    .from(actionLinks)
    .where(eq(actionLinks.tokenHash, sha256Hex(token)));
  if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
  return row;
}
