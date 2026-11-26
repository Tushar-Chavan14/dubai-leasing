import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("S75 unit, project and listing details and spa_media (spa_test)", () => {
  let db: SpaDatabase;
  let n = 0;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  const unit = (cols: string, val: unknown) =>
    q(`insert into units (id, code, ${cols}) values ($1, $2, $3)`, [crypto.randomUUID(), `U-M2-${++n}`, val]);

  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await db.pool.end();
  });

  test("a villa studio is accepted; 11 bedrooms and a castle are not", async () => {
    await q("insert into units (id, code, type, bedrooms) values ($1, 'U-M2-A', 'villa', 0)", [crypto.randomUUID()]);
    expect(await refusal(unit("bedrooms", 11))).toContain("units_bedrooms");
    expect(await refusal(unit("type", "castle"))).toContain("units_type");
    expect(await refusal(unit("internal_sqft", 0))).toContain("units_internal_sqft");
    expect(await refusal(unit("floor", 201))).toContain("units_floor");
  });

  test("project text limits and listing enums hold", async () => {
    expect(
      await refusal(
        q("insert into listings (id, ref, furnished) values ($1, 'L-M2-1', 'lots')", [crypto.randomUUID()]),
      ),
    ).toContain("listings_furnished");
    expect(
      await refusal(
        q("insert into listings (id, ref, unit_type) values ($1, 'L-M2-2', 'castle')", [crypto.randomUUID()]),
      ),
    ).toContain("listings_unit_type");
  });

  test("two spa_media rows with the same owner and sha256 clash; another owner does not", async () => {
    const owner = crypto.randomUUID();
    const ins = (o: string) =>
      q(
        "insert into spa_media (id, owner_kind, owner_id, sha256, path, mime, bytes, sort, uploaded_by) values ($1, 'unit', $2, 'abc', 'ab/abc.png', 'image/png', 10, 0, 'user:x')",
        [crypto.randomUUID(), o],
      );
    await ins(owner);
    expect(await refusal(ins(owner))).toContain("spa_media_owner_sha_uq");
    expect(await refusal(ins(crypto.randomUUID()))).toBe("accepted");
    expect(
      await refusal(
        q(
          "insert into spa_media (id, owner_kind, owner_id, sha256, path, mime, bytes, sort, uploaded_by) values ($1, 'deal', $2, 'z', 'p', 'image/png', 1, 0, 'x')",
          [crypto.randomUUID(), owner],
        ),
      ),
    ).toContain("spa_media_owner_kind");
  });
});
