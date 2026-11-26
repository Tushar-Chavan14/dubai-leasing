import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("C32 projects, buildings, units and price lists (spa_test)", () => {
  let db: SpaDatabase;
  let seq = 0;
  let companyId: string;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  const id = () => crypto.randomUUID();
  const project = async (code = `P-${++seq}`): Promise<string> => {
    const pid = id();
    await q("insert into projects (id, code, name, developer_company_id) values ($1, $2, 'Marina Heights', $3)", [
      pid,
      code,
      companyId,
    ]);
    return pid;
  };
  const building = async (projectId: string, code = `B-${++seq}`): Promise<string> => {
    const bid = id();
    await q("insert into buildings (id, project_id, code, name) values ($1, $2, $3, 'Tower')", [bid, projectId, code]);
    return bid;
  };
  const unit = async (buildingId: string | null = null): Promise<string> => {
    const uid = id();
    await q("insert into units (id, code, building_id) values ($1, $2, $3)", [uid, `U-${++seq}`, buildingId]);
    return uid;
  };
  const list = async (projectId: string, version: number): Promise<string> => {
    const lid = id();
    await q("insert into price_lists (id, project_id, version, created_by) values ($1, $2, $3, 'user:x')", [
      lid,
      projectId,
      version,
    ]);
    return lid;
  };
  const item = (listId: string, unitId: string, price = 1_000_000) =>
    q("insert into price_list_items (price_list_id, unit_id, price_fils) values ($1, $2, $3)", [listId, unitId, price]);
  const deal = (unitId: string | null, projectCode: string | null = null) =>
    unitId
      ? q(
          "insert into deals (id, deal_type, unit_id, price_fils, created_by, rules_version) values ($1, 'primary_offplan', $2, 1000, 'system', 'r')",
          [id(), unitId],
        )
      : q("insert into listings (id, ref) values ($1, $2) returning id", [id(), `L-C32-${++seq}`]).then((r) =>
          q(
            "insert into deals (id, deal_type, listing_id, price_fils, created_by, rules_version, project_code) values ($1, 'resale_offplan', $2, 1000, 'system', 'r', $3)",
            [id(), r.rows[0].id, projectCode],
          ),
        );

  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
    companyId = id();
    await q(
      "insert into companies (id, name, kind, created_at) values ($1, 'Fictional Developments', 'developer', now())",
      [companyId],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  test("a project code and a building code are unique where they should be", async () => {
    const p = await project("DUP-1");
    expect(await refusal(project("DUP-1"))).toContain("projects_code_unique");
    const code = "B-DUP";
    await building(p, code);
    expect(await refusal(building(p, code))).toContain("buildings_project_code_uq");
    // the same building code in another project is fine
    expect(await refusal(building(await project(), code))).toBe("accepted");
  });

  test("a price list version is unique per project and a price must be above zero", async () => {
    const p = await project();
    const l = await list(p, 1);
    expect(await refusal(list(p, 1))).toContain("price_lists_project_version_uq");
    expect(await refusal(list(p, 0))).toContain("price_lists_version");
    const u = await unit(await building(p));
    expect(await refusal(item(l, u, 0))).toContain("price_list_items_price_positive");
    expect(await refusal(item(l, u, -5))).toContain("price_list_items_price_positive");
    expect(await refusal(item(l, u, 100))).toBe("accepted");
  });

  test("a unit sits in one building and is placed once", async () => {
    const p = await project();
    const b1 = await building(p);
    const b2 = await building(p);
    const u = await unit(); // legacy unit, no building
    expect(await refusal(q("update units set building_id = $1 where id = $2", [b1, u]))).toBe("accepted");
    expect(await refusal(q("update units set building_id = $1 where id = $2", [b2, u]))).toContain("building");
    expect(await refusal(q("update units set building_id = null where id = $1", [u]))).toContain("building");
    // an ordinary state change on a placed unit still works
    expect(await refusal(q("update units set state = 'HELD' where id = $1", [u]))).toBe("accepted");
  });

  test("an item's unit must be in a building of the list's project", async () => {
    const p = await project();
    const other = await project();
    const l = await list(p, 1);
    expect(await refusal(item(l, await unit()))).toContain("price_list_items");
    expect(await refusal(item(l, await unit(await building(other))))).toContain("price_list_items");
    expect(await refusal(item(l, await unit(await building(p))))).toBe("accepted");
  });

  test("a draft publishes once, only with items, and changes nothing else", async () => {
    const p = await project();
    const u = await unit(await building(p));
    const empty = await list(p, 1);
    expect(await refusal(q("update price_lists set published_at = now() where id = $1", [empty]))).toContain(
      "price_lists",
    );
    const l = await list(p, 2);
    await item(l, u);
    expect(await refusal(q("update price_lists set version = 9 where id = $1", [l]))).toContain("price_lists");
    expect(await refusal(q("update price_lists set published_at = now() where id = $1", [l]))).toBe("accepted");
    expect(await refusal(q("update price_lists set published_at = now() where id = $1", [l]))).toContain("published");
  });

  test("a published list and its items never change, are never deleted and take no new item", async () => {
    const p = await project();
    const b = await building(p);
    const u1 = await unit(b);
    const u2 = await unit(b);
    const l = await list(p, 1);
    await item(l, u1);
    await q("update price_lists set published_at = now() where id = $1", [l]);
    for (const sql of [
      "update price_lists set published_at = null where id = $1",
      "update price_lists set created_by = 'x' where id = $1",
      "update price_lists set project_id = project_id where id = $1",
      "delete from price_lists where id = $1",
      "update price_list_items set price_fils = 5 where price_list_id = $1",
      "delete from price_list_items where price_list_id = $1",
    ])
      expect(await refusal(q(sql, [l]))).toContain("published");
    expect(await refusal(item(l, u2))).toContain("published");
    // a new version is a new list
    const next = await list(p, 2);
    expect(await refusal(item(next, u1, 2_000_000))).toBe("accepted");
  });

  test("a draft list can still be removed with its items (nothing was published)", async () => {
    const p = await project();
    const l = await list(p, 1);
    await item(l, await unit(await building(p)));
    expect(await refusal(q("delete from price_list_items where price_list_id = $1", [l]))).toBe("accepted");
    expect(await refusal(q("delete from price_lists where id = $1", [l]))).toBe("accepted");
  });

  test("the project code and its buildings are free to change until a deal exists on the project", async () => {
    const p = await project("FREE-1");
    const b = await building(p, "A");
    expect(await refusal(q("update projects set code = 'FREE-2' where id = $1", [p]))).toBe("accepted");
    expect(await refusal(q("update buildings set code = 'A2', name = 'Tower 2' where id = $1", [b]))).toBe("accepted");
    expect(await refusal(q("update projects set name = 'Renamed' where id = $1", [p]))).toBe("accepted");
  });

  test("a deal on one of the project's units fixes the project code and the buildings", async () => {
    const p = await project("FIX-1");
    const b = await building(p, "A");
    await deal(await unit(b));
    expect(await refusal(q("update projects set code = 'FIX-9' where id = $1", [p]))).toContain("project");
    expect(await refusal(q("update buildings set code = 'Z' where id = $1", [b]))).toContain("building");
    expect(await refusal(q("update buildings set name = 'Renamed' where id = $1", [b]))).toContain("building");
    // other fields are not fixed
    expect(await refusal(q("update projects set name = 'Marina Heights II' where id = $1", [p]))).toBe("accepted");
  });

  test("a resale that names the project's code fixes the code too", async () => {
    const p = await project("FIX-2");
    await deal(null, "FIX-2");
    expect(await refusal(q("update projects set code = 'FIX-3' where id = $1", [p]))).toContain("project");
  });

  test("projects and buildings are never deleted", async () => {
    const p = await project();
    const b = await building(p);
    expect(await refusal(q("delete from buildings where id = $1", [b]))).toContain("buildings");
    expect(await refusal(q("delete from projects where id = $1", [p]))).toContain("projects");
  });

  test("none of the four new tables can be emptied", async () => {
    for (const t of ["projects", "buildings", "price_lists", "price_list_items"])
      expect(await refusal(q(`truncate ${t} cascade`))).toContain("TRUNCATE");
  });
});
