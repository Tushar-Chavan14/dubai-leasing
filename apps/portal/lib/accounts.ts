import { checkPassword, hashPassword } from "@platform/kernel/password";
import { and, eq } from "drizzle-orm";
import type { PortalDatabase } from "./db.ts";
import { portalAccounts } from "./schema.ts";

export interface Account {
  id: string;
  email: string;
}
/** What the sign-in check needs: the account row for an email (any case), with its hash. */
export interface AccountStore {
  find(email: string): Promise<{ id: string; email: string; passwordHash: string; active: boolean } | null>;
}

export const normaliseEmail = (e: string): string => e.trim().toLowerCase();

export function accountStore(database: PortalDatabase): AccountStore {
  return {
    async find(email) {
      const [a] = await database.db
        .select()
        .from(portalAccounts)
        .where(eq(portalAccounts.email, normaliseEmail(email)));
      return a ?? null;
    },
  };
}

/**
 * The account for a right email and password, else null. A wrong email, a wrong password, an inactive account and
 * an unknown account are one answer, and each takes one hash check (S70).
 */
export async function authenticate(store: AccountStore, email: string, password: string): Promise<Account | null> {
  const a = await store.find(email);
  const ok = await checkPassword(password, a?.active ? a.passwordHash : null);
  return a && a.active && ok ? { id: a.id, email: a.email } : null;
}

/** Writes one account (the CLI only). Refuses an email that already exists. */
export async function createAccount(database: PortalDatabase, email: string, password: string): Promise<Account> {
  const row = { id: Bun.randomUUIDv7(), email: normaliseEmail(email), passwordHash: await hashPassword(password) };
  await database.db.insert(portalAccounts).values(row);
  return { id: row.id, email: row.email };
}

export const activeAccount = async (database: PortalDatabase, id: string): Promise<Account | null> => {
  const [a] = await database.db
    .select()
    .from(portalAccounts)
    .where(and(eq(portalAccounts.id, id), eq(portalAccounts.active, true)));
  return a ? { id: a.id, email: a.email } : null;
};
