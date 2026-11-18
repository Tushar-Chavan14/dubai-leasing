import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { contractRules, type Database, leaseEvents, rentRules } from "@leasing/db";
import { and, eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { valuesNotSaid } from "../src/manager/config-changes.ts";
import { fitsSubtype, fitsUnit, normaliseSubtypes, overlaps, specificity } from "../src/manager/rule-scope.ts";
import { addStaff, freshDatabase, noDb, testCompany, testContext } from "./harness.ts";

describe("rule scope (D68)", () => {
  test("fitsSubtype: an empty list covers every type, a list only its types", () => {
    expect(fitsSubtype({ subtypes: [] }, "villa")).toBe(true);
    expect(fitsSubtype({ subtypes: [] }, null)).toBe(true);
    expect(fitsSubtype({ subtypes: ["villa", "apartment"] }, "villa")).toBe(true);
    expect(fitsSubtype({ subtypes: ["villa", "apartment"] }, "townhouse")).toBe(false);
    expect(fitsSubtype({ subtypes: ["villa"] }, null)).toBe(false);
  });

  test("fitsUnit: another emirate or community never fits; null means any", () => {
    const unit = { emirate: "dubai" as const, subtype: "villa", community: "JVC" };
    expect(fitsUnit({ emirate: null, subtypes: [] }, unit)).toBe(true);
    expect(fitsUnit({ emirate: "dubai", subtypes: ["villa"] }, unit)).toBe(true);
    expect(fitsUnit({ emirate: "sharjah", subtypes: [] }, unit)).toBe(false);
    expect(fitsUnit({ emirate: "dubai", subtypes: [], community: "Marina" }, unit)).toBe(false);
    expect(fitsUnit({ emirate: "dubai", subtypes: [], community: "JVC" }, unit)).toBe(true);
  });

  test("specificity: emirate beats community beats types", () => {
    const any = specificity({ emirate: null, subtypes: [] });
    const typed = specificity({ emirate: null, subtypes: ["villa"] });
    const emirate = specificity({ emirate: "dubai", subtypes: [] });
    const community = specificity({ emirate: "dubai", subtypes: [], community: "JVC" });
    const all = specificity({ emirate: "dubai", subtypes: ["villa"], community: "JVC" });
    expect([any < typed, typed < emirate, emirate < community, community < all]).toEqual([true, true, true, true]);
  });

  test("overlaps: same emirate and community, and both all-types or sharing a type", () => {
    const r = (emirate: "dubai" | "sharjah" | null, subtypes: string[], community: string | null = null) => ({
      emirate,
      subtypes,
      community,
    });
    expect(overlaps(r("dubai", []), r("dubai", []))).toBe(true);
    expect(overlaps(r("dubai", ["villa", "apartment"]), r("dubai", ["apartment"]))).toBe(true);
    expect(overlaps(r("dubai", ["villa"]), r("dubai", ["apartment"]))).toBe(false);
    // All types and some types don't compete: the named one wins by specificity.
    expect(overlaps(r("dubai", []), r("dubai", ["villa"]))).toBe(false);
    expect(overlaps(r("dubai", ["villa"]), r("sharjah", ["villa"]))).toBe(false);
    expect(overlaps(r(null, ["villa"]), r("dubai", ["villa"]))).toBe(false);
    expect(overlaps(r("dubai", ["villa"], "JVC"), r("dubai", ["villa"]))).toBe(false);
    expect(overlaps(r("dubai", ["villa"], "JVC"), r("dubai", ["villa"], "JVC"))).toBe(true);
  });

  test("normaliseSubtypes: no duplicates, sorted", () => {
    expect(normaliseSubtypes(["villa", "apartment", "villa"])).toEqual(["apartment", "villa"]);
    expect(normaliseSubtypes(undefined)).toEqual([]);
  });
});

describe("copilot rule types must be the user's words (D68)", () => {
  const base = {
    kind: "contract_rule",
    company: "Silverline",
    category: "residential",
    tenures: ["annual"],
    minCheques: 1,
    maxCheques: 4,
    replaceRuleId: "01a1cfca-f3ff-7eb8-ba8e-067f7faf06cd",
  };
  const previous = {
    category: "residential",
    subtypes: ["apartment", "villa"],
    emirate: null,
    tenures: ["annual"],
    minCheques: 1,
    maxCheques: 4,
  };
  const check = (change: Record<string, unknown>, msg: string) =>
    valuesNotSaid({ ...base, ...change } as never, msg, undefined, previous);

  test("adding a type: only the added type must be named", () => {
    const add = { subtypes: ["apartment", "townhouse", "villa"] };
    expect(check(add, "add townhouse to Silverline's villa rule")).toEqual([]);
    expect(check(add, "add one more type to Silverline's villa rule")).toEqual(["type"]);
  });

  test("taking a type off must be named; omitted types keep the rule's own", () => {
    expect(check({ subtypes: ["apartment"] }, "Silverline's apartment rule: up to 4 cheques")).toEqual(["type"]);
    expect(check({ subtypes: ["apartment"] }, "take villa off Silverline's apartment rule")).toEqual([]);
    expect(check({}, "Silverline's villa rule: 1 to 4 cheques")).toEqual([]);
  });

  test("going to all types must be said, and not negated", () => {
    expect(check({ subtypes: [] }, "Silverline's villa rule should apply to all types")).toEqual([]);
    expect(check({ subtypes: [] }, "Silverline's villa rule: 1 to 4 cheques")).toEqual(["all types"]);
    expect(check({ subtypes: [] }, "Silverline's villa rule is not for all types")).toEqual(["all types"]);
  });

  test("a new rule names every type it covers", () => {
    const made = { kind: "contract_rule", company: "Silverline", category: "residential", tenures: ["annual"] };
    const msg = "Silverline residential villa contracts: annual, 1 to 4 cheques";
    const change = { ...made, minCheques: 1, maxCheques: 4, subtypes: ["villa", "apartment"] } as never;
    expect(valuesNotSaid(change, msg)).toEqual(["type"]);
    expect(valuesNotSaid(change, `${msg}, apartments too`)).toEqual([]);
  });
});

describe.skipIf(noDb)("rule lists, overlap and copy (D68, Postgres)", () => {
  let database: Database;
  let send: (role: string, path: string, method?: string, body?: unknown) => Response | Promise<Response>;
  let companyId = "";

  beforeEach(async () => {
    database = await freshDatabase();
    const t = testContext(database, "2026-10-19T04:00:00Z");
    companyId = await testCompany(database, { slug: "scope-co", name: "Scope Co", rules: false });
    const app = createApi(t.ctx, {
      sessionSecret: "s",
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-"))),
    });
    const tokens: Record<string, string> = {};
    for (const role of ["leasing_officer", "admin"] as const)
      tokens[role] = issueToken("s", (await addStaff(database, role)).id, Date.now());
    send = (role, path, method = "GET", body) =>
      app.request(`/api${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { "content-type": "application/json", authorization: `Bearer ${tokens[role]}` },
      });
  });

  const contract = (over: Record<string, unknown> = {}) => ({
    companyId,
    category: "residential",
    emirate: "dubai",
    tenures: ["annual"],
    minCheques: 1,
    maxCheques: 4,
    clauseIds: [],
    ...over,
  });
  const code = async (r: Response) => ((await r.json()) as { code: string }).code;

  test("one contract rule covers several types; a second rule naming one of them is refused", async () => {
    const made = await send("admin", "/contract-rules", "POST", contract({ subtypes: ["villa", "apartment"] }));
    expect(made.status).toBe(201);
    expect(((await made.json()) as { subtypes: string[] }).subtypes).toEqual(["apartment", "villa"]);
    const clash = await send("admin", "/contract-rules", "POST", contract({ subtypes: ["villa", "townhouse"] }));
    expect(clash.status).toBe(422);
    expect(await code(clash)).toBe("rule_overlap");
    // Another type, another emirate, or all types next to some types: fine.
    expect((await send("admin", "/contract-rules", "POST", contract({ subtypes: ["townhouse"] }))).status).toBe(201);
    expect(
      (await send("admin", "/contract-rules", "POST", contract({ emirate: "sharjah", subtypes: ["villa"] }))).status,
    ).toBe(201);
    expect((await send("admin", "/contract-rules", "POST", contract())).status).toBe(201);
    // Two all-types rules for the same emirate compete.
    expect(await code(await send("admin", "/contract-rules", "POST", contract()))).toBe("rule_overlap");
  });

  test("a type of another category is refused; a single subtype (pre-D68 clients) is read as a list", async () => {
    const bad = await send("admin", "/contract-rules", "POST", contract({ subtypes: ["office"] }));
    expect(bad.status).toBe(422);
    expect(await code(bad)).toBe("bad_subtype");
    const old = await send("admin", "/contract-rules", "POST", contract({ subtype: "villa" }));
    expect(old.status).toBe(201);
    expect(((await old.json()) as { subtypes: string[] }).subtypes).toEqual(["villa"]);
  });

  test("replacing a rule doesn't clash with itself; omitted types keep the rule's own", async () => {
    const made = (await (await send("admin", "/contract-rules", "POST", contract({ subtypes: ["villa"] }))).json()) as {
      id: string;
    };
    const noTypes = contract({ maxCheques: 6 });
    const put = await send("admin", `/contract-rules/${made.id}`, "PUT", noTypes);
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ subtypes: ["villa"], maxCheques: 6 });
  });

  test("rent rules: overlap per emirate and community", async () => {
    const rent = (over: Record<string, unknown> = {}) => ({
      companyId,
      category: "residential",
      emirate: "dubai",
      minPctBp: -500,
      maxPctBp: 1000,
      ...over,
    });
    expect((await send("admin", "/rent-rules", "POST", rent({ subtypes: ["villa", "apartment"] }))).status).toBe(201);
    expect(await code(await send("admin", "/rent-rules", "POST", rent({ subtypes: ["apartment"] })))).toBe(
      "rule_overlap",
    );
    expect(
      (await send("admin", "/rent-rules", "POST", rent({ subtypes: ["apartment"], community: "JVC" }))).status,
    ).toBe(201);
  });

  test("copy to emirate: admin only, same values, audited; overlap and community rules refused", async () => {
    const made = (await (
      await send("admin", "/contract-rules", "POST", contract({ subtypes: ["villa", "apartment"], maxCheques: 6 }))
    ).json()) as { id: string };
    expect(
      (await send("leasing_officer", `/contract-rules/${made.id}/copy`, "POST", { emirate: "sharjah" })).status,
    ).toBe(403);
    const copy = await send("admin", `/contract-rules/${made.id}/copy`, "POST", { emirate: "sharjah" });
    expect(copy.status).toBe(201);
    const { rule } = (await copy.json()) as { rule: { id: string } };
    const [row] = await database.db.select().from(contractRules).where(eq(contractRules.id, rule.id));
    expect(row).toMatchObject({ emirate: "sharjah", subtypes: ["apartment", "villa"], maxCheques: 6, active: true });
    const [ev] = await database.db
      .select()
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, companyId), eq(leaseEvents.type, "CONTRACT_RULE_COPIED")));
    expect(ev?.payload).toMatchObject({ fromRuleId: made.id, emirate: "sharjah" });
    // Copying again to Sharjah clashes with the copy.
    expect(await code(await send("admin", `/contract-rules/${made.id}/copy`, "POST", { emirate: "sharjah" }))).toBe(
      "rule_overlap",
    );
    // A rent rule for one community is not copied.
    const r = (await (
      await send("admin", "/rent-rules", "POST", {
        companyId,
        category: "residential",
        emirate: "dubai",
        community: "JVC",
        minPctBp: -500,
        maxPctBp: 1000,
      })
    ).json()) as { id: string };
    expect(await code(await send("admin", `/rent-rules/${r.id}/copy`, "POST", { emirate: "sharjah" }))).toBe(
      "community_rule",
    );
    expect(await database.db.select().from(rentRules).where(eq(rentRules.emirate, "sharjah"))).toHaveLength(0);
  });
});
