import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { type SpaDatabase, spaDemoSettings, spaUsers } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

/** The database error a refused write gives (drizzle wraps the driver's), as text naming the constraint. */
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { message?: string; cause?: { message?: string; constraint?: string } }) =>
      `${e.cause?.constraint ?? ""} ${e.cause?.message ?? e.message ?? ""}`,
  );

const url = spaTestDatabaseUrl();

describe.skipIf(!url)("spa database (S2)", () => {
  let database: SpaDatabase;
  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await database?.close();
  });
  test("the first migration creates only spa_users and spa_demo_settings", async () => {
    const r = await database.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(r.rows.map((x) => x.table_name)).toEqual(["spa_demo_settings", "spa_users"]);
  });
  test("a user role must be an SPA role; email is unique and lower case", async () => {
    const user = { id: crypto.randomUUID(), email: "a@example.test", name: "A", passwordHash: "h" };
    await database.db.insert(spaUsers).values({ ...user, role: "legal" });
    const other = { ...user, id: crypto.randomUUID(), email: "b@example.test" };
    expect(
      await refusal(database.db.insert(spaUsers).values({ ...other, role: "leasing_officer" as never })),
    ).toContain("spa_users_role");
    expect(
      await refusal(database.db.insert(spaUsers).values({ ...user, id: crypto.randomUUID(), role: "mlro" })),
    ).toContain("spa_users_email_unique");
    expect(
      await refusal(database.db.insert(spaUsers).values({ ...other, email: "B@example.test", role: "mlro" })),
    ).toContain("spa_users_email_lower");
    // Demo users have no password.
    await database.db.insert(spaUsers).values({ ...other, role: "mlro", passwordHash: null });
  });
  test("the demo clock has one row only", async () => {
    await database.db.insert(spaDemoSettings).values({ id: 1, clockOffsetMs: 0 });
    expect(await refusal(database.db.insert(spaDemoSettings).values({ id: 2, clockOffsetMs: 0 }))).toContain(
      "spa_demo_settings_one_row",
    );
    const [row] = await database.db.select().from(spaDemoSettings).where(eq(spaDemoSettings.id, 1));
    expect(row?.clockOffsetMs).toBe(0);
  });
  test("refuses to reset a database without 'test' in its name", async () => {
    await expect(freshSpaDatabase("postgres://u@localhost:5432/spa")).rejects.toThrow("lacks 'test'");
  });
});
