import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { DEFAULT_STYLE } from "@platform/readers/structure/look";
import type { ContractStructureData, TemplateBlank } from "@platform/readers/structure/schema";
import { dealEvents, type SpaDatabase, spaApprovals, spaTemplateVersions, spaUsers } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { decideApproval } from "../src/manager/approvals.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { addTemplateVersion, createTemplate, currentTemplate, remapBlank } from "../src/manager/templates.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
const ctx = (): SpaContext => ({
  database,
  clock: new FixedClock(new Date("2026-11-19T06:00:00Z")),
  facts: failClosedFacts,
});
const admin = { id: newId(), role: "admin" as const };
const legal = { id: newId(), role: "legal" as const };
const manager = { id: newId(), role: "sales_manager" as const };
const HASH = "a".repeat(64);
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );

const blank = (id: string, label: string, field: string, before = ""): TemplateBlank => ({
  id,
  kind: "underscore",
  marker: "____",
  label,
  field,
  source: "matched",
  fieldType: field === "price" ? "money_fils" : field === "leave_empty" ? null : "text",
  role: "field",
  sectionIndex: 0,
  before,
  after: "",
});

/** What the helper would return for a small fictional SPA; `wording` replaces the price clause. */
function read(opts: { priceClause?: string; buyerField?: string } = {}): ContractStructureData {
  const blanks = [
    blank("b1", "Name", "seller_name", "SELLER Name: "),
    blank("b2", "Name", opts.buyerField ?? "purchaser_name", "PURCHASER Name: "),
    blank("b3", "Unit no", "unit_no", "Unit no: "),
    blank("b4", "Purchase price", "price", "The purchase price is AED "),
    blank("b5", "Payment plan", "payment_plan", "paid as per "),
  ];
  return {
    sections: {
      numbering: "decimal",
      title: "SALE AND PURCHASE AGREEMENT",
      items: [
        {
          id: "s1",
          number: "1.",
          heading: "PARTIES",
          paragraphs: ["SELLER", "Name: {{b1}}", "PURCHASER", "Name: {{b2}}"],
        },
        {
          id: "s2",
          number: "2.",
          heading: "PRICE",
          paragraphs: ["Unit no: {{b3}}", opts.priceClause ?? "The purchase price is AED {{b4}}, paid as per {{b5}}."],
        },
      ],
    },
    blanks,
    style: DEFAULT_STYLE,
    logo: null,
    pages: 2,
    droppedSections: 0,
    unmappedBlanks: 0,
  };
}

async function newVersion(name = "Standard SPA", data = read(), projectCodes: string[] = []) {
  const t = await createTemplate(ctx(), { name, documentKind: "spa", projectCodes }, admin);
  const v = await addTemplateVersion(ctx(), { templateId: t.id, docId: "doc-1", docHash: HASH, data }, admin);
  return { templateId: t.id, ...v };
}
const statusOf = async (id: string) =>
  (await database.db.select().from(spaTemplateVersions).where(eq(spaTemplateVersions.id, id)))[0]!.status;

describe.skipIf(!url)("SPA templates and versions (C13)", () => {
  beforeEach(async () => {
    await database?.close();
    database = await freshSpaDatabase(url!);
    for (const u of [admin, legal, manager])
      await database.db.insert(spaUsers).values({ ...u, email: `${u.role}@spa-demo.test`, name: u.role });
  });
  afterAll(async () => {
    await database?.close();
  });

  test("only an admin creates templates and adds versions", async () => {
    expect(await fails(createTemplate(ctx(), { name: "X", documentKind: "spa" }, manager))).toEqual({
      status: 403,
      code: "forbidden",
    });
    const t = await createTemplate(ctx(), { name: "X", documentKind: "spa" }, admin);
    expect(
      await fails(addTemplateVersion(ctx(), { templateId: t.id, docId: "d", docHash: HASH, data: read() }, manager)),
    ).toEqual({ status: 403, code: "forbidden" });
    expect(await fails(createTemplate(ctx(), { name: "X", documentKind: "spa" }, admin))).toEqual({
      status: 409,
      code: "template_exists",
    });
  });

  test("a clean version goes to legal; legal approves; a later approval retires it", async () => {
    const v1 = await newVersion();
    expect([v1.version, v1.checks]).toEqual([1, []]);
    const [a] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, v1.approvalId));
    expect([a!.gate, a!.approverRole, a!.status, a!.entityKind]).toEqual([
      "template_approval",
      "legal",
      "pending",
      "template",
    ]);
    expect(await fails(decideApproval(ctx(), v1.approvalId, manager, { decision: "approve" }))).toMatchObject({
      status: 403,
    });
    expect(await fails(decideApproval(ctx(), v1.approvalId, admin, { decision: "approve" }))).toMatchObject({
      status: 403,
    });
    await decideApproval(ctx(), v1.approvalId, legal, { decision: "approve" });
    expect(await statusOf(v1.id)).toBe("approved");
    expect(await currentTemplate(database.db, "spa", null)).toMatchObject({ versionId: v1.id, version: 1 });

    const v2 = await addTemplateVersion(
      ctx(),
      { templateId: v1.templateId, docId: "doc-2", docHash: HASH, data: read() },
      admin,
    );
    expect(v2.version).toBe(2);
    await decideApproval(ctx(), v2.approvalId, legal, { decision: "approve" });
    expect([await statusOf(v1.id), await statusOf(v2.id)]).toEqual(["retired", "approved"]);
  });

  test("a sample price in the wording: approval refused, nothing changes", async () => {
    const v = await newVersion("Sample SPA", read({ priceClause: "The purchase price is 1,250,000 dirhams {{b4}}." }));
    expect(v.checks.map((c) => c.code)).toContain("sample_value");
    expect(await fails(decideApproval(ctx(), v.approvalId, legal, { decision: "approve" }))).toEqual({
      status: 422,
      code: "template_checks_failed",
    });
    expect(await statusOf(v.id)).toBe("in_review");
    const [a] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, v.approvalId));
    expect(a!.status).toBe("pending");
    expect(a!.reasons.length).toBeGreaterThan(0);
  });

  test("a wrong fee % can't be approved", async () => {
    const v = await newVersion(
      "Fee SPA",
      read({ priceClause: "The price is AED {{b4}} per {{b5}}. The DLD registration fee of 2% is paid by the buyer." }),
    );
    expect(v.checks.map((c) => c.code)).toEqual(["fee_rate"]);
    expect(await fails(decideApproval(ctx(), v.approvalId, legal, { decision: "approve" }))).toMatchObject({
      status: 422,
    });
  });

  test("remapping a blank re-runs the checks; a key of the other party is refused", async () => {
    const v = await newVersion("Remap SPA", read({ buyerField: "leave_empty" }));
    expect(v.checks.map((c) => c.code)).toEqual(["missing_core_key", "unmapped_blank"]);
    expect(await fails(remapBlank(ctx(), { versionId: v.id, blankId: "b1", key: "purchaser_name" }, admin))).toEqual({
      status: 422,
      code: "invalid_key",
    });
    expect(await fails(remapBlank(ctx(), { versionId: v.id, blankId: "b2", key: "price" }, admin))).toMatchObject({
      status: 422,
    });
    expect(
      await fails(remapBlank(ctx(), { versionId: v.id, blankId: "b2", key: "purchaser_name" }, manager)),
    ).toMatchObject({ status: 403 });
    const r = await remapBlank(ctx(), { versionId: v.id, blankId: "b2", key: "purchaser_name" }, admin);
    expect(r.checks).toEqual([]);
    const [a] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, v.approvalId));
    expect(a!.reasons).toEqual([]);
    await decideApproval(ctx(), v.approvalId, legal, { decision: "approve" });
    expect(await fails(remapBlank(ctx(), { versionId: v.id, blankId: "b2", key: "leave_empty" }, admin))).toMatchObject(
      { status: 409 },
    );
  });

  test("reject closes the version; edit isn't a decision here", async () => {
    const v = await newVersion();
    expect(
      await fails(decideApproval(ctx(), v.approvalId, legal, { decision: "edit", proposal: { x: 1 } })),
    ).toMatchObject({ status: 422 });
    await decideApproval(ctx(), v.approvalId, legal, { decision: "reject", note: "wrong form" });
    expect(await statusOf(v.id)).toBe("rejected");
    expect(await currentTemplate(database.db, "spa", null)).toBeNull();
  });

  test("decided versions are immutable and never deleted (trigger)", async () => {
    const v = await newVersion();
    await decideApproval(ctx(), v.approvalId, legal, { decision: "approve" });
    const tryQ = (q: string) =>
      database.pool.query(q, [v.id]).then(
        () => "ok",
        (e: Error) => e.message,
      );
    expect(await tryQ("update spa_template_versions set blanks = '[]' where id = $1")).toContain("immutable");
    expect(await tryQ("update spa_template_versions set status = 'in_review' where id = $1")).toContain("immutable");
    expect(await tryQ("update spa_template_versions set sections = '{}' where id = $1")).toContain("immutable");
    expect(await tryQ("delete from spa_template_versions where id = $1")).toContain("never deleted");
  });

  test("a project-scoped template wins for its project; the general one elsewhere", async () => {
    const general = await newVersion("General SPA");
    const scoped = await newVersion("Marina SPA", read(), ["MARINA-1"]);
    await decideApproval(ctx(), general.approvalId, legal, { decision: "approve" });
    await decideApproval(ctx(), scoped.approvalId, legal, { decision: "approve" });
    expect((await currentTemplate(database.db, "spa", "MARINA-1"))?.versionId).toBe(scoped.id);
    expect((await currentTemplate(database.db, "spa", "OTHER"))?.versionId).toBe(general.id);
    expect(await currentTemplate(database.db, "mou", null)).toBeNull();
  });

  test("trigger: a version can't become approved without an approved template_approval", async () => {
    const v = await newVersion();
    const r = await database.pool
      .query("update spa_template_versions set status = 'approved', decided_at = now() where id = $1", [v.id])
      .then(
        () => "ok",
        (e: Error) => e.message,
      );
    expect(r).toContain("approved only through an approved template_approval");
    expect(await statusOf(v.id)).toBe("in_review");
  });

  test("approval re-runs the checks against today's rulebook, not the stored ones", async () => {
    const v = await newVersion("Stale SPA", read({ buyerField: "leave_empty" }));
    expect(v.checks.length).toBeGreaterThan(0);
    await database.pool.query("update spa_template_versions set checks = '[]' where id = $1", [v.id]);
    expect(await fails(decideApproval(ctx(), v.approvalId, legal, { decision: "approve" }))).toMatchObject({
      status: 422,
      code: "template_checks_failed",
    });
    expect(await statusOf(v.id)).toBe("in_review");
    const [a] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, v.approvalId));
    expect(a!.status).toBe("pending");
  });

  test("template approval events carry the version's rules version", async () => {
    const v = await newVersion("Events SPA");
    await decideApproval(ctx(), v.approvalId, legal, { decision: "approve" });
    const events = await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, v.id));
    const approval = events.filter((e) => e.type.startsWith("APPROVAL_"));
    expect(approval).toHaveLength(2);
    for (const e of approval) expect(e.rulesVersion).toBe("dubai-sales-2026-01");
  });
});
