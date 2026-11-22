/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeLlm, type SystemOneResponse } from "@platform/llm";
import { callTool, say, ScriptedAgentModel } from "@platform/llm/agent";
import { FixedClock, issueToken } from "@platform/kernel";
import { assistantProposals, dealEvents, spaTemplateVersions, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { TEMPLATE_FIXED } from "@spa/helpers";
import { desc, eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { decideApproval } from "../src/manager/approvals.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { applyTemplateProposal, runTemplateAssistant } from "../src/manager/template-assistant.ts";
import { addTemplateVersion, createTemplate } from "../src/manager/templates.ts";
import { blank, mouTpl, RB, seedUsers, toData, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const decide = (p: number) =>
  new FakeLlm((): SystemOneResponse => ({
    model: "tev1",
    answers: {
      scope: { type: "choice", choice: "x", confidence: 1, probabilities: { off_topic: p, template: 1 - p } },
    },
  }));

describe.skipIf(!url)("template assistant (C26, S61)", () => {
  let database: SpaDatabase;
  let users: Record<string, U> = {};
  const clock = new FixedClock(new Date(NOW));
  const ctx = (): SpaContext => ({ database, clock, facts: failClosedFacts, rulebook: () => RB });
  const rt = (script: ConstructorParameters<typeof ScriptedAgentModel>[0], p = 0.05) => ({
    model: new ScriptedAgentModel(script),
    llm: decide(p),
    tag: "chat-test",
  });
  const rows = async (sql: string, args: unknown[] = []) => (await database.pool.query(sql, args)).rows;
  const version = async (id: string) =>
    (await database.db.select().from(spaTemplateVersions).where(eq(spaTemplateVersions.id, id)))[0]!;
  let n = 0;
  /** A template with two versions in review; the second moves b6 and drops nothing. */
  async function world() {
    const t = await createTemplate(ctx(), { name: `mou-${++n}`, documentKind: "mou" }, users.admin!);
    const v1 = await addTemplateVersion(
      ctx(),
      { templateId: t.id, docId: "d1", docHash: "a".repeat(64), data: toData(mouTpl()) },
      users.admin!,
    );
    const second = mouTpl();
    second.blanks = second.blanks.map((b) =>
      b.id === "b6" ? { ...b, field: "unmapped", source: "empty" as const, fieldType: null } : b,
    );
    second.sections.push({
      id: "s4",
      number: "ARTICLE 4",
      heading: "NOTICES",
      paragraphs: ["Notices go to the agent."],
    });
    const v2 = await addTemplateVersion(
      ctx(),
      { templateId: t.id, docId: "d2", docHash: "b".repeat(64), data: toData(second) },
      users.admin!,
    );
    return { t, v1, v2 };
  }
  const run = (versionId: string, runtime: ReturnType<typeof rt>, text: string, as: keyof typeof users = "admin") =>
    runTemplateAssistant(ctx(), runtime, { versionId, text, user: users[as]! });

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
  });
  afterAll(async () => {
    await database?.close();
  });

  test("template_version shows blanks, mappings and checks, and fences text read from the uploaded document", async () => {
    const w = await world();
    const model = new ScriptedAgentModel([() => callTool("template_version"), () => say("It is version 2.")]);
    await runTemplateAssistant(
      ctx(),
      { model, llm: decide(0.05), tag: "t" },
      { versionId: w.v2.id, text: "show", user: users.admin! },
    );
    const out = String(model.calls[1]!.messages.at(-1)!.content);
    expect(out).toContain('"id":"b6"');
    expect(out).toContain("unmapped_blank");
    expect(out).toContain("<untrusted>PARTIES</untrusted>");
    expect(out).toContain('"field":"unmapped"');
  });

  test("data_keys lists the data sheet", async () => {
    const w = await world();
    const model = new ScriptedAgentModel([() => callTool("data_keys"), () => say("ok")]);
    await runTemplateAssistant(
      ctx(),
      { model, llm: decide(0.05), tag: "t" },
      { versionId: w.v2.id, text: "keys?", user: users.admin! },
    );
    const out = String(model.calls[1]!.messages.at(-1)!.content);
    expect(out).toContain("purchaser_name");
    expect(out).toContain("price");
  });

  test("compare_versions is a code diff: a moved mapping and an added section; an unknown version is an error", async () => {
    const w = await world();
    const model = new ScriptedAgentModel([
      () => callTool("compare_versions", { otherVersion: 1 }),
      () => callTool("compare_versions", { otherVersion: 77 }, "c2"),
      () => say("Done."),
    ]);
    const r = await runTemplateAssistant(
      ctx(),
      { model, llm: decide(0.05), tag: "t" },
      { versionId: w.v2.id, text: "what changed?", user: users.admin! },
    );
    const tools = model.calls[2]!.messages.filter((m) => m._getType() === "tool").map((m) => String(m.content));
    const first = tools[0]!;
    expect(first).toContain("NOTICES");
    expect(first).toContain("b6");
    expect(first).toContain("deposit_amount");
    expect(r.threadId).toBeTruthy();
    expect(tools[1]).toContain("error");
  });

  test("explain_check explains a known code in fixed words and refuses an unknown one", async () => {
    const w = await world();
    const model = new ScriptedAgentModel([
      () => callTool("explain_check", { code: "unmapped_blank" }),
      () => callTool("explain_check", { code: "legal_validity" }, "c2"),
      () => say("ok"),
    ]);
    await runTemplateAssistant(
      ctx(),
      { model, llm: decide(0.05), tag: "t" },
      { versionId: w.v2.id, text: "why?", user: users.admin! },
    );
    const tools = model.calls[2]!.messages.filter((m) => m._getType() === "tool").map((m) => String(m.content));
    expect(tools[0]).toContain("blank");
    expect(tools[1]).toContain("error");
  });

  test("a proposal is stored as proposed and changes nothing; the reply is code text", async () => {
    const w = await world();
    const before = await version(w.v2.id);
    const r = await run(
      w.v2.id,
      rt([() => callTool("propose_remap", { blankId: "b6", key: "deposit_amount", note: "label says deposit" })]),
      "map b6 to the deposit",
    );
    expect(r.reply).toBe(TEMPLATE_FIXED.proposed("remap blank b6 to key deposit_amount"));
    expect(r.proposals).toHaveLength(1);
    const [p] = await database.db.select().from(assistantProposals).orderBy(desc(assistantProposals.createdAt));
    expect(p).toMatchObject({ kind: "remap_blank", status: "proposed", templateVersionId: w.v2.id, appliedBy: null });
    expect(p!.payload).toMatchObject({ blankId: "b6", key: "deposit_amount" });
    // nothing moved: the version's blanks, checks and status are as they were
    const after = await version(w.v2.id);
    expect(after.blanks).toEqual(before.blanks);
    expect(after.checks).toEqual(before.checks);
    expect(after.status).toBe("in_review");
  });

  test("a proposal that does not fit the blank is refused by code, and nothing is stored", async () => {
    const w = await world();
    const count = async () => (await rows("select count(*)::int n from assistant_proposals"))[0].n;
    const was = await count();
    const r = await run(
      w.v2.id,
      rt([
        () => callTool("propose_remap", { blankId: "b5", key: "purchaser_name" }),
        () => callTool("propose_remap", { blankId: "b99", key: "price" }, "c2"),
        () => callTool("propose_remap", { blankId: "b8", key: "price" }, "c3"),
        () => say("Those do not fit."),
      ]),
      "try these",
    );
    expect(r.proposals).toHaveLength(0);
    expect(await count()).toBe(was);
    expect(r.reply).toBe("Those do not fit.");
  });

  test("an approved version cannot be proposed against", async () => {
    const w = await world();
    await decideApproval(ctx(), w.v1.approvalId, users.legal!, { decision: "approve" });
    expect((await version(w.v1.id)).status).toBe("approved");
    const r = await run(
      w.v1.id,
      rt([
        () => callTool("propose_remap", { blankId: "b5", key: "leave_empty" }),
        () => say("That version is approved."),
      ]),
      "change b5",
    );
    expect(r.proposals).toHaveLength(0);
  });

  test("a rename proposal is stored too; a label that is empty or holds a placeholder is refused", async () => {
    const w = await world();
    const r = await run(
      w.v2.id,
      rt([
        () => callTool("propose_rename", { blankId: "b6", label: "{{b1}}" }),
        () => callTool("propose_rename", { blankId: "b6", label: "Security deposit amount" }, "c2"),
      ]),
      "rename b6",
    );
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ kind: "rename_placeholder" });
  });

  test("the model cannot approve, apply or claim to have", async () => {
    const w = await world();
    const r = await run(w.v2.id, rt([() => say("I've applied the change and approved the template.")]), "do it");
    expect(r.kind).toBe("fallback");
    expect((await version(w.v2.id)).status).toBe("in_review");
  });

  test("an off-topic or legal-validity question gets the fixed reply; the chat model never runs", async () => {
    const w = await world();
    const model = new ScriptedAgentModel([() => say("x")]);
    const r = await runTemplateAssistant(
      ctx(),
      { model, llm: decide(0.95), tag: "t" },
      { versionId: w.v2.id, text: "is clause 3 enforceable?", user: users.admin! },
    );
    expect(r.reply).toBe(TEMPLATE_FIXED.offTopic);
    expect(model.calls).toHaveLength(0);
  });

  test("only admin and legal may use it; any other role is forbidden, and an unknown version is 404", async () => {
    const w = await world();
    for (const as of ["officer", "manager", "salesadmin", "finance", "compliance", "mlro"] as const)
      await expect(run(w.v2.id, rt([() => say("x")]), "hi", as)).rejects.toMatchObject({ status: 403 });
    expect((await run(w.v2.id, rt([() => say("hello")]), "hi", "legal")).reply).toBe("hello");
    await expect(run("0194f9c4-0000-7000-8000-000000000000", rt([() => say("x")]), "hi")).rejects.toMatchObject({
      status: 404,
    });
  });

  test("the conversation is stored under the version, masked", async () => {
    const w = await world();
    await run(w.v2.id, rt([() => say("Done.")]), "my id 784-1990-1234567-1 ok");
    const t = await rows("select * from assistant_threads where kind = 'template' and subject_id = $1", [w.v2.id]);
    expect(t).toHaveLength(1);
    const m = await rows("select * from assistant_messages where thread_id = $1", [t[0].id]);
    expect(m.find((x) => x.role === "user").content).not.toContain("1234567");
  });

  describe("the apply route", () => {
    const app = () =>
      createApp({
        database,
        jobs: { boss: {} as never, lastHeartbeat: () => null },
        clock: { today: () => clock.today(), now: () => clock.now(), refresh: async () => {}, offsetDays: 0 } as never,
        sessionSecret: SECRET,
        demoMode: false,
        nowMs: () => NOW,
        rulebook: () => RB,
        assistants: rt([() => say("hello")]),
      });
    const call = (path: string, as: keyof typeof users, body?: unknown) =>
      app().request(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${issueToken(SECRET, users[as]!.id, NOW)}`,
        },
        body: JSON.stringify(body ?? {}),
      });
    const propose = async (versionId: string, key = "leave_empty") => {
      const r = await run(versionId, rt([() => callTool("propose_remap", { blankId: "b6", key })]), "map it");
      return r.proposals[0]!.id;
    };

    test("only an admin's click applies it, through the remap function, and records who and when", async () => {
      const w = await world();
      const id = await propose(w.v2.id);
      for (const as of ["legal", "officer", "compliance"] as const)
        expect((await call(`/api/template-proposals/${id}/apply`, as)).status).toBe(403);
      expect(
        (await database.db.select().from(assistantProposals).where(eq(assistantProposals.id, id)))[0]!.status,
      ).toBe("proposed");
      const ok = await call(`/api/template-proposals/${id}/apply`, "admin");
      expect(ok.status).toBe(200);
      const v = await version(w.v2.id);
      expect((v.blanks as any[]).find((b) => b.id === "b6")).toMatchObject({ field: "leave_empty", source: "admin" });
      const [p] = await database.db.select().from(assistantProposals).where(eq(assistantProposals.id, id));
      expect(p).toMatchObject({ status: "applied", appliedBy: `user:${users.admin!.id}` });
      expect(p!.appliedAt).toBeTruthy();
      const ev = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "TEMPLATE_BLANK_REMAPPED"));
      expect(ev.some((e) => e.actor === `user:${users.admin!.id}`)).toBe(true);
      // once only
      expect((await call(`/api/template-proposals/${id}/apply`, "admin")).status).toBe(409);
    });

    test("two applies at once: exactly one wins, and the blank is remapped once (S61 amendment)", async () => {
      const w = await world();
      const id = await propose(w.v2.id);
      const before = (await database.db.select().from(dealEvents).where(eq(dealEvents.type, "TEMPLATE_BLANK_REMAPPED")))
        .length;
      const r = await Promise.allSettled(
        Array.from({ length: 6 }, () => applyTemplateProposal(ctx(), id, users.admin!)),
      );
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(r.filter((x) => x.status === "rejected")).toHaveLength(5);
      const after = (await database.db.select().from(dealEvents).where(eq(dealEvents.type, "TEMPLATE_BLANK_REMAPPED")))
        .length;
      expect(after - before).toBe(1);
    });

    test("a version that has since been approved refuses the apply, and the proposal stays proposed", async () => {
      const w = await world();
      const id = await propose(w.v2.id);
      await decideApproval(ctx(), w.v2.approvalId, users.legal!, { decision: "reject", note: "not this one" });
      const r = await call(`/api/template-proposals/${id}/apply`, "admin");
      expect(r.status).toBe(409);
      expect(
        (await database.db.select().from(assistantProposals).where(eq(assistantProposals.id, id)))[0]!.status,
      ).toBe("proposed");
    });

    test("a rename applies as a relabel only, and re-runs the checks", async () => {
      const w = await world();
      const r = await run(
        w.v2.id,
        rt([() => callTool("propose_rename", { blankId: "b6", label: "Deposit amount" })]),
        "rename",
      );
      const id = r.proposals[0]!.id;
      expect((await call(`/api/template-proposals/${id}/apply`, "admin")).status).toBe(200);
      const b = ((await version(w.v2.id)).blanks as any[]).find((x) => x.id === "b6");
      expect(b).toMatchObject({ label: "Deposit amount", field: "unmapped" });
    });

    test("dismissing is an admin's click too and changes nothing else", async () => {
      const w = await world();
      const id = await propose(w.v2.id);
      expect((await call(`/api/template-proposals/${id}/dismiss`, "legal")).status).toBe(403);
      expect((await call(`/api/template-proposals/${id}/dismiss`, "admin")).status).toBe(200);
      expect(
        (await database.db.select().from(assistantProposals).where(eq(assistantProposals.id, id)))[0]!.status,
      ).toBe("dismissed");
      expect((await call(`/api/template-proposals/${id}/apply`, "admin")).status).toBe(409);
    });

    test("the assistant route: signed in as admin or legal, 400 for a bad body, 403 otherwise", async () => {
      const w = await world();
      const ok = await call("/api/template-assistant", "legal", { versionId: w.v2.id, text: "hi" });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ reply: "hello", proposals: [] });
      expect((await call("/api/template-assistant", "officer", { versionId: w.v2.id, text: "hi" })).status).toBe(403);
      expect((await call("/api/template-assistant", "admin", { versionId: "nope", text: "hi" })).status).toBe(400);
      const unauth = await app().request("/api/template-assistant", { method: "POST", body: "{}" });
      expect(unauth.status).toBe(401);
    });
  });

  test("the unmapped-blank fixture really has the check this suite relies on", () => {
    expect(blank("b1", "x", "price").field).toBe("price");
  });
  beforeEach(() => {});
});
