import { newId } from "@platform/kernel/ids";
import { chaseTemplateProblems, type SpaRole, hasRole } from "@spa/core";
import { chaseTemplates, type SpaDb, withSpaTx } from "@spa/db";
import { and, desc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";

type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };

/** The settings record chase-template events are logged against (like the AML policy's: no deal, just the settings). */
export const CHASE_TEMPLATE_ENTITY = { kind: "settings" as const, id: "00000000-0000-7000-8000-000000000025" };

const Input = z.strictObject({ subject: z.string().max(2000), body: z.string().max(20000) });

/**
 * An admin saves a chase email as a draft (S23, S60): the next version of the one kind. Code allows only the placeholders
 * `@spa/core` lists and refuses any word a chase may never use (AML, screening, ...). A draft is never edited: a change is
 * a new version. Only an admin writes one.
 */
export async function createChaseTemplate(
  ctx: SpaContext,
  user: Person,
  input: unknown,
): Promise<{ id: string; version: number; status: "draft" }> {
  if (!hasRole(user, "admin")) throw forbidden("only an admin writes a chase email");
  const parsed = Input.safeParse(input);
  if (!parsed.success) throw unprocessable("invalid_chase_template", "send a subject and a body");
  const problems = chaseTemplateProblems(parsed.data);
  if (problems.length) throw unprocessable("invalid_chase_template", "the chase email isn't valid", problems);
  return withSpaTx(ctx.database, async (tx) => {
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext('chase_templates:chase'))`);
    const [{ last } = { last: null }] = await tx.db
      .select({ last: max(chaseTemplates.version) })
      .from(chaseTemplates)
      .where(eq(chaseTemplates.kind, "chase"));
    const version = (last ?? 0) + 1;
    const id = newId();
    await tx.db.insert(chaseTemplates).values({
      id,
      kind: "chase",
      version,
      subject: parsed.data.subject.trim(),
      body: parsed.data.body.trim(),
      status: "draft",
      createdBy: `user:${user.id}`,
      createdAt: ctx.clock.now(),
    });
    await appendDealEvent(tx, ctx, {
      entity: CHASE_TEMPLATE_ENTITY,
      type: "CHASE_TEMPLATE_CREATED",
      actor: `user:${user.id}`,
      payload: { templateId: id, version },
    });
    return { id, version, status: "draft" as const };
  });
}

/**
 * An admin publishes a draft (S23, S60). The text is checked again first. The version approved last is the one chases
 * use; the one before it is retired. An approved version never changes (trigger).
 */
export async function approveChaseTemplate(
  ctx: SpaContext,
  user: Person,
  id: string,
): Promise<{ id: string; version: number; status: "approved" }> {
  if (!hasRole(user, "admin")) throw forbidden("only an admin approves a chase email");
  return withSpaTx(ctx.database, async (tx) => {
    const [t] = await tx.db.select().from(chaseTemplates).where(eq(chaseTemplates.id, id)).for("update");
    if (!t) throw notFound("chase email");
    if (t.status !== "draft") throw conflict("not_a_draft", `this chase email is already ${t.status}`);
    const problems = chaseTemplateProblems(t);
    if (problems.length) throw unprocessable("invalid_chase_template", "the chase email isn't valid", problems);
    await tx.db
      .update(chaseTemplates)
      .set({ status: "retired" })
      .where(and(eq(chaseTemplates.kind, t.kind), eq(chaseTemplates.status, "approved")));
    await tx.db
      .update(chaseTemplates)
      .set({ status: "approved", approvedBy: `user:${user.id}`, approvedAt: ctx.clock.now() })
      .where(eq(chaseTemplates.id, id));
    await appendDealEvent(tx, ctx, {
      entity: CHASE_TEMPLATE_ENTITY,
      type: "CHASE_TEMPLATE_APPROVED",
      actor: `user:${user.id}`,
      payload: { templateId: id, version: t.version },
    });
    return { id, version: t.version, status: "approved" as const };
  });
}

/** The approved version chases use now, or null (nothing is sent without one). */
export async function currentChaseTemplate(db: SpaDb): Promise<typeof chaseTemplates.$inferSelect | null> {
  const [t] = await db
    .select()
    .from(chaseTemplates)
    .where(and(eq(chaseTemplates.kind, "chase"), eq(chaseTemplates.status, "approved")))
    .orderBy(desc(chaseTemplates.version))
    .limit(1);
  return t ?? null;
}
