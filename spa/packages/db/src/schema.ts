import type { SpaRole } from "@spa/core";
import { sql } from "drizzle-orm";
import { bigint, boolean, check, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The `spa` database (decision S2). Nothing here is shared with leasing: own users, own demo clock, own jobs
 * (pg-boss creates its `pgboss` schema itself when the engine starts). P2 needs only these two tables.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

const ROLES: readonly SpaRole[] = [
  "sales_officer",
  "sales_manager",
  "sales_admin",
  "legal",
  "compliance_officer",
  "mlro",
  "finance",
  "admin",
];

/** SPA staff (S3). A password is stored only as an argon2id hash; demo users have none (they use the demo picker). */
export const spaUsers = pgTable(
  "spa_users",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").$type<SpaRole>().notNull(),
    passwordHash: text("password_hash"),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("spa_users_role", sql.raw(`${t.role.name} in (${ROLES.map((r) => `'${r}'`).join(", ")})`)),
    // Stored lower case, so the unique email is unique whatever case it is typed in.
    check("spa_users_email_lower", sql`${t.email} = lower(${t.email})`),
  ],
);

/** The SPA demo clock (S2): one row, an offset in ms added to system time. */
export const spaDemoSettings = pgTable(
  "spa_demo_settings",
  {
    id: smallint("id").primaryKey().default(1),
    clockOffsetMs: bigint("clock_offset_ms", { mode: "number" }).notNull().default(0),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [check("spa_demo_settings_one_row", sql`${t.id} = 1`)],
);
