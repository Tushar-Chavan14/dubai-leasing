import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The portal's only table (S70). The portal proves who a person is and nothing else: no role, no module data. No row is
 * created by the portal's own pages: `bun run portal:create-account` writes it.
 */
export const portalAccounts = pgTable(
  "portal_accounts",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [check("portal_accounts_email_lower", sql`${t.email} = lower(${t.email})`)],
);
