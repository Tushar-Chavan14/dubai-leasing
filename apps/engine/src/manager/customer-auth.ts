import { randomInt, timingSafeEqual } from "node:crypto";
import { loginCodeEmail } from "@leasing/adapters";
import {
  type CustomerAccount,
  CustomerEmail,
  CustomerProfile,
  LoginCode,
  maskPiiText,
  newId,
  normalisePhone,
} from "@leasing/core";
import { sha256Hex } from "@leasing/core/tokens";
import { customerAccounts, customerLoginCodes, outboundMessages, withTx } from "@leasing/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { notFound, unauthorised, unprocessable } from "../errors.ts";
import { appendEvent } from "./events.ts";

/**
 * Customer login for the web chat: a 6-digit code emailed to the address, valid 10 minutes, five
 * wrong tries kill it, at most five codes per address per hour. A new code voids older ones.
 * Only a peppered hash of the code is stored. The email address is the account key (lowercased).
 */
const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;

const pepper = (ctx: EngineContext): string => {
  if (!ctx.sessionSecret) throw new Error("customer login needs SESSION_SECRET on the engine context");
  return ctx.sessionSecret;
};
const hashCode = (ctx: EngineContext, email: string, code: string) => sha256Hex(`${pepper(ctx)}:${email}:${code}`);
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const toAccount = (a: typeof customerAccounts.$inferSelect): CustomerAccount => ({
  id: a.id,
  email: a.email,
  fullName: a.fullName ?? "",
  phone: a.phone,
});

/**
 * Emails a sign-in code. Answers `{ sent: true }` whether or not the address has an account and
 * even when over the limit (then nothing is sent), so the response reveals nothing. `ipHash` is
 * for the route's per-IP limiter (Task 4); it is not stored.
 */
export async function requestLoginCode(
  ctx: EngineContext,
  rawEmail: unknown,
  _ipHash: string,
): Promise<{ sent: true }> {
  const email = CustomerEmail.parse(rawEmail);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const prepared = await withTx(ctx.database, async (tx) => {
    // Serialise requests for one address so the limit and the voiding can't race.
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`customer-login:${email}`}))`);
    const now = ctx.clock.now();
    const recent = await tx.db
      .select({ id: customerLoginCodes.id })
      .from(customerLoginCodes)
      .where(
        and(eq(customerLoginCodes.email, email), gt(customerLoginCodes.createdAt, new Date(now.getTime() - 3_600_000))),
      );
    if (recent.length >= MAX_CODES_PER_HOUR) return null;
    await tx.db
      .update(customerLoginCodes)
      .set({ voidedAt: now })
      .where(
        and(
          eq(customerLoginCodes.email, email),
          isNull(customerLoginCodes.usedAt),
          isNull(customerLoginCodes.voidedAt),
        ),
      );
    const id = newId();
    await tx.db.insert(customerLoginCodes).values({
      id,
      email,
      codeHash: hashCode(ctx, email, code),
      expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000),
      createdAt: now,
    });
    const mail = loginCodeEmail({ code, demo: ctx.demoMode });
    // Evidence row; the entity is the code row (the account may not exist yet).
    await tx.db.insert(outboundMessages).values({
      id: newId(),
      entityKind: "customer_account",
      entityId: id,
      purpose: "link",
      milestone: `login:${id}`,
      to: email,
      intendedTo: email,
      template: "login_code",
      subject: mail.subject,
      status: "sending",
      createdAt: now,
    });
    return { codeId: id, mail };
  });
  if (!prepared) return { sent: true };
  const receipt = await ctx.mailer.send({ to: email, ...prepared.mail }).catch(async (e: unknown) => {
    const error = maskPiiText(e instanceof Error ? e.message : String(e));
    await ctx.database.db
      .update(outboundMessages)
      .set({ status: "failed", error })
      .where(eq(outboundMessages.milestone, `login:${prepared.codeId}`));
    throw new Error("the sign-in email could not be sent");
  });
  const ok = receipt.accepted.some((a) => a.trim().toLowerCase() === receipt.deliveredTo.trim().toLowerCase());
  await ctx.database.db
    .update(outboundMessages)
    .set({
      status: ok ? "sent" : "failed",
      to: receipt.deliveredTo,
      messageId: receipt.messageId,
      smtpResponse: receipt.response,
      previewUrl: receipt.previewUrl ?? null,
      // The body holds the code, so the hash is of the rendered message like any other mail.
      bodySha256: sha256Hex(`${prepared.mail.text}\n${prepared.mail.html}`),
      attachmentSha256s: [],
      sentAt: ok ? ctx.clock.now() : null,
      error: ok ? null : maskPiiText(`recipient not accepted: ${receipt.response}`),
    })
    .where(eq(outboundMessages.milestone, `login:${prepared.codeId}`));
  return { sent: true };
}

/**
 * Checks a code. A wrong code counts a try (recorded even though the call then fails); the
 * fifth wrong try, an expired, used or voided code all answer the same 401.
 */
export async function verifyLoginCode(
  ctx: EngineContext,
  rawEmail: unknown,
  rawCode: unknown,
): Promise<{ account: CustomerAccount; needsProfile: boolean }> {
  const email = CustomerEmail.parse(rawEmail);
  const code = LoginCode.parse(rawCode);
  const given = hashCode(ctx, email, code);
  const result = await withTx(ctx.database, async (tx) => {
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`customer-login:${email}`}))`);
    const now = ctx.clock.now();
    const [row] = await tx.db
      .select()
      .from(customerLoginCodes)
      .where(eq(customerLoginCodes.email, email))
      .orderBy(desc(customerLoginCodes.createdAt), desc(customerLoginCodes.id))
      .limit(1)
      .for("update");
    if (!row || row.usedAt || row.voidedAt || row.expiresAt <= now || row.attempts >= MAX_ATTEMPTS) return null;
    if (!sameHash(row.codeHash, given)) {
      await tx.db
        .update(customerLoginCodes)
        .set({ attempts: row.attempts + 1 })
        .where(eq(customerLoginCodes.id, row.id));
      return null;
    }
    await tx.db.update(customerLoginCodes).set({ usedAt: now }).where(eq(customerLoginCodes.id, row.id));
    await tx.db
      .insert(customerAccounts)
      .values({ id: newId(), email, createdAt: now })
      .onConflictDoNothing({ target: customerAccounts.email });
    const [account] = await tx.db
      .update(customerAccounts)
      .set({ lastLoginAt: now })
      .where(eq(customerAccounts.email, email))
      .returning();
    await appendEvent(tx, ctx, {
      entity: { kind: "customer_account", id: account!.id },
      type: "CUSTOMER_LOGIN",
      actor: `customer:${account!.id}`,
      payload: { codeId: row.id },
    });
    return account!;
  });
  if (!result) throw unauthorised("that code is wrong or has expired");
  return { account: toAccount(result), needsProfile: !result.fullName };
}

/** Name (required) and phone (optional, normalised to +E.164) for a signed-in customer. */
export async function updateCustomerProfile(
  ctx: EngineContext,
  accountId: string,
  raw: unknown,
): Promise<CustomerAccount> {
  const input = CustomerProfile.parse(raw);
  let phone: string | null = null;
  if (input.phone?.trim()) {
    phone = normalisePhone(input.phone);
    if (!phone) throw unprocessable("that phone number doesn't look right", [], "invalid_phone");
  }
  return withTx(ctx.database, async (tx) => {
    const [a] = await tx.db
      .update(customerAccounts)
      .set({ fullName: input.fullName, phone })
      .where(eq(customerAccounts.id, accountId))
      .returning();
    if (!a) throw notFound("account");
    await appendEvent(tx, ctx, {
      entity: { kind: "customer_account", id: a.id },
      type: "CUSTOMER_PROFILE_UPDATED",
      actor: `customer:${a.id}`,
      payload: { hasPhone: phone !== null },
    });
    return toAccount(a);
  });
}
