import { newId } from "@platform/kernel/ids";
import type { SpaRole } from "@spa/core";
import { projectEscrowAccounts, type SpaDb, withSpaTx } from "@spa/db";
import { maskIban, parseIban } from "@spa/helpers";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { POLICY_ENTITY } from "./policy.ts";
import { hasAnyRole, hasRole } from "@spa/core";

type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };
/** Only an admin enters an escrow account; finance reads it (S55). */
const READ_ROLES: readonly SpaRole[] = ["admin", "finance"];

const EscrowInput = z.object({
  projectCode: z.string().trim().min(1).max(40),
  accountHolder: z.string().trim().min(1).max(200),
  iban: z.string().max(60),
  bankName: z.string().trim().min(1).max(120),
});

/** The project's current escrow account, or null: a deal without one can't count a payment (fail closed). */
export async function currentEscrowAccount(db: SpaDb, projectCode: string | null) {
  if (!projectCode) return null;
  const [row] = await db
    .select()
    .from(projectEscrowAccounts)
    .where(and(eq(projectEscrowAccounts.projectCode, projectCode), isNull(projectEscrowAccounts.supersededAt)));
  return row ?? null;
}

/**
 * An admin enters or changes a project's escrow account (S55). The IBAN is checked by code (`AE` plus 21 digits and
 * mod-97) and stored normalised. A change supersedes the current row and adds a new one: history is kept. The event
 * carries only a masked IBAN.
 */
export async function setEscrowAccount(ctx: SpaContext, input: unknown, user: Person): Promise<{ id: string }> {
  if (!hasRole(user, "admin")) throw forbidden("only an admin enters an escrow account");
  const parsed = EscrowInput.safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_escrow_account",
      "the escrow account isn't valid",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  const iban = parseIban(parsed.data.iban);
  if (!iban) throw unprocessable("invalid_iban", "the IBAN must be AE followed by 21 digits with a valid check");
  return withSpaTx(ctx.database, async (tx) => {
    const [current] = await tx.db
      .select()
      .from(projectEscrowAccounts)
      .where(
        and(eq(projectEscrowAccounts.projectCode, parsed.data.projectCode), isNull(projectEscrowAccounts.supersededAt)),
      )
      .for("update");
    if (current?.iban === iban && current.accountHolder === parsed.data.accountHolder)
      throw conflict("unchanged", "that is already the current escrow account");
    const now = ctx.clock.now();
    if (current)
      await tx.db
        .update(projectEscrowAccounts)
        .set({ supersededAt: now })
        .where(eq(projectEscrowAccounts.id, current.id));
    const id = newId();
    await tx.db.insert(projectEscrowAccounts).values({
      id,
      projectCode: parsed.data.projectCode,
      accountHolder: parsed.data.accountHolder,
      iban,
      bankName: parsed.data.bankName,
      enteredBy: `user:${user.id}`,
      validFrom: now,
    });
    await appendDealEvent(tx, ctx, {
      entity: POLICY_ENTITY,
      type: "ESCROW_ACCOUNT_SET",
      actor: `user:${user.id}`,
      payload: {
        projectCode: parsed.data.projectCode,
        account: maskIban(iban),
        bankName: parsed.data.bankName,
        replaced: current ? maskIban(current.iban) : null,
      },
    });
    return { id };
  });
}

/** Every escrow account version, newest first (admin and finance). */
export async function listEscrowAccounts(ctx: SpaContext, user: Person) {
  if (!hasAnyRole(user, READ_ROLES)) throw forbidden("you can't read the escrow accounts");
  const rows = await ctx.database.db
    .select()
    .from(projectEscrowAccounts)
    .orderBy(desc(projectEscrowAccounts.validFrom), desc(projectEscrowAccounts.id));
  return rows.map((r) => ({
    id: r.id,
    projectCode: r.projectCode,
    accountHolder: r.accountHolder,
    iban: r.iban,
    bankName: r.bankName,
    validFrom: r.validFrom.toISOString(),
    current: r.supersededAt === null,
  }));
}
