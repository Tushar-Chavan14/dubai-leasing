import { describe, expect, test } from "bun:test";
import { engineClient, GET_ALLOWLIST, PROPOSE_ALLOWLIST, type Transport } from "../src/client.ts";

const ID = "0190a000-0000-7000-8000-000000000001";
const seen: string[] = [];
const ok: Transport = async (r) => {
  seen.push(`${r.method} ${r.path}`);
  return { status: 200, body: { ok: true } };
};
const client = () => engineClient(ok);

describe("the copilot's engine client allowlist (C36, S68)", () => {
  test("every read route a tool needs is allowed", async () => {
    for (const p of [
      "/api/deals?q=D-1001&limit=5",
      `/api/deals/${ID}`,
      `/api/deals/${ID}/events?limit=20`,
      `/api/deals/${ID}/payments`,
      `/api/deals/${ID}/settlement`,
      `/api/deals/${ID}/signing`,
      `/api/deals/${ID}/noc-status`,
      "/api/approvals?scope=inbox&status=pending",
      "/api/tasks?scope=mine",
      "/api/listings?limit=5",
      `/api/listings/${ID}`,
      "/api/templates",
      `/api/templates/${ID}`,
      "/api/copilot/rulebook?key=registrationFeeBps",
      "/api/compliance/cases?status=open",
      `/api/compliance/cases/${ID}`,
    ])
      await expect(client().get(p)).resolves.toEqual({ ok: true });
  });

  test("any other path fails before it is sent: confirm, cancel, decide, send, sign, settings, uploads, traversal", async () => {
    seen.length = 0;
    const bad = [
      `/api/copilot/proposals/${ID}/confirm`,
      `/api/copilot/proposals/${ID}/cancel`,
      `/api/approvals/${ID}/decide`,
      `/api/deals/${ID}/signing/resend`,
      `/api/deals/${ID}/prepare`,
      `/api/deals/${ID}/document-requests`,
      `/api/deals/${ID}/aml`,
      `/api/deals/${ID}/kyc`,
      `/api/deals/${ID}/documents`,
      "/api/settings/kyc",
      "/api/settings/helpers",
      "/api/compliance/policy",
      "/api/compliance/exports",
      "/api/tasks/" + ID + "/done",
      "/api/me",
      "/api/deals/../settings/kyc",
      `/api/deals/${ID}/../../settings`,
      "/api/deals?x=1#frag",
      "/api/deals?q=a b",
      "http://evil.test/api/deals",
      "//evil.test/api/deals",
      "/public/party/abc/assistant",
      "/api/deals/not-a-uuid",
    ];
    for (const p of bad) await expect(client().get(p)).rejects.toThrow("not available to the copilot");
    expect(seen).toEqual([]);
  });

  test("propose accepts exactly two paths", async () => {
    expect(PROPOSE_ALLOWLIST).toEqual(["/api/copilot/proposals", "/api/copilot/drafts"]);
    seen.length = 0;
    await client().propose("/api/copilot/proposals", { kind: "create_task" });
    await client().propose("/api/copilot/drafts", { kind: "email" });
    expect(seen).toEqual(["POST /api/copilot/proposals", "POST /api/copilot/drafts"]);
    for (const p of [
      `/api/copilot/proposals/${ID}/confirm`,
      "/api/copilot/proposals/",
      "/api/copilot/proposals?x=1",
      "/api/approvals",
      `/api/deals/${ID}/prepare`,
    ])
      await expect(client().propose(p, {})).rejects.toThrow("not available to the copilot");
  });

  test("the client exposes get and propose and nothing that posts elsewhere", () => {
    expect(Object.keys(client()).sort()).toEqual(["get", "propose"]);
  });

  test("the allowlist holds no write verb's route: no confirm, cancel, decide, send, sign, submit, clear or settings", () => {
    const text = GET_ALLOWLIST.map((r) => r.source).join("\n");
    expect(text).not.toMatch(/confirm|cancel|decide|send|sign(?!ing)|submit|clear|settings|policy|upload|document/);
  });

  test("a refusal reads as a plain sentence, and a 403 never repeats the engine's own words", async () => {
    const c = engineClient(async () => ({ status: 403, body: { error: "only compliance_officer, mlro can x" } }));
    await expect(c.get(`/api/compliance/cases/${ID}`)).rejects.toThrow("your role can't use this");
    const gone = engineClient(async () => ({ status: 410, body: {} }));
    await expect(gone.get("/api/tasks")).rejects.toThrow("expired");
    const conflict = engineClient(async () => ({ status: 409, body: { error: "the deal is cancelled" } }));
    await expect(conflict.propose("/api/copilot/proposals", {})).rejects.toThrow("the deal is cancelled");
  });
});
