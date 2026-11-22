/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { issueToken } from "../../engine/test/session.ts";
import type { SpaDatabase } from "../../../packages/db/src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../../../packages/db/src/testing.ts";
import { createApp } from "../../engine/src/app.ts";
import { SpaDemoClock } from "../../engine/src/clock.ts";
import { buildWorld, type World } from "../../engine/test/reads-fixture.ts";
import { HelperSettingsView } from "../components/helper-settings";
import { HelperSettings } from "../lib/contracts";
import { loadHelperSettings, type Get } from "../lib/loaders";
import { COMPLIANCE_WORDS } from "./fixtures";

const noop = async () => {};
const data = (over: Record<string, unknown> = {}) =>
  HelperSettings.parse({
    canEdit: true,
    helpers: [
      {
        helper: "spa_kyc",
        label: "Identity (KYC) check",
        model: "vision-model:1",
        availableScopes: ["*"],
        settings: [{ scope: "*", mode: "review", version: 2, setAt: "2026-11-19T06:00:00.000Z", setBy: "Omar Admin" }],
      },
      {
        helper: "spa_document_reader",
        label: "Document reader",
        model: null,
        availableScopes: ["*", "noc", "title_deed"],
        settings: [
          { scope: "*", mode: "auto", version: 0, setAt: null, setBy: null },
          { scope: "noc", mode: "off", version: 1, setAt: "2026-11-19T06:00:00.000Z", setBy: null },
        ],
      },
      {
        helper: "spa_prepare",
        label: "Agreement preparation",
        model: null,
        availableScopes: ["*"],
        settings: [{ scope: "*", mode: "auto", version: 0, setAt: null, setBy: null }],
      },
    ],
    ...over,
  });

describe("HelperSettingsView (C24, S59)", () => {
  test("a kind whose read holds nothing offers Auto and Off, not Review (S59 amendment)", () => {
    const d = data();
    const reader = d.helpers.find((h) => h.helper === "spa_document_reader")!;
    reader.reviewScopes = ["*", "noc"];
    const html = render(<HelperSettingsView data={d} action={noop} />);
    // the "set a mode for one kind" list holds Title deed: its form has no Review button
    const deed = html.slice(html.indexOf("Title deed"));
    expect(deed.slice(0, deed.indexOf("</li>"))).not.toContain(">Review<");
    expect(deed.slice(0, deed.indexOf("</li>"))).toContain(">Off<");
  });

  test("an admin sees a three-way mode control per helper, the mode in force, and models read-only", () => {
    const html = render(<HelperSettingsView data={data()} action={noop} />);
    expect(html).toContain("Identity (KYC) check");
    for (const w of ["Auto", "Review", "Off"]) expect(html).toContain(`>${w}<`);
    expect(html).toMatch(/aria-checked="true"[^>]*>Review</);
    expect(html).toContain("vision-model:1");
    expect(html).toContain("A model or prompt change needs its eval to pass");
    expect(html).toContain("No model: code does this step");
    // Models are text, never an input.
    expect(html).not.toMatch(/<input[^>]*name="model/i);
    // The reader shows its per-kind row.
    expect(html).toContain("NOC");
    expect(html).toMatch(/type="submit"/);
    expect(html).not.toMatch(COMPLIANCE_WORDS);
  });

  test("a sales manager reads the same screen with no form and no button", () => {
    const html = render(<HelperSettingsView data={data({ canEdit: false })} action={noop} />);
    expect(html).toContain("Identity (KYC) check");
    expect(html).toContain("Review");
    expect(html).not.toMatch(/<(form|button|input)\b/);
    expect(html).toContain("An admin changes these");
  });

  test("the page sends only a helper, a scope and a mode (a test of the action's form fields)", () => {
    const html = render(<HelperSettingsView data={data()} action={noop} />);
    const names = [...html.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(names)).toEqual(new Set(["helper", "scope", "mode"]));
  });

  test("it explains the three modes in plain words and never mentions screening", () => {
    const html = render(<HelperSettingsView data={data()} action={noop} />);
    expect(html).toContain("waits for a person");
    expect(html).toContain("task");
    expect(html).not.toMatch(COMPLIANCE_WORDS);
  });
});

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();
describe.skipIf(!url)("the settings page reads the real engine route", () => {
  let database: SpaDatabase;
  let w: World;
  let app: ReturnType<typeof createApp>;
  const getAs =
    (role: keyof World["users"]): Get =>
    async (path, schema) => {
      const res = await app.request(path, {
        headers: { authorization: `Bearer ${issueToken(SECRET, w.users[role]!.id, NOW)}` },
      });
      if ([400, 403, 404].includes(res.status)) return null;
      expect(res.status).toBe(200);
      return schema.parse(await res.json());
    };
  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    w = await buildWorld(database);
    app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
      models: { vision: "vision-model:1" },
    });
  });
  afterAll(async () => {
    await database?.close();
  });

  test("admin gets the editable screen, a sales manager the read-only one, anyone else nothing", async () => {
    const admin = (await loadHelperSettings(getAs("admin")))!;
    const html = render(<HelperSettingsView data={admin} action={noop} />);
    expect(admin.canEdit).toBe(true);
    expect(html).toContain("vision-model:1");
    expect(html).not.toMatch(COMPLIANCE_WORDS);
    const mgr = (await loadHelperSettings(getAs("manager")))!;
    expect(mgr.canEdit).toBe(false);
    expect(render(<HelperSettingsView data={mgr} action={noop} />)).not.toMatch(/<(form|button)\b/);
    for (const r of ["officer", "legal", "finance", "salesadmin", "compliance", "mlro"] as const)
      expect(await loadHelperSettings(getAs(r))).toBeNull();
  });
});

describe("the settings action", () => {
  test("it makes one write, the settings route, and sends no model field", async () => {
    const text = await Bun.file(`${import.meta.dir}/../app/(staff)/settings/helpers/actions.ts`).text();
    expect([...text.matchAll(/\.\$(put|post|patch|delete)\b/g)].map((m) => m[1])).toEqual(["put"]);
    expect(text).toContain("settings.helpers.$put");
    expect(text).not.toMatch(/\/decide|model/i);
  });
});
