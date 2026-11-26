import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("C28 outbound messages, signing envelopes and signatures (spa_test)", () => {
  let db: SpaDatabase;
  let seq = 0;
  let templateVersionId = "";
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  const newDeal = async (): Promise<string> => {
    const listing = (
      await q("insert into listings (id, ref) values (gen_random_uuid(), $1) returning id", [`L-${++seq}`])
    ).rows[0].id;
    return (
      await q(
        "insert into deals (id, deal_type, listing_id, price_fils, created_by, rules_version) values (gen_random_uuid(), 'resale_ready', $1, 1000, 'system', 'r') returning id",
        [listing],
      )
    ).rows[0].id;
  };
  const agreement = async (dealId: string, status = "approved") => {
    const id = crypto.randomUUID();
    const appr = (
      await q(
        `insert into spa_approvals (id, gate, entity_kind, entity_id, dedupe_key, title, proposal, reasons, approver_role, proposed_by, status, created_at)
         values (gen_random_uuid(), 'agreement_approval', 'deal', $1, gen_random_uuid()::text, 't', '{}', '{}', 'legal', 'system:prepare', 'approved', now()) returning id`,
        [dealId],
      )
    ).rows[0].id;
    await q(
      `insert into agreements (id, deal_id, kind, version, template_version_id, status, doc_hash, storage_key, values_hash, field_sources, rules_version, policy_version, prepared_by, prepared_at)
       values ($1, $2, 'mou', 1, $3, 'prepared', 'dh', 'k', 'v', '{}', 'r', 0, 'system:prepare', now())`,
      [id, dealId, templateVersionId],
    );
    await q("update agreements set approval_id = $2 where id = $1", [id, appr]);
    if (status === "approved") await q("update agreements set status = 'approved' where id = $1", [id]);
    return id;
  };
  const envelope = (dealId: string, agreementId: string, o: { docHash?: string; id?: string } = {}) => {
    const id = o.id ?? crypto.randomUUID();
    return refusal(
      q(
        `insert into signing_envelopes (id, deal_id, agreement_id, doc_hash, status, created_at) values ($1, $2, $3, $4, 'open', now())`,
        [id, dealId, agreementId, o.docHash ?? "dh"],
      ),
    ).then((r) => ({ id, r }));
  };
  const party = async () =>
    (
      await q(
        "insert into parties (id, kind, full_name_en, email, created_at) values (gen_random_uuid(), 'person', 'P', $1, now()) returning id",
        [`p${++seq}@example.test`],
      )
    ).rows[0].id;
  const sig = async (envId: string, n: number, o: { role?: string; token?: string } = {}) => {
    const id = crypto.randomUUID();
    const r = await refusal(
      q(
        `insert into signatures (id, envelope_id, seq, role, party_id, name_on_agreement, email, link_token_hash, link_expires_at, anchor)
         values ($1, $2, $3, $4, $5, 'N', 'n@example.test', $6, now() + interval '14 days', '{}')`,
        [id, envId, n, o.role ?? "purchaser", await party(), o.token ?? `h${++seq}`],
      ),
    );
    return { id, r };
  };
  const sign = (id: string) =>
    refusal(
      q(
        `update signatures set link_used_at = now(), signed_at = now(), typed_name = 'N', consent = true, ip = '1.1.1.1', user_agent = 'ua' where id = $1`,
        [id],
      ),
    );
  const mail = (o: { entity?: string; purpose?: string; milestone?: string; status?: string } = {}) => {
    const id = crypto.randomUUID();
    return refusal(
      q(
        `insert into outbound_messages (id, entity_kind, entity_id, purpose, milestone, to_email, intended_to, template, template_version, subject, status, created_at)
         values ($1, 'signature', $2, $3, $4, 'a@example.test', 'a@example.test', 'sign_link', 1, 'Sign · X', $5, now())`,
        [id, o.entity ?? crypto.randomUUID(), o.purpose ?? "link", o.milestone ?? "m", o.status ?? "sending"],
      ),
    ).then((r) => ({ id, r }));
  };

  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
    const t = (
      await q(
        "insert into spa_templates (id, name, document_kind, created_by, created_at) values (gen_random_uuid(), 'T', 'mou', 'u', now()) returning id",
      )
    ).rows[0].id;
    templateVersionId = (
      await q(
        `insert into spa_template_versions (id, template_id, version, doc_id, doc_hash, sections, blanks, look, party_blocks, signature_roles, checks, rules_version, created_by, created_at)
         values (gen_random_uuid(), $1, 1, 'd', 'h', '{}', '[]', '{}', '[]', '{}', '[]', 'r', 'u', now()) returning id`,
        [t],
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await db?.close();
  });

  test("outbound: purpose and status are checked; one row per entity, purpose and milestone", async () => {
    const e = crypto.randomUUID();
    expect((await mail({ purpose: "nope" })).r).toContain("outbound_messages_purpose");
    expect((await mail({ status: "nope" })).r).toContain("outbound_messages_status");
    expect((await mail({ entity: e })).r).toBe("accepted");
    expect((await mail({ entity: e })).r).toContain("outbound_messages_once_uq");
    expect((await mail({ entity: e, milestone: "m2" })).r).toBe("accepted");
    expect((await mail({ entity: e, purpose: "reminder" })).r).toBe("accepted");
  });

  test("outbound: claimed_at moves while a row is sending, and a sent row stays final", async () => {
    const { id } = await mail();
    expect(await refusal(q("update outbound_messages set claimed_at = now() where id = $1", [id]))).toBe("accepted");
    expect(await refusal(q("update outbound_messages set status = 'sent', sent_at = now() where id = $1", [id]))).toBe(
      "accepted",
    );
    expect(await refusal(q("update outbound_messages set claimed_at = now() where id = $1", [id]))).toContain("final");
  });

  test("outbound: only the send result changes; a sent message is final; never deleted", async () => {
    const { id } = await mail();
    expect(await refusal(q("update outbound_messages set subject = 'x' where id = $1", [id]))).toContain("fixed");
    expect(await refusal(q("update outbound_messages set intended_to = 'x@y.test' where id = $1", [id]))).toContain(
      "fixed",
    );
    expect(
      await refusal(
        q(
          `update outbound_messages set status = 'sent', body_sha256 = 'b', attachment_sha256s = '{a}', message_id = '<m>', smtp_response = '250', sent_at = now() where id = $1`,
          [id],
        ),
      ),
    ).toBe("accepted");
    expect(await refusal(q("update outbound_messages set status = 'failed' where id = $1", [id]))).toContain("final");
    expect(await refusal(q("update outbound_messages set smtp_response = 'x' where id = $1", [id]))).toContain("final");
    expect(await refusal(q("delete from outbound_messages where id = $1", [id]))).toContain("never deleted");
    expect(await refusal(q("truncate outbound_messages cascade"))).toContain("never deleted");
    // A failed attempt may be tried again.
    const f = await mail();
    expect(
      await refusal(q("update outbound_messages set status = 'failed', error = 'down' where id = $1", [f.id])),
    ).toBe("accepted");
    expect(
      await refusal(q("update outbound_messages set status = 'sending', error = null where id = $1", [f.id])),
    ).toBe("accepted");
  });

  test("envelope: needs the deal's own approved agreement and its hash; one open per agreement", async () => {
    const d = await newDeal();
    const other = await newDeal();
    const prepared = await agreement(d, "prepared");
    expect((await envelope(d, prepared)).r).toContain("approved agreement");
    const ok = await agreement(await newDeal());
    expect((await envelope(d, ok)).r).toContain("approved agreement");
    const a = await agreement(other);
    expect((await envelope(other, a, { docHash: "different" })).r).toContain("approved agreement");
    expect((await envelope(other, a)).r).toBe("accepted");
    expect((await envelope(other, a)).r).toContain("signing_envelopes_one_open_uq");
  });

  test("envelope: complete needs every signature signed, the hash and the time; status only moves forward", async () => {
    const d = await newDeal();
    const a = await agreement(d);
    const { id } = await envelope(d, a);
    const s1 = await sig(id, 1);
    expect(
      await refusal(
        q(
          "update signing_envelopes set status = 'complete', signed_doc_hash = 'x', completed_at = now() where id = $1",
          [id],
        ),
      ),
    ).toContain("every signature");
    expect(await sign(s1.id)).toBe("accepted");
    expect(await refusal(q("update signing_envelopes set status = 'complete' where id = $1", [id]))).toContain(
      "signing_envelopes_complete_needs",
    );
    expect(
      await refusal(
        q(
          "update signing_envelopes set status = 'complete', signed_doc_hash = 'x', storage_key = 'k', completed_at = now() where id = $1",
          [id],
        ),
      ),
    ).toBe("accepted");
    expect(await refusal(q("update signing_envelopes set status = 'open' where id = $1", [id]))).toContain(
      "cannot become",
    );
    expect(await refusal(q("update signing_envelopes set doc_hash = 'z' where id = $1", [id]))).toContain("fixed");
    expect(await refusal(q("delete from signing_envelopes where id = $1", [id]))).toContain("never deleted");
  });

  test("signatures: role checked, token unique, signed needs name, consent and a used link", async () => {
    const d = await newDeal();
    const a = await agreement(d);
    const { id: env } = await envelope(d, a);
    expect((await sig(env, 1, { role: "tenant" })).r).toContain("signatures_role");
    expect((await sig(env, 1, { token: "same" })).r).toBe("accepted");
    expect((await sig(env, 2, { token: "same" })).r).toContain("signatures_link_token_hash");
    expect((await sig(env, 1, { token: "other" })).r).toContain("signatures_envelope_seq_uq");
    const d2 = await newDeal();
    const { id: env2 } = await envelope(d2, await agreement(d2));
    const s = await sig(env2, 1);
    expect(await refusal(q("update signatures set signed_at = now() where id = $1", [s.id]))).toContain(
      "signatures_signed_complete",
    );
  });

  test("signatures: signed in order only; a signed row is immutable; a resend replaces an unsigned link", async () => {
    const d = await newDeal();
    const a = await agreement(d);
    const { id: env } = await envelope(d, a);
    const s1 = await sig(env, 1);
    const s2 = await sig(env, 2, { role: "seller" });
    expect(await sign(s2.id)).toContain("order");
    expect(
      await refusal(
        q(
          "update signatures set link_token_hash = 'fresh', link_expires_at = now() + interval '14 days' where id = $1",
          [s1.id],
        ),
      ),
    ).toBe("accepted");
    expect(await refusal(q("update signatures set email = 'x@y.test' where id = $1", [s1.id]))).toContain("fixed");
    expect(await sign(s1.id)).toBe("accepted");
    expect(await sign(s2.id)).toBe("accepted");
    expect(await refusal(q("update signatures set typed_name = 'Other' where id = $1", [s1.id]))).toContain("signed");
    expect(await refusal(q("update signatures set link_token_hash = 'again' where id = $1", [s1.id]))).toContain(
      "signed",
    );
    expect(await refusal(q("delete from signatures where id = $1", [s1.id]))).toContain("never deleted");
    expect(await refusal(q("truncate signatures"))).toContain("never deleted");
  });
});
