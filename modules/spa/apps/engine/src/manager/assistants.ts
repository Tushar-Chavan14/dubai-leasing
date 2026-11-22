import { createHash } from "node:crypto";
import { newId } from "@platform/kernel/ids";
import { maskPii, maskPiiText } from "@platform/kernel/pii";
import type { Llm } from "@platform/llm";
import type { AgentModel, TurnResult } from "@platform/llm/agent";
import { type AssistantKind, assistantMessages, assistantRateLimits, assistantThreads } from "@spa/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { SpaContext } from "./context.ts";

/**
 * Storage and limits shared by the three assistants (S24, S61). Nothing here touches a deal, listing or template: a
 * conversation is stored (masked), a rate limit is a counter per hashed key and Clock bucket.
 */
export interface AssistantRuntime {
  model: AgentModel;
  /** The decision model for the scope gate; null skips it (it fails open anyway). */
  llm: Pick<Llm, "decide"> | null;
  /** The chat model's tag, stored with each answer. */
  tag: string;
  /** The turn limit in ms; the default is 60 s (S24). Tests shorten it. */
  timeoutMs?: number;
}

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
/** A principal (token, user or client key) is stored only as a hash. */
export const principalHash = (kind: AssistantKind, principal: string): string => sha256(`${kind}:${principal}`);
/** How many earlier messages a model is shown. */
const HISTORY_MESSAGES = 10;

/** The thread of this (kind, subject, principal), created on the first message. */
export async function threadFor(
  ctx: SpaContext,
  t: { kind: AssistantKind; subjectId: string; principal: string },
): Promise<string> {
  const db = ctx.database.db;
  const hash = principalHash(t.kind, t.principal);
  const [found] = await db
    .select({ id: assistantThreads.id })
    .from(assistantThreads)
    .where(
      and(
        eq(assistantThreads.kind, t.kind),
        eq(assistantThreads.subjectId, t.subjectId),
        eq(assistantThreads.principalHash, hash),
      ),
    )
    .orderBy(desc(assistantThreads.createdAt), desc(assistantThreads.id))
    .limit(1);
  if (found) return found.id;
  const id = newId();
  await db
    .insert(assistantThreads)
    .values({ id, kind: t.kind, subjectId: t.subjectId, principalHash: hash, createdAt: ctx.clock.now() });
  return id;
}

/** The thread's latest user and assistant messages, oldest first (stored masked). */
export async function threadHistory(
  ctx: SpaContext,
  threadId: string,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const rows = await ctx.database.db
    .select({ role: assistantMessages.role, content: assistantMessages.content })
    .from(assistantMessages)
    .where(and(eq(assistantMessages.threadId, threadId), sql`${assistantMessages.role} in ('user', 'assistant')`))
    .orderBy(desc(assistantMessages.at), desc(assistantMessages.id))
    .limit(HISTORY_MESSAGES);
  return rows.reverse().map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
}

/** Stores what a person typed, before the turn runs, so a crash still keeps the question. Returns the message id. */
export async function storeUserMessage(ctx: SpaContext, threadId: string, text: string): Promise<string> {
  const id = newId();
  await ctx.database.db.insert(assistantMessages).values({
    id,
    threadId,
    role: "user",
    content: maskPiiText(text),
    at: ctx.clock.now(),
  });
  return id;
}

/** Stores the tool calls and the answer of a finished turn, in order. */
export async function storeTurn(ctx: SpaContext, threadId: string, result: TurnResult, tag: string): Promise<void> {
  const at = ctx.clock.now();
  const db = ctx.database.db;
  for (const t of result.tools)
    await db.insert(assistantMessages).values({
      id: newId(),
      threadId,
      role: "tool",
      content: JSON.stringify({ args: maskPii(t.args), ok: t.ok, resultSha256: t.resultSha256 }),
      toolName: t.name,
      at,
    });
  await db.insert(assistantMessages).values({
    id: newId(),
    threadId,
    role: "assistant",
    content: maskPiiText(result.reply),
    verified: result.verified,
    unverifiedValues: result.unverified,
    scopeBlocked: result.kind === "scope_blocked",
    modelTag: tag,
    at,
  });
}

export const hourBucket = (ctx: SpaContext): string => ctx.clock.now().toISOString().slice(0, 13);
export const dayBucket = (ctx: SpaContext): string => ctx.clock.today();

/**
 * Counts one use of `bucket` for `key` and says whether it is within `limit`. One atomic upsert, so two requests at once
 * can't both take the last place. The key is stored hashed.
 */
export async function takeRateLimit(
  ctx: SpaContext,
  o: { key: string; bucket: string; limit: number },
): Promise<boolean> {
  const [r] = await ctx.database.db
    .insert(assistantRateLimits)
    .values({ keyHash: sha256(o.key), bucket: o.bucket, n: 1 })
    .onConflictDoUpdate({
      target: [assistantRateLimits.keyHash, assistantRateLimits.bucket],
      set: { n: sql`${assistantRateLimits.n} + 1` },
    })
    .returning({ n: assistantRateLimits.n });
  return (r?.n ?? Number.POSITIVE_INFINITY) <= o.limit;
}

/** The thread's messages, for staff reading and for tests. */
export async function threadMessages(ctx: SpaContext, threadId: string) {
  return ctx.database.db
    .select()
    .from(assistantMessages)
    .where(eq(assistantMessages.threadId, threadId))
    .orderBy(asc(assistantMessages.at), asc(assistantMessages.id));
}
